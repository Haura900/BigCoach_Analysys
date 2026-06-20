"use strict";
const fs = require("node:fs");

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const call = pending.get(message.id);
    pending.delete(message.id);
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  return {
    send,
    async evaluate(expression) {
      const response = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || "Runtime.evaluate failed");
      }
      return response.result.value;
    },
    close: () => socket.close()
  };
}

async function main() {
  const mark = (text) => fs.appendFileSync("verify-progress.log", `${new Date().toISOString()} ${text}\n`);
  mark("start");
  const port = Number(process.argv[2] || 9223);
  const reviewUrl = process.argv[3];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const bigCoachTarget = targets.find((item) => item.url.startsWith("https://review.bigcoach.work"));
  const panelTarget = targets.find((item) => item.url.includes("/src/renderer/index.html"));
  if (!bigCoachTarget || !panelTarget) throw new Error("Required Electron targets not found");
  const bigCoach = await connect(bigCoachTarget.webSocketDebuggerUrl);
  const panel = await connect(panelTarget.webSocketDebuggerUrl);
  mark("connected");
  console.error("step: open-url");
  const opened = await panel.evaluate(`window.bigcoachApp.openReviewUrl(${JSON.stringify(reviewUrl)})`);
  mark("opened");
  console.error("step: opened");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const internals = await bigCoach.evaluate(`(()=>{
    const frame=document.querySelector("iframe[title='Analysis Result']");
    const view=frame?.contentWindow;
    const game=view?.MM?.GS;
    return {
      outerUrl:location.href,
      title:document.title,
      bodyText:document.body?.innerText?.slice(0,500) || "",
      iframes:[...document.querySelectorAll("iframe")].map((item)=>({
        title:item.title, src:item.src, id:item.id, name:item.name
      })),
      frameSrc:frame?.src || null,
      frameReady:frame?.contentDocument?.readyState || null,
      hasMM:Boolean(view?.MM),
      mmKeys:Object.keys(view?.MM || {}),
      hasGS:Boolean(game),
      gsKeys:Object.keys(game || {}),
      hasFullData:Boolean(game?.fullData),
      geHands:Array.isArray(game?.ge) ? game.ge.length : null,
      percentElements:[...frame?.contentDocument?.querySelectorAll("body *") || []]
        .filter((element)=>/%/.test(element.textContent || "") && element.children.length === 0)
        .slice(0,30)
        .map((element)=>({
          tag:element.tagName,
          className:String(element.className || ""),
          id:element.id,
          text:(element.textContent || "").trim(),
          parentClass:String(element.parentElement?.className || "")
        })),
      currentEval:(()=>{
        const entry=game?.ge?.flat()?.find((event)=>event?.mortalEval)?.mortalEval;
        return entry ? {
          keys:Object.keys(entry),
          detailKeys:(entry.details || []).map((item)=>Object.keys(item)),
          details:(entry.details || []).map((item)=>({
            action:item.action,
            metrics:Object.fromEntries(Object.entries(item).filter(([key,value])=>
              typeof value === "number" && key !== "q_value" && key !== "prob"))
          }))
        } : null;
      })(),
      adapter:Boolean(window.__bigcoachDesktop)
    };
  })()`);
  internals.adapterProbe = await bigCoach.evaluate(`Promise.race([
    window.__bigcoachDesktop.listDecisions()
      .then((items)=>({ok:true,count:items.length,first:items[0]}))
      .catch((error)=>({ok:false,error:error.stack || error.message})),
    new Promise((resolve)=>setTimeout(()=>resolve({ok:false,error:"timeout"}),5000))
  ])`);
  internals.graphProbe = await bigCoach.evaluate(`(async()=>{
    await window.__bigcoachDesktop.goToPosition(0,4);
    const frame=document.querySelector("iframe[title='Analysis Result']");
    const page=frame.contentDocument;
    const game=frame.contentWindow.MM.GS;
    if (!game.showMortal) page.querySelector(".discard-bars-svg")?.dispatchEvent(new MouseEvent("click",{bubbles:true}));
    await new Promise((resolve)=>setTimeout(resolve,200));
    return {
      showMortal:game.showMortal,
      text:page.body.innerText.slice(-1200),
      leaves:[...page.querySelectorAll("body *")]
        .filter((element)=>element.children.length===0 && (element.textContent || "").trim())
        .slice(-80)
        .map((element)=>({
          tag:element.tagName,
          className:String(element.className || ""),
          id:element.id,
          text:(element.textContent || "").trim()
        }))
    };
  })()`);
  internals.scrapeProbe = await bigCoach.evaluate(`Promise.race([
    window.__bigcoachDesktop.scrape()
      .then((scene)=>({ok:true,roundText:scene.roundText,hands:scene.handsBySeat?.map((hand)=>hand.length)}))
      .catch((error)=>({ok:false,error:error.stack || error.message})),
    new Promise((resolve)=>setTimeout(()=>resolve({ok:false,error:"timeout"}),5000))
  ])`);
  mark(`internals ${JSON.stringify(internals)}`);
  if (process.env.VERIFY_INTERNALS_ONLY === "1") {
    console.log(JSON.stringify(internals, null, 2));
    bigCoach.close();
    panel.close();
    return;
  }
  const automaticStatsText = await panel.evaluate("document.querySelector('#current-shin-rate').textContent");
  const first = await panel.evaluate("window.bigcoachApp.refreshScene()");
  mark("scene");
  console.error("step: scene");
  const stats = await panel.evaluate("window.bigcoachApp.refreshStats()");
  const major = await panel.evaluate("window.bigcoachApp.listMajorMistakes()");
  mark("major");
  console.error("step: major");
  if (!major.items.length) throw new Error("No major mistakes found");
  const jumped = await panel.evaluate("window.bigcoachApp.navigate('nextMajor')");
  mark("jumped");
  console.error("step: jumped");
  const preview = await panel.evaluate("window.bigcoachApp.previewCard('verification')");
  mark("preview");
  console.error("step: preview");
  const tileImagesInBack = (preview.back.match(/<img src="data:image\/png;base64/g) || []).length;
  if (tileImagesInBack < 3) throw new Error("Card back does not contain tile images");
  const frontData = preview.front.match(/data:image\/png;base64,([^"']+)/)?.[1];
  const backData = preview.back.match(/data:image\/png;base64,([^"']+)/)?.[1];
  if (frontData) fs.writeFileSync("verify-front.png", Buffer.from(frontData, "base64"));
  if (backData) fs.writeFileSync("verify-back.png", Buffer.from(backData, "base64"));
  const shin = await panel.evaluate("window.bigcoachApp.navigate('nextShin')");
  mark("shin");
  console.error("step: shin");
  await panel.evaluate("document.querySelector('#settings-open').click()");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const dialog = await panel.evaluate(`(()=>{const d=document.querySelector('#settings-dialog');const r=d.getBoundingClientRect();return {open:d.open,width:r.width,height:r.height,left:r.left,top:r.top}})()`);
  await panel.evaluate("document.querySelector('#settings-dialog').close()");
  console.log(JSON.stringify({
    historyCount: opened.history.length,
    automaticStatsText,
    first: {
      roundText: first.roundText,
      turn: first.currentTurn,
      hand: first.handMpsz,
      actual: first.actualDiscard,
      recommended: first.recommendedDiscard
    },
    majorMistakes: major.items.length,
    stats,
    jumped: {
      roundText: jumped.roundText,
      turn: jumped.currentTurn,
      actual: jumped.actualDiscard,
      recommended: jumped.recommendedDiscard,
      isMajor: jumped.majorMistake?.isMajor
    },
    shin: {
      roundText: shin.roundText,
      turn: shin.currentTurn,
      isShin: shin.shinMistake?.isShin
    },
    simulator: preview.comparison,
    cardImages: {
      front: /data:image\/png;base64,/.test(preview.front),
      back: /data:image\/png;base64,/.test(preview.back),
      resultTileImages: tileImagesInBack,
      prompt: /何切？|副露？|リーチ？/.test(preview.front)
    },
    dialog
  }, null, 2));
  bigCoach.close();
  panel.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
