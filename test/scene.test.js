const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeScene, validateScene, shinMistake } = require("../src/lib/scene");

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
};

test("局面を正規化して安定IDを作る", () => {
  const scene = validateScene(normalizeScene(raw, "https://review.bigcoach.work/?lang=ja"));
  assert.equal(scene.handMpsz, "123m456p789s11223z");
  assert.equal(scene.currentTurn, 3);
  assert.equal(scene.missing.length, 0);
  assert.equal(scene.sceneId.length, 20);
});

test("シン悪手基準を変更できる", () => {
  const scene = normalizeScene(raw, "https://review.bigcoach.work/");
  assert.equal(shinMistake(scene, { shinMistakeThreshold: 0.15 }).isShin, true);
  assert.equal(shinMistake(scene, { shinMistakeThreshold: 0.25 }).isShin, false);
});
