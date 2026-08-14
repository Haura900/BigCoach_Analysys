const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzePayload, summarize, sigma, empiricalPercentile } = require("../docs/analyzer.js");

function entry({ p, risk, points = 6000, type = "dahai", tile = "1m", turn = 1 }) {
  const action = { type, actor: 0 };
  if (type === "dahai") action.pai = tile;
  return {
    junme: turn,
    actual: action,
    sl_outcome: [p * 0.6, p * 0.4, (1 - p) / 3, (1 - p) / 3, (1 - p) / 3],
    details: [{ action, houjuu_rate: risk, expected_win_points: points }]
  };
}

test("Bernoulli sigma uses the requested formula", () => {
  const result = sigma([{ p: 0.25, y: 1 }, { p: 0.5, y: 0 }]);
  const expected = (1 - 0.25 + 0 - 0.5) / Math.sqrt(0.25 * 0.75 + 0.5 * 0.5);
  assert.equal(result.n, 2);
  assert.ok(Math.abs(result.z - expected) < 1e-12);
});

test("analyzes deal, riichi, deal-in and point luck", () => {
  const payload = {
    engine: "Mortal",
    player_id: 0,
    review: { kyokus: [
      {
        kyoku: 0,
        honba: 0,
        entries: [
          entry({ p: 0.3, risk: 0.05, points: 6000 }),
          entry({ p: 0.45, type: "reach" }),
          entry({ p: 0.45, risk: 0.1, points: 7000, tile: "9p", turn: 8 })
        ],
        end_status: [{ type: "hora", actor: 0, target: 2, deltas: [8000, 0, -8000, 0], ura_dora: 1, yakus: ["一発"] }]
      },
      {
        kyoku: 1,
        honba: 0,
        entries: [entry({ p: 0.2, risk: 0.2, tile: "9s" })],
        end_status: [{ type: "hora", actor: 3, target: 0, deltas: [-3900, 0, 0, 3900] }]
      }
    ] }
  };
  const record = analyzePayload(payload, { title: "test" });
  const summary = summarize([record]);
  assert.equal(record.rounds.length, 2);
  assert.equal(summary.deal.n, 2);
  assert.equal(summary.riichi.n, 1);
  assert.equal(summary.riichi.observed, 1);
  assert.equal(summary.dealIn.observed, 1);
  assert.equal(summary.points.diff, 1000);
  assert.equal(summary.points.uraCount, 1);
  assert.equal(summary.points.ippatsuCount, 1);
});

test("empirical percentile uses midranks", () => {
  assert.equal(empiricalPercentile(2, [1, 2, 2, 3]), 50);
});

test("accepts data wrapper and rejects metadata-only result", () => {
  const payload = { review: { kyokus: [{ kyoku: 0, entries: [entry({ p: 0.2, risk: 0.01 })], end_status: [] }] } };
  assert.equal(analyzePayload({ data: payload }).rounds.length, 1);
  assert.throws(() => analyzePayload({ success: true, data: { jsonUrl: "/x" } }), /review\.kyokus/);
});

test("deal luck stays out of overall luck until the 30-round pool is ready", () => {
  const makeRecord = (count) => ({
    id: `r-${count}`,
    rounds: Array.from({ length: count }, (_, index) => ({
      deal: { p: 0.1 + index * 0.01, y: 0 },
      riichi: null,
      risks: [],
      points: null
    }))
  });
  const before = summarize([makeRecord(29)]);
  assert.equal(before.overall.included.some((item) => item.key === "deal"), false);
  assert.match(before.overall.excluded.find((item) => item.key === "deal").reason, /29\/30/);

  const ready = summarize([makeRecord(30)]);
  assert.equal(ready.overall.included.some((item) => item.key === "deal"), true);
  assert.ok(Math.abs(ready.overall.score - 50) < 1e-5);
});

test("deal-in luck exposes the reversed sign for display and overall luck", () => {
  const record = {
    id: "deal-in",
    rounds: [{ deal: null, riichi: null, risks: [{ p: 0.2, y: 1 }], points: null }]
  };
  const summary = summarize([record]);
  assert.ok(summary.dealIn.z > 0);
  assert.equal(summary.dealIn.luckZ, -summary.dealIn.z);
  assert.equal(summary.overall.included.find((item) => item.key === "dealIn").z, summary.dealIn.luckZ);
  assert.ok(summary.overall.score < 50);
});

test("same source game keeps a stable game id across changed model probabilities", () => {
  const makePayload = (p) => ({
    player_id: 0,
    mjai_log: [{ type: "start_game", names: ["a", "b", "c", "d"] }, { type: "dahai", actor: 0, pai: "1m" }],
    review: { kyokus: [{ kyoku: 0, entries: [entry({ p, risk: 0.01 })], end_status: [] }] }
  });
  const first = analyzePayload(makePayload(0.2));
  const second = analyzePayload(makePayload(0.8));
  assert.equal(first.gameId, second.gameId);
  assert.notEqual(first.id, second.id);
});
