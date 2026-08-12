"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SimulatorService, aggregateYakuContributions } = require("../src/lib/simulator");

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
  currentTurn: 1,
  remainingTiles: 69
};

test("new simulator payload enables exact Shapley and maps tsumo share to ron rate", () => {
  const payload = service().buildPayload(scene, {
    enableRedDora: true,
    enableUraDora: true,
    enableShantenDown: true,
    enableTegawari: true,
    enableRiichi: true,
    enableCalls: true,
    tsumoWinSharePercent: 30
  }, false);

  assert.equal(payload.version, "0.9.8");
  assert.equal(payload.game_mode, 1);
  assert.equal(payload.calc_stats, true);
  assert.equal(payload.calc_yaku_stats, true);
  assert.equal(payload.calc_shapley_stats, true);
  assert.ok(Math.abs(payload.ron_rate - 0.7) < 1e-12);
  assert.equal(payload.remaining_tiles, 69);
  assert.equal(payload.enable_riichi, true);
  assert.equal(payload.enable_calls, true);
  assert.equal(payload.enable_turn_yaku, true);
  assert.equal(payload.auto_disable_deep_search, true);
  assert.equal("hand_tiles" in payload, false);
});

test("all simulator settings map to their engine request fields", () => {
  const hazards = [
    0.02, 0.08, 0.29, 0.78, 1.70, 3.05, 4.67, 6.44, 8.23,
    9.75, 11.08, 12.12, 12.76, 13.12, 13.23, 13.09, 11.70, 5.62
  ];
  const payload = service().buildPayload({ ...scene, shanten: 3 }, {
    enableRedDora: false,
    enableUraDora: true,
    enableShantenDown: true,
    enableTegawari: false,
    autoDisableDeepSearch: false,
    enableRiichi: true,
    enableOtherWinStop: true,
    otherWinHazardPercent: hazards,
    tsumoWinSharePercent: 37
  }, false);

  assert.equal(payload.enable_reddora, false);
  assert.equal(payload.enable_uradora, true);
  assert.equal(payload.enable_shanten_down, true);
  assert.equal(payload.enable_tegawari, false);
  assert.equal(payload.auto_disable_deep_search, false);
  assert.equal(payload.enable_riichi, true);
  assert.equal(payload.enable_other_win_stop, true);
  assert.equal(payload.other_win_hazard.length, 18);
  assert.equal(payload.other_win_hazard[0], 0.0002);
  assert.ok(Math.abs(payload.other_win_hazard[16] - 0.117) < 1e-12);
  assert.ok(Math.abs(payload.other_win_hazard[17] - 0.117) < 1e-12);
  assert.ok(Math.abs(payload.ron_rate - 0.63) < 1e-12);
});

test("concealed kan is sent as ankan with all four tiles", () => {
  const ankanScene = {
    ...scene,
    handTiles: ["1m", "2m", "3m", "4m", "5m", "6m", "1s", "2s", "3s", "5z", "5z"],
    selfCallTiles: ["9p", "9p", "9p", "9p"],
    callTiles: ["9p", "9p", "9p", "9p"],
    selfMelds: [{ type: 2, tiles: [17, 17, 17, 17] }]
  };
  const payload = service().buildPayload(ankanScene, {
    enableRedDora: true,
    enableUraDora: true,
    enableShantenDown: true,
    enableTegawari: true,
    enableRiichi: true,
    tsumoWinSharePercent: 30
  }, false);

  assert.deepEqual(payload.melds, [{ type: 2, tiles: [17, 17, 17, 17] }]);
});

test("four shanten and deeper force shanten-down and tegawari off", () => {
  const settings = {
    enableShantenDown: true,
    enableTegawari: true
  };
  const fourShanten = service().buildPayload({ ...scene, shanten: 4 }, settings, false);
  const threeShanten = service().buildPayload({ ...scene, shanten: 3 }, settings, false);

  assert.equal(fourShanten.enable_shanten_down, false);
  assert.equal(fourShanten.enable_tegawari, false);
  assert.equal(threeShanten.enable_shanten_down, true);
  assert.equal(threeShanten.enable_tegawari, true);
});

