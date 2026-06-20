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
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const bigCoachTarget = targets.find((item) => item.url.startsWith("https://review.bigcoach.work"));
  const panelTarget = targets.find((item) => item.url.includes("/src/renderer/index.html"));
  if (!bigCoachTarget || !panelTarget) throw new Error("Required Electron targets not found");
  const bigCoach = await connect(bigCoachTarget.webSocketDebuggerUrl);
  const panel = await connect(panelTarget.webSocketDebuggerUrl);
  await bigCoach.send("Page.navigate", { url: reviewUrl });
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const first = await panel.evaluate("window.bigcoachApp.refreshScene()");
  const major = await panel.evaluate("window.bigcoachApp.listMajorMistakes()");
  if (!major.items.length) throw new Error("No major mistakes found");
  const target = major.items[Math.min(10, major.items.length - 1)];
  const jumped = await panel.evaluate(`window.bigcoachApp.goToMajorMistake(${target.mismatchOrdinal})`);
  const simulation = await panel.evaluate("window.bigcoachApp.runSimulation()");
  console.log(JSON.stringify({
    first: {
      roundText: first.roundText,
      turn: first.currentTurn,
      hand: first.handMpsz,
      actual: first.actualDiscard,
      recommended: first.recommendedDiscard
    },
    majorMistakes: major.items.length,
    jumped: {
      roundText: jumped.roundText,
      turn: jumped.currentTurn,
      actual: jumped.actualDiscard,
      recommended: jumped.recommendedDiscard,
      isMajor: jumped.majorMistake?.isMajor
    },
    simulator: simulation.comparison
  }, null, 2));
  bigCoach.close();
  panel.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
