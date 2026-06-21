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
  if (process.env.INSPECT_MODERN_UI === "1") {
    const inspection = await bigCoach.evaluate(`({
      url:location.href,
      text:document.body.innerText.slice(0,1200),
      inputs:[...document.querySelectorAll("input")].map((item)=>({
        type:item.type,value:item.value,checked:item.checked,outer:item.outerHTML.slice(0,300)
      })),
      labels:[...document.querySelectorAll("label,.el-radio-button,.el-radio-button__inner")].map((item)=>({
        text:item.textContent.trim(),className:String(item.className)
      })),
      iframes:[...document.querySelectorAll("iframe")].map((item)=>({title:item.title,src:item.src}))
    })`);
    console.log(JSON.stringify(inspection, null, 2));
    bigCoach.close();
    panel.close();
    return;
  }
  const automaticStatsText = await panel.evaluate("document.querySelector('#current-shin-rate').textContent");
  const first = await panel.evaluate("window.bigcoachApp.refreshScene()");
  mark("scene");
  console.error("step: scene");
  if (process.env.VERIFY_MAJOR_THRESHOLD === "1") {
    const target = await bigCoach.evaluate(`window.__bigcoachDesktop.listDecisions().then((items) =>
      items.find((item) => item.roundText === "東3局" && item.turn === 3 && item.actual === "1m"))`);
    if (!target) throw new Error("東3局3巡目の打1mを見つけられませんでした");
    await bigCoach.evaluate(`window.__bigcoachDesktop.goToPosition(${target.handCounter},${target.plyCounter})`);
    const scene = await panel.evaluate("window.bigcoachApp.refreshScene()");
    if (scene.majorMistake?.isMajor) throw new Error("23.114%の打1mが大悪手に判定されています");
    console.log(JSON.stringify({
      roundText: scene.roundText,
      turn: scene.currentTurn,
      actual: scene.actualDiscard,
      actualProbability: scene.majorMistake.actualProbability,
      majorMistake: scene.majorMistake
    }, null, 2));
    bigCoach.close();
    panel.close();
    return;
  }
  const stats = await panel.evaluate("window.bigcoachApp.refreshStats()");
  const trendChart = await panel.evaluate(`(()=>{
    const root=document.querySelector("#shin-trend-chart");
    return {
      svg:Boolean(root?.querySelector("svg")),
      currentLine:Boolean(root?.querySelector(".trend-line.current")),
      cumulativeLine:Boolean(root?.querySelector(".trend-line.cumulative")),
      points:root?.querySelectorAll(".trend-point").length || 0,
      latest:root?.querySelector(".trend-latest")?.textContent || ""
    };
  })()`);
  if (!trendChart.svg || !trendChart.currentLine || !trendChart.cumulativeLine) {
    throw new Error("Shin mistake trend chart was not rendered");
  }
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
  const frontPromptIndex = preview.front.search(/何切？|副露？|リーチ？/);
  const frontImageIndex = preview.front.indexOf("<img");
  if (frontPromptIndex < 0 || frontPromptIndex > frontImageIndex) throw new Error("Front prompt is not above the image");
  const backMemoIndex = preview.back.indexOf("<h2>メモ</h2>");
  const backImageIndex = preview.back.indexOf("<img");
  const outcomeIndex = preview.back.indexOf("流局確率");
  const comparisonIndex = preview.back.indexOf("<h2>何切る比較</h2>");
  if (!(backMemoIndex >= 0 && backMemoIndex < backImageIndex &&
      backImageIndex < outcomeIndex && outcomeIndex < comparisonIndex)) {
    throw new Error("Card back sections are not in the required order");
  }
  const outcomeSection = preview.back.slice(outcomeIndex, comparisonIndex);
  const outcomeValues = [...outcomeSection.matchAll(/([0-9.]+)%/g)].map((match) => match[1]);
  if (outcomeValues.length !== 4) throw new Error("Four BigCoach outcome probabilities were not captured");
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
    trendChart,
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
      prompt: /何切？|副露？|リーチ？/.test(preview.front),
      outcomeProbabilities: ["流局確率", "横移動確率", "放銃確率", "和了確率"]
        .every((label) => preview.back.includes(label)),
      outcomeValues
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
