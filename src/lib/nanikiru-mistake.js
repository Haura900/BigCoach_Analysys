"use strict";

const { normalizeTileCode } = require("./tiles");

function normalizedTile(code) {
  const tile = normalizeTileCode(code);
  return tile[0] === "0" ? `5${tile[1]}` : tile;
}

function doraFromIndicator(code) {
  const tile = normalizedTile(code);
  const number = Number(tile[0]);
  const suit = tile[1];
  if (suit !== "z") return `${number === 9 ? 1 : number + 1}${suit}`;
  if (number <= 4) return `${number === 4 ? 1 : number + 1}z`;
  return `${number === 7 ? 5 : number + 1}z`;
}

function findUnnecessaryTiles(handTiles, doraIndicators) {
  const hand = (handTiles || []).map(normalizedTile);
  const counts = new Map();
  for (const tile of hand) counts.set(tile, (counts.get(tile) || 0) + 1);
  const dora = new Set((doraIndicators || []).map(doraFromIndicator));
  const unnecessary = [];

  for (const tile of [...new Set(hand)]) {
    if (counts.get(tile) !== 1 || dora.has(tile)) continue;
    const number = Number(tile[0]);
    const suit = tile[1];
    if (suit === "z") {
      unnecessary.push(tile);
      continue;
    }
    const hasNearby = [-2, -1, 1, 2].some((offset) => {
      const nearby = number + offset;
      return nearby >= 1 && nearby <= 9 && counts.has(`${nearby}${suit}`);
    });
    if (!hasNearby) unnecessary.push(tile);
  }
  return unnecessary;
}

function precheckNanikiruMistake(scene) {
  if (scene.judgmentType !== "discard") {
    return { eligible: false, stage: "judgment", reason: "打牌判断ではありません", unnecessaryTiles: [] };
  }
  if (!scene.actualDiscard || !scene.recommendedDiscard ||
      scene.actualDiscard === scene.recommendedDiscard) {
    return { eligible: false, stage: "mistake", reason: "実打とAI推奨が一致しています", unnecessaryTiles: [] };
  }
  if (scene.opponentRiichi) {
    return {
      eligible: false,
      stage: "opponent-riichi",
      reason: "他家がリーチしています",
      unnecessaryTiles: []
    };
  }
  if (scene.opponentCallTiles?.length) {
    return {
      eligible: false,
      stage: "opponent-call",
      reason: "他家が副露しています",
      unnecessaryTiles: []
    };
  }
  if (!Number.isFinite(Number(scene.currentTurn)) || Number(scene.currentTurn) > 6) {
    return {
      eligible: false,
      stage: "turn",
      reason: Number.isFinite(Number(scene.currentTurn))
        ? `${scene.currentTurn}巡目のため対象外です`
        : "巡目を取得できません",
      unnecessaryTiles: []
    };
  }
  const unnecessaryTiles = findUnnecessaryTiles(scene.handTiles, scene.doraTiles);
  if (unnecessaryTiles.length) {
    return {
      eligible: false,
      stage: "unnecessary",
      reason: `不要牌があります: ${unnecessaryTiles.join(" ")}`,
      unnecessaryTiles
    };
  }
  if (!Number.isFinite(Number(scene.shanten)) || Number(scene.shanten) > 2) {
    return {
      eligible: false,
      stage: "shanten",
      reason: Number.isFinite(Number(scene.shanten))
        ? `${scene.shanten}シャンテンのため対象外です`
        : "シャンテン数を取得できません",
      unnecessaryTiles: []
    };
  }
  return {
    eligible: true,
    stage: "simulation",
    reason: "事前条件を通過しました",
    unnecessaryTiles: []
  };
}

function prefilterNanikiruDecisions(decisions) {
  return (decisions || []).filter((decision) =>
    decision.isBad &&
    decision.judgmentType === "discard" &&
    !decision.opponentRiichi &&
    Number.isFinite(Number(decision.turn)) &&
    Number(decision.turn) <= 6 &&
    Number.isFinite(Number(decision.shanten)) &&
    Number(decision.shanten) <= 2
  );
}

function classifyNanikiruMistake(scene, simulation) {
  const precheck = precheckNanikiruMistake(scene);
  if (!precheck.eligible) return { ...precheck, isNanikiruMistake: false };
  const recommendations = {
    bigCoach: scene.recommendedDiscard || null,
    withRiverAdjustment: simulation?.withWall?.recommendation || null,
    withoutRiverAdjustment: simulation?.withoutWall?.recommendation || null
  };
  const complete = Object.values(recommendations).every(Boolean);
  const unanimous = complete &&
    new Set(Object.values(recommendations)).size === 1;
  return {
    ...precheck,
    stage: "complete",
    recommendations,
    unanimous,
    isNanikiruMistake: unanimous,
    reason: !complete
      ? "3つの推奨打牌を取得できません"
      : unanimous
        ? `3つの推奨が${recommendations.bigCoach}で一致`
        : "BigCoachと2種類のシミュレーター推奨が一致しません"
  };
}

module.exports = {
  doraFromIndicator,
  findUnnecessaryTiles,
  prefilterNanikiruDecisions,
  precheckNanikiruMistake,
  classifyNanikiruMistake
};
