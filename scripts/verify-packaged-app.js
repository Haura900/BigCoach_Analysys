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
  const port = Number(process.argv[2] || 9223);
  const reviewUrl = process.argv[3];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const bigCoachTarget = targets.find((item) => item.url.startsWith("https://review.bigcoach.work"));
  const panelTarget = targets.find((item) => item.url.includes("/src/renderer/index.html"));
  if (!bigCoachTarget || !panelTarget) throw new Error("Required Electron targets not found");
  const bigCoach = await connect(bigCoachTarget.webSocketDebuggerUrl);
  const panel = await connect(panelTarget.webSocketDebuggerUrl);
  const opened = await panel.evaluate(`window.bigcoachApp.openReviewUrl(${JSON.stringify(reviewUrl)})`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const first = await panel.evaluate("window.bigcoachApp.refreshScene()");
  const stats = await panel.evaluate("window.bigcoachApp.refreshStats()");
  const major = await panel.evaluate("window.bigcoachApp.listMajorMistakes()");
  if (!major.items.length) throw new Error("No major mistakes found");
  const jumped = await panel.evaluate("window.bigcoachApp.navigate('nextMajor')");
  const preview = await panel.evaluate("window.bigcoachApp.previewCard('verification')");
  const frontData = preview.front.match(/data:image\/png;base64,([^"']+)/)?.[1];
  const backData = preview.back.match(/data:image\/png;base64,([^"']+)/)?.[1];
  if (frontData) fs.writeFileSync("verify-front.png", Buffer.from(frontData, "base64"));
  if (backData) fs.writeFileSync("verify-back.png", Buffer.from(backData, "base64"));
  const shin = await panel.evaluate("window.bigcoachApp.navigate('nextShin')");
  await panel.evaluate("document.querySelector('#settings-open').click()");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const dialog = await panel.evaluate(`(()=>{const d=document.querySelector('#settings-dialog');const r=d.getBoundingClientRect();return {open:d.open,width:r.width,height:r.height,left:r.left,top:r.top}})()`);
  await panel.evaluate("document.querySelector('#settings-dialog').close()");
  console.log(JSON.stringify({
    historyCount: opened.history.length,
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
      back: /data:image\/png;base64,/.test(preview.back)
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
