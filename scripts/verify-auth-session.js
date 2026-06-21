"use strict";

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const callId = ++id;
        pending.set(callId, { resolve, reject });
        socket.send(JSON.stringify({ id: callId, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function main() {
  const port = Number(process.argv[2] || 9223);
  const mode = process.argv[3] || "get";
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((item) => item.url.startsWith("https://review.bigcoach.work"));
  if (!target) throw new Error("BigCoach target not found");
  const client = await connect(target.webSocketDebuggerUrl);
  await client.send("Network.enable");
  if (mode === "set") {
    const result = await client.send("Network.setCookie", {
      name: "bigcoach_studio_session_test",
      value: "restored-after-restart",
      url: "https://api.bigcoach.work/",
      secure: true,
      httpOnly: true,
      sameSite: "None"
    });
    if (!result.success) throw new Error("Failed to set test session cookie");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const result = await client.send("Network.getAllCookies");
  const cookie = result.cookies.find((item) => item.name === "bigcoach_studio_session_test");
  console.log(JSON.stringify({ mode, found: Boolean(cookie), cookie }, null, 2));
  client.close();
  if (!cookie) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
