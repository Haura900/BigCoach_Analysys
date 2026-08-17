"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  doraFromIndicator,
  predictedOpponentPoints,
  buildDefensiveEngineInput,
  applyDamaWinBonus,
  sceneForCallAction,
  callFutureRiskEv,
  isEvReviewCandidate
} = require("../src/lib/ev-model");

const scene = {
  handTiles: ["1m", "2m", "3m", "5p", "5p", "6p", "7p", "8p", "1s", "2s", "3s", "5z", "5z", "9s"],
  riverTiles: ["2p"],
  callTiles: ["3p", "4p", "5p"],
  selfCallTiles: [],
  selfMelds: [],
  doraTiles: ["4p"],
  currentTurn: 12,
  actualDiscard: "9s",
  candidates: [
    { tile: "9s", dealInRate: 0.08, dealInByOpponent: [0.08, 0, 0] },
    { tile: "1m", dealInRate: 0.01, dealInByOpponent: [0.01, 0, 0] }
  ],
  opponents: [
    { mode: "riichi", dealer: true, openMeldCount: 0, exposedDoraCount: 0, confirmedHan: 0 },
    { mode: "open", dealer: false, openMeldCount: 2, exposedDoraCount: 1, confirmedHan: 2 },
    { mode: "dama", dealer: false, openMeldCount: 0, exposedDoraCount: 0, confirmedHan: 0 }
  ]
};

test("indicator conversion handles suits, winds and dragons", () => {
  assert.equal(doraFromIndicator("9m"), "1m");
  assert.equal(doraFromIndicator("4z"), "1z");
  assert.equal(doraFromIndicator("7z"), "5z");
});

test("defensive engine input carries state multipliers and candidate-specific loss", () => {
  const input = buildDefensiveEngineInput(scene);
  assert.equal(input.enable_situational_hazard, true);
  assert.equal(input.opponent_riichi_count, 1);
  assert.equal(input.opponent_two_meld_count, 1);
  assert.equal(input.deal_in_probability[26], 0.08);
  assert.ok(input.deal_in_value[26] >= 7000);
  assert.equal(input.deal_in_probability.length, 37);
  assert.equal(input.tenpai_payment, 1500);
});

test("confirmed han creates a floor and dama bonus preserves additive EV", () => {
  const points = predictedOpponentPoints(
    { mode: "open", dealer: false, confirmedHan: 4, exposedDoraCount: 0 },
    scene,
    "1m",
    undefined
  );
  assert.ok(points >= 7700);
  const adjusted = applyDamaWinBonus({ winProbability: 0.2, winEv: 1000, dealInEv: -200, tenpaiEv: 300 }, true);
  assert.equal(adjusted.winProbability, 0.256);
  assert.equal(adjusted.totalEv, adjusted.winEv + adjusted.dealInEv + adjusted.tenpaiEv);
});

test("call comparison removes consumed tiles and applies only future generic risk", () => {
  const after = sceneForCallAction(scene, { type: "pon", pai: "5z", consumed: ["5z", "5z"] });
  assert.equal(after.handTiles.length, scene.handTiles.length - 2);
  assert.equal(after.selfMelds.length, 1);
  assert.deepEqual(after.candidates, []);
  assert.ok(callFutureRiskEv(scene, true) < callFutureRiskEv(scene, false));
});

test("EV review threshold handles red fives and distinct call shapes", () => {
  const base = {
    actualDiscard: "0m",
    recommendedDiscard: "4p",
    candidates: [{ tile: "5m", value: 0.0008 }]
  };
  assert.equal(isEvReviewCandidate(base, 0.001), true);
  assert.equal(isEvReviewCandidate(base, 0.0005), false);
  assert.equal(isEvReviewCandidate({ ...base, recommendedDiscard: "5m" }, 0.001), false);

  const call = {
    ...base,
    actualDiscard: "CHI 4p",
    recommendedDiscard: "CHI 4p",
    candidates: [{
      tile: "CHI 4p",
      value: 0.0001,
      action: { type: "chi", pai: "4p", consumed: ["2p", "3p"] }
    }],
    decisionActions: {
      actual: { type: "chi", pai: "4p", consumed: ["2p", "3p"] },
      recommended: { type: "chi", pai: "4p", consumed: ["3p", "5p"] }
    }
  };
  assert.equal(isEvReviewCandidate(call, 0.001), true);
});
