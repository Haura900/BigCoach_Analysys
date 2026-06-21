const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { AnkiService } = require("../src/lib/anki");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("AnkiConnectへの並列要求を内部で直列化する", async () => {
  let active = 0;
  let maximum = 0;
  const server = http.createServer((_request, response) => {
    active += 1;
    maximum = Math.max(maximum, active);
    setTimeout(() => {
      active -= 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ result: true, error: null }));
    }, 25);
  });
  const port = await listen(server);
  try {
    const service = new AnkiService({ log: () => {} });
    service.url = `http://127.0.0.1:${port}`;
    await Promise.all([
      service.invoke("first"),
      service.invoke("second"),
      service.invoke("third")
    ]);
    assert.equal(maximum, 1);
  } finally {
    await close(server);
  }
});

test("AnkiConnectタイムアウトを未接続と誤表示しない", async () => {
  const server = http.createServer(() => {});
  const port = await listen(server);
  try {
    const service = new AnkiService({ log: () => {} });
    service.url = `http://127.0.0.1:${port}`;
    await assert.rejects(
      service.invoke("storeMediaFile", {}, 30),
      /storeMediaFile.*完了しませんでした/
    );
  } finally {
    server.closeAllConnections();
    await close(server);
  }
});
