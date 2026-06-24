"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  doraFromIndicator,
  findUnnecessaryTiles,
  prefilterNanikiruDecisions,
  precheckNanikiruMistake,
  classifyNanikiruMistake
} = require("../src/lib/nanikiru-mistake");

const baseScene = {
  judgmentType: "discard",
  actualDiscard: "9m",
  recommendedDiscard: "3p",
  handTiles: ["1m", "2m", "3m", "4m", "5m", "6m", "2p", "3p", "4p", "5s", "6s", "7s", "2z", "2z"],
  doraTiles: ["1z"],
  opponentCallTiles: [],
  opponentRiichi: false,
  currentTurn: 6,
  shanten: 2
};

test("ドラ表示牌から実ドラを求める", () => {
  assert.equal(doraFromIndicator("9m"), "1m");
  assert.equal(doraFromIndicator("4z"), "1z");
  assert.equal(doraFromIndicator("7z"), "5z");
});

test("孤立字牌と孤立数牌を不要牌とし、対子とドラは除外する", () => {
  assert.deepEqual(findUnnecessaryTiles(["1m", "4m", "7z"], []), ["1m", "4m", "7z"]);
  assert.deepEqual(findUnnecessaryTiles(["1m", "1m", "4m", "7z"], ["3m", "6z"]), []);
});

test("高速な事前条件を順番に判定する", () => {
  assert.equal(precheckNanikiruMistake({ ...baseScene, actualDiscard: "3p" }).stage, "mistake");
  assert.equal(precheckNanikiruMistake({ ...baseScene, opponentRiichi: true }).stage, "opponent-riichi");
  assert.equal(precheckNanikiruMistake({ ...baseScene, opponentCallTiles: ["1z", "1z", "1z"] }).stage, "opponent-call");
  assert.equal(precheckNanikiruMistake({ ...baseScene, handTiles: [...baseScene.handTiles.slice(0, -2), "7z", "2z"] }).stage, "unnecessary");
  assert.equal(precheckNanikiruMistake({ ...baseScene, shanten: 3 }).stage, "shanten");
  assert.equal(precheckNanikiruMistake(baseScene).stage, "simulation");
});

test("不要牌が1枚だけでAI推奨打牌なら対象に含める", () => {
  const oneUnnecessary = {
    ...baseScene,
    handTiles: ["1m", "2m", "3m", "4m", "5m", "6m", "2p", "3p", "4p", "5s", "6s", "7s", "2z", "7z"],
    recommendedDiscard: "7z"
  };
  const allowed = precheckNanikiruMistake(oneUnnecessary);
  assert.equal(allowed.stage, "simulation");
  assert.equal(allowed.recommendedIsOnlyUnnecessary, true);
  assert.deepEqual(allowed.unnecessaryTiles, ["7z"]);

  assert.equal(precheckNanikiruMistake({
    ...oneUnnecessary,
    recommendedDiscard: "3p"
  }).stage, "unnecessary");

  assert.equal(precheckNanikiruMistake({
    ...oneUnnecessary,
    handTiles: [...oneUnnecessary.handTiles.slice(0, -2), "1z", "7z"]
  }).stage, "unnecessary");
});

test("解析全体はシミュレーター前に打牌ミス・他家リーチなし・2シャンテン以下で絞る", () => {
  const decisions = [
    { isBad: true, judgmentType: "discard", shanten: 2, turn: 6, opponentRiichi: false, id: "target" },
    { isBad: false, judgmentType: "discard", shanten: 2, turn: 6, opponentRiichi: false, id: "correct" },
    { isBad: true, judgmentType: "call", shanten: 2, turn: 6, opponentRiichi: false, id: "call" },
    { isBad: true, judgmentType: "discard", shanten: 3, turn: 6, opponentRiichi: false, id: "far" },
    { isBad: true, judgmentType: "discard", shanten: 2, turn: 18, opponentRiichi: false, id: "late" },
    { isBad: true, judgmentType: "discard", shanten: 2, turn: 6, opponentRiichi: true, id: "riichi" }
  ];
  assert.deepEqual(prefilterNanikiruDecisions(decisions).map((item) => item.id), ["target", "late"]);
});

test("AIと河補正あり・なしの推奨が一致したときだけ何切る悪手", () => {
  const unanimous = {
    withWall: { recommendation: "3p" },
    withoutWall: { recommendation: "3p" }
  };
  assert.equal(classifyNanikiruMistake(baseScene, unanimous).isNanikiruMistake, true);
  assert.equal(classifyNanikiruMistake(baseScene, {
    ...unanimous,
    withoutWall: { recommendation: "4p" }
  }).isNanikiruMistake, false);
});