test("deep-search auto-disable can be opted out", () => {
  const payload = service().buildPayload({ ...scene, shanten: 4 }, {
    enableShantenDown: true,
    enableTegawari: true,
    autoDisableDeepSearch: false
  }, false);

  assert.equal(payload.auto_disable_deep_search, false);
  assert.equal(payload.enable_shanten_down, true);
  assert.equal(payload.enable_tegawari, true);
});

test("new top-level response exposes additive yaku allocation", () => {
  const result = service().parse({
    success: true,
    config: {
      enable_reddora: true,
      enable_uradora: false,
      enable_shanten_down: true,
      enable_tegawari: false,
      auto_disable_deep_search: true,
      enable_riichi: true,
      enable_turn_yaku: true,
      ron_rate: 0.7
    },
    shanten: { all: 1 },
    searched: 42,
    stats: [{
      tile: 18,
      shanten: 1,
      necessary_tiles: [],
      exp_score: [0, 100],
      win_prob: [0, 0.5],
      tenpai_prob: [0, 0.8],
      call_prob: [0, 0.25],
      yaku_stats: [
        { yaku: 1, occurrence_prob: [0, 0.125], inclusive_score: [0, 100], marginal_score: [0, 40], shapley_score: [0, 60] },
        { yaku: 4096, occurrence_prob: [0, 0.5], inclusive_score: [0, 100], marginal_score: [0, 20], shapley_score: [0, 40] }
      ]
    }]
  }, scene);

  assert.equal(result.recommendation, "1s");
  assert.equal(result.config.enable_turn_yaku, true);
  assert.equal(result.candidates[0].expectedScore, 100);
  assert.equal(result.candidates[0].callProbability, 0.25);
  assert.equal(result.candidates[0].shapleyTotal, 100);
  assert.equal(result.candidates[0].shapleyResidual, 0);
  assert.equal(result.candidates[0].yakuChartContributions.length, 2);
  assert.deepEqual(result.candidates[0].yakuContributions.map((entry) => entry.name),
    ["門前清自摸和", "赤ドラ"]);
  assert.deepEqual(result.candidates[0].yakuContributions.map((entry) => entry.shortName),
    ["\u81ea\u6478", "\u8d64"]);
  assert.deepEqual(result.candidates[0].yakuContributions.map((entry) => entry.occurrence),
    [0.125, 0.5]);
});

test("response series is selected from remaining live-wall tiles", () => {
  const values = Array.from({ length: 19 }, (_, index) => index);
  const result = service().parse({
    success: true,
    stats: [{
      tile: 18,
      shanten: 0,
      necessary_tiles: [],
      exp_score: values.map((value) => value * 100),
      win_prob: values.map((value) => value / 100),
      tenpai_prob: values.map(() => 1),
      yaku_stats: []
    }]
  }, { ...scene, currentTurn: 16, remainingTiles: 22 });

  assert.equal(result.candidates[0].expectedScore, 1300);
  assert.equal(result.candidates[0].winProbability, 0.13);
});

test("chart keeps the top five roles and combines the rest", () => {
  const entries = [7, 6, 5, 4, 3, 2, 1].map((shapley, index) => ({
    yaku: index + 1,
    name: `役${index + 1}`,
    inclusive: shapley * 2,
    marginal: shapley / 2,
    shapley
  }));

  const chart = aggregateYakuContributions(entries);
  assert.equal(chart.length, 6);
  assert.deepEqual(chart.slice(0, 5).map((entry) => entry.shapley), [7, 6, 5, 4, 3]);
  assert.deepEqual(chart[5], {
    yaku: null,
    name: "その他",
    shortName: "\u4ed6",
    inclusive: 6,
    marginal: 1.5,
    shapley: 3,
    count: 2
  });
});
