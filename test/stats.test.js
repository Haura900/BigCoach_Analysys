const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRoundRecords,
  mergeRoundRecords,
  summarizeRecords,
  buildTrend
} = require("../src/lib/stats");

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

test("解析ごとの率と重複除外した通算率の推移を作る", () => {
  const settings = { shinMistakeThreshold: 0.1 };
  const first = buildRoundRecords([decision], "url1");
  first[0].recordedAt = "2026-06-01T00:00:00.000Z";
  const secondDecision = {
    ...decision,
    initialHands: ["234m", "567p", "789s", "222z"],
    isBad: false
  };
  const second = buildRoundRecords([secondDecision], "url2");
  second[0].recordedAt = "2026-06-02T00:00:00.000Z";
  const merged = mergeRoundRecords(mergeRoundRecords(null, first), second);
  const trend = buildTrend(merged, settings);
  assert.equal(trend.length, 2);
  assert.equal(trend[0].current.rate, 1);
  assert.equal(trend[1].current.rate, 0);
  assert.equal(trend[1].cumulative.rate, 0.5);
});
