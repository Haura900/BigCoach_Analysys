const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeScene, validateScene } = require("../src/lib/scene");

const raw = {
  handTiles: ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "1z", "2z", "2z", "3z"],
  discardsBySeat: [["9m"], [], [], []],
  callsBySeat: [[], [], [], []],
  claimedBySeat: [[], [], [], []],
  doraTiles: ["4m"],
  tilesLeftText: "残り 60",
  roundText: "東1局 0本場",
  seatText: "東家 25000",
  scores: ["25000", "25000", "25000", "25000"],
  actualDiscard: "9m",
  recommendedDiscard: "3z",
  candidates: [{ tile: "3z", value: 0.5 }, { tile: "9m", value: 0.3 }]
  ,handsBySeat: [
    ["1m"], ["2m"], ["3m"], ["4m"]
  ]
};

test("局面を正規化して安定IDを作る", () => {
  const scene = validateScene(normalizeScene(raw, "https://gokujan.com/review/test"));
  assert.equal(scene.handMpsz, "123m456p789s11223z");
  assert.equal(scene.currentTurn, 3);
  assert.equal(scene.remainingTiles, 60);
  assert.equal(scene.missing.length, 0);
  assert.equal(scene.sceneId.length, 20);
});

test("remaining live-wall count is retained separately from the displayed turn", () => {
  const scene = normalizeScene({ ...raw, tilesLeftText: "remaining 22", turn: 16 },
    "https://gokujan.com/review/test");
  assert.equal(scene.remainingTiles, 22);
  assert.equal(scene.currentTurn, 16);
});

test("モダン画面が返す河と副露のフラット配列を保持する", () => {
  const scene = normalizeScene({
    ...raw,
    riverTiles: ["9m", "4p"],
    callTiles: ["2s", "2s", "2s"],
    opponentCallTiles: ["2s", "2s", "2s"],
    selfCallTiles: [],
    selfMelds: []
  }, "https://gokujan.com/review/test");

  assert.deepEqual(scene.riverTiles, ["9m", "4p"]);
  assert.deepEqual(scene.callTiles, ["2s", "2s", "2s"]);
  assert.deepEqual(scene.opponentCallTiles, ["2s", "2s", "2s"]);
  assert.deepEqual(scene.selfCallTiles, []);
  assert.deepEqual(scene.selfMelds, []);
});
