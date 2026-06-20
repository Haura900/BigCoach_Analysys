const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRoundRecords, mergeRoundRecords, summarizeRecords } = require("../src/lib/stats");

const decision = {
  initialHands: ["123m", "456p", "789s", "111z"],
  roundText: "東1局",
  shanten: 2,
  opponentRiichi: false,
  atSelfRiichi: false,
  ownRiichiMoment: false,
  isBad: true,
  actualProbability: 0.05
};

test("同じ4人配牌の局は重複登録しない", () => {
  const first = buildRoundRecords([decision], "url1");
  const second = buildRoundRecords([{ ...decision }], "url2");
  const merged = mergeRoundRecords(mergeRoundRecords(null, first), second);
  assert.equal(Object.keys(merged.rounds).length, 1);
});

test("保存済み局面から通算シン悪手率を再計算する", () => {
  const records = buildRoundRecords([decision, { ...decision, isBad: false }], "url");
  assert.deepEqual(summarizeRecords(records, { shinMistakeThreshold: 0.1 }), {
    count: 1,
    denominator: 2,
    rate: 0.5
  });
});
