"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SimulatorService } = require("../src/lib/simulator");

function service() {
  return new SimulatorService({ resourcesPath: "C:\\unused", log: () => {} });
}

const scene = {
  handTiles: ["1m", "2m", "3m", "4m", "2p", "3p", "4p", "6p", "7p", "1s", "2s", "4s", "0s", "6s"],
  doraTiles: ["1z"],
  riverTiles: [],
  callTiles: [],
  selfMelds: [],
  roundWind: "1z",
  seatWind: "2z",
  currentTurn: 1
};

test("new simulator payload enables exact Shapley and maps tsumo share to ron rate", () => {
  const payload = service().buildPayload(scene, {
    enableRedDora: true,
    enableUraDora: true,
    enableShantenDown: true,
    enableTegawari: true,
    enableRiichi: true,
    tsumoWinSharePercent: 30
  }, false);

  assert.equal(payload.version, "0.9.8");
  assert.equal(payload.game_mode, 1);
  assert.equal(payload.calc_stats, true);
  assert.equal(payload.calc_yaku_stats, true);
  assert.equal(payload.calc_shapley_stats, true);
  assert.ok(Math.abs(payload.ron_rate - 0.7) < 1e-12);
  assert.equal(payload.enable_riichi, true);
  assert.equal("hand_tiles" in payload, false);
});

test("new top-level response exposes additive yaku allocation", () => {
  const result = service().parse({
    success: true,
    shanten: { all: 1 },
    searched: 42,
    stats: [{
      tile: 18,
      shanten: 1,
      necessary_tiles: [],
      exp_score: [0, 100],
      win_prob: [0, 0.5],
      tenpai_prob: [0, 0.8],
      yaku_stats: [
        { yaku: 1, inclusive_score: [0, 100], marginal_score: [0, 40], shapley_score: [0, 60] },
        { yaku: 4096, inclusive_score: [0, 100], marginal_score: [0, 20], shapley_score: [0, 40] }
      ]
    }]
  }, scene);

  assert.equal(result.recommendation, "1s");
  assert.equal(result.candidates[0].expectedScore, 100);
  assert.equal(result.candidates[0].shapleyTotal, 100);
  assert.equal(result.candidates[0].shapleyResidual, 0);
  assert.deepEqual(result.candidates[0].yakuContributions.map((entry) => entry.name),
    ["門前清自摸和", "赤ドラ"]);
});
