"use strict";

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
  if (!reviewUrl) throw new Error("Usage: node scripts/verify-packaged-app.js <debug-port> <review-url>");

  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const bigCoachTarget = targets.find((item) =>
    item.url.startsWith("https://gokujan.com") || item.url.startsWith("https://review.bigcoach.work"));
  const panelTarget = targets.find((item) => item.url.includes("/src/renderer/index.html"));
  if (!bigCoachTarget || !panelTarget) throw new Error("Required Electron targets not found");

  const bigCoach = await connect(bigCoachTarget.webSocketDebuggerUrl);
  const panel = await connect(panelTarget.webSocketDebuggerUrl);
  try {
    const opened = await panel.evaluate(`window.bigcoachApp.openReviewUrl(${JSON.stringify(reviewUrl)})`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const scene = await panel.evaluate("window.bigcoachApp.refreshScene()");
    const simulation = await panel.evaluate("window.bigcoachApp.runSimulation()");
    const preview = await panel.evaluate("window.bigcoachApp.previewCard({ memo: 'verification', frontNote: 'verification' })");
    const status = await bigCoach.evaluate(`({
      url: location.href,
      textLength: document.body.innerText.length
    })`);
    console.log(JSON.stringify({
      openedHistoryCount: opened.history?.length || 0,
      scene: {
        roundText: scene.roundText,
        turn: scene.currentTurn,
        hand: scene.handMpsz,
        actual: scene.actualDiscard,
        recommended: scene.recommendedDiscard
      },
      simulation: simulation.comparison,
      preview: {
        hasFrontImage: /data:image\/png;base64,/.test(preview.front),
        hasBackImage: /data:image\/png;base64,/.test(preview.back),
        duplicateCount: preview.duplicates?.length || 0
      },
      status
    }, null, 2));
  } finally {
    bigCoach.close();
    panel.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
