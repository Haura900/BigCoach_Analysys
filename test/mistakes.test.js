const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyShinMistake,
  classifyMajorMistake,
  calculateShinStats
} = require("../src/lib/mistakes");

const base = {
  actual: "1m",
  recommended: "2m",
  isBad: true,
  actualProbability: 0.05,
  shanten: 2,
  opponentRiichi: false,
  atSelfRiichi: false,
  ownRiichiMoment: false
};

test("シン悪手は条件局面かつAI推奨度以下で判定する", () => {
  assert.equal(classifyShinMistake(base, { shinMistakeThreshold: 0.1 }).isShin, true);
  assert.equal(classifyShinMistake({ ...base, actualProbability: 0.2 }, { shinMistakeThreshold: 0.1 }).isShin, false);
  assert.equal(classifyShinMistake({ ...base, shanten: 3 }).isShin, false);
  assert.equal(classifyShinMistake({ ...base, shanten: 3, opponentRiichi: true }).isShin, true);
});

test("大悪手は1シャンテン以下・聴牌・他家リーチ時の悪手", () => {
  assert.equal(classifyMajorMistake({ ...base, shanten: 1 }).isMajor, true);
  assert.equal(classifyMajorMistake({ ...base, shanten: 2 }).isMajor, false);
  assert.equal(classifyMajorMistake({ ...base, shanten: 4, opponentRiichi: true }).isMajor, true);
});

test("自分のリーチ後を除外し、リーチした瞬間は含める", () => {
  assert.equal(classifyShinMistake({ ...base, atSelfRiichi: true }).eligible, false);
  assert.equal(classifyShinMistake({ ...base, atSelfRiichi: true, ownRiichiMoment: true }).eligible, true);
});

test("シン悪手率を分子・分母で計算する", () => {
  const stats = calculateShinStats([
    base,
    { ...base, actualProbability: 0.5 },
    { ...base, shanten: 4 }
  ], { shinMistakeThreshold: 0.1 });
  assert.deepEqual(stats, { count: 1, denominator: 2, rate: 0.5 });
});
