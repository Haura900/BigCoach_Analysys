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

test("何切る悪手カードは通常カードと別の重複キーを使う", async () => {
  const service = new AnkiService({ log: () => {} });
  const queries = [];
  service.invoke = async (action, params) => {
    if (action === "findNotes") {
      queries.push(params.query);
      return [];
    }
    if (action === "deckNames") return ["BigCoach", "BigCoach::何切る悪手"];
    if (action === "modelNames") return ["基本"];
    if (action === "modelFieldNames") return ["表面", "裏面"];
    if (action === "addNote") return 123;
    return true;
  };
  const settings = {
    deckName: "BigCoach::何切る悪手",
    modelName: "基本",
    tags: []
  };
  await service.add({
    settings,
    scene: { sceneId: "scene1" },
    frontHtml: "front",
    backHtml: "back",
    duplicateMode: "skip",
    duplicatePrefix: "BigCoach_NanikiruMistake_ID",
    extraTags: ["何切る悪手"]
  });
  assert.deepEqual(queries, ["tag:BigCoach_NanikiruMistake_ID_scene1"]);
});
