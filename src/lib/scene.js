"use strict";

const crypto = require("node:crypto");
const { codesToMpsz, buildMelds } = require("./tiles");

function parseWind(text, fallback = "1z") {
  const source = String(text || "").toLowerCase();
  if (source.includes("東") || source.includes("东") || source.includes("east")) return "1z";
  if (source.includes("南") || source.includes("south")) return "2z";
  if (source.includes("西") || source.includes("west")) return "3z";
  if (source.includes("北") || source.includes("north")) return "4z";
  return fallback;
}

function parseRemainingTiles(tilesLeftText) {
  const match = String(tilesLeftText || "").match(/\d+/);
  if (!match) return null;
  const remaining = Number(match[0]);
  return Number.isFinite(remaining) ? Math.max(0, Math.min(70, Math.round(remaining))) : null;
}

function parseTurn(tilesLeftText, explicitTurn) {
  const explicit = Number(explicitTurn);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(18, Math.round(explicit));
  const remaining = parseRemainingTiles(tilesLeftText);
  if (remaining != null) return Math.max(1, Math.min(18, 18 - Math.floor(remaining / 4)));
  return 1;
}

function subtractTiles(base, subtract) {
  const remaining = [...(base || [])];
  for (const tile of subtract || []) {
    const index = remaining.indexOf(tile);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

function normalizeScene(raw, url) {
  const handTiles = [...(raw.handTiles || [])];
  const callsBySeat = raw.callsBySeat || [[], [], [], []];
  const claimedBySeat = raw.claimedBySeat || [[], [], [], []];
  const discardsBySeat = raw.discardsBySeat || [[], [], [], []];
  const callTiles = Array.isArray(raw.callTiles) ? [...raw.callTiles] : callsBySeat.flat();
  const opponentCallTiles = Array.isArray(raw.opponentCallTiles)
    ? [...raw.opponentCallTiles]
    : callsBySeat.slice(1).flat();
  const claimedTiles = claimedBySeat.flat();
  const riverTiles = Array.isArray(raw.riverTiles)
    ? [...raw.riverTiles]
    : subtractTiles(discardsBySeat.flat(), claimedTiles);
  const selfCallTiles = Array.isArray(raw.selfCallTiles) ? [...raw.selfCallTiles] : (callsBySeat[0] || []);
  const roundText = raw.roundText || "";
  const seatText = raw.seatText || "";
  const candidates = normalizeCandidates(raw.candidates || []);
  const actualDiscard = raw.actualDiscard || null;
  const recommendedDiscard = raw.recommendedDiscard || candidates[0]?.tile || null;
  const remainingTiles = parseRemainingTiles(raw.tilesLeftText);
  const currentTurn = parseTurn(raw.tilesLeftText, raw.turn ?? raw.currentTurn);
  const handsBySeat = Array.isArray(raw.handsBySeat) ? raw.handsBySeat : [];
  const identitySeed = JSON.stringify({
    url,
    roundText,
    seatText,
    currentTurn,
    remainingTiles,
    handTiles,
    handsBySeat,
    selfCallTiles,
    actualDiscard
  });
  const sceneId = crypto.createHash("sha256").update(identitySeed).digest("hex").slice(0, 20);

  return {
    sceneId,
    url,
    title: raw.title || "BigCoach",
    selfSeat: raw.selfSeat || null,
    handTiles,
    handMpsz: codesToMpsz(handTiles),
    drawTile: raw.drawTile || (handTiles.length % 3 === 2 ? handTiles.at(-1) : null),
    discardsBySeat,
    callsBySeat,
    claimedBySeat,
    riverTiles,
    callTiles,
    opponentCallTiles,
    selfCallTiles,
    selfMelds: Array.isArray(raw.selfMelds) ? raw.selfMelds : buildMelds(selfCallTiles),
    doraTiles: [...(raw.doraTiles || [])],
    roundText,
    honba: raw.honba ?? null,
    seatText,
    actorText: raw.actorText || seatText,
    roundWind: raw.roundWind || parseWind(roundText, "1z"),
    seatWind: raw.seatWind || parseWind(seatText, "1z"),
    tilesLeftText: raw.tilesLeftText || "",
    currentTurn,
    remainingTiles,
    scores: raw.scores || [],
    actualDiscard,
    recommendedDiscard,
    candidates,
    dealInRisk: raw.dealInRisk || { opponents: [], combined: [] },
    aiSummary: raw.aiSummary || "",
    judgmentType: raw.judgmentType || "discard",
    handsBySeat,
    shanten: raw.shanten == null ? null : Number(raw.shanten),
    atSelfRiichi: Boolean(raw.atSelfRiichi),
    ownRiichiMoment: Boolean(raw.ownRiichiMoment),
    opponentRiichi: Boolean(raw.opponentRiichi),
    sourcePosition: raw.sourcePosition || null,
    missing: [],
    diagnostics: raw.diagnostics || {}
  };
}

function normalizeCandidates(candidates) {
  return candidates
    .map((item) => ({
      tile: item.tile || null,
      value: item.value != null && Number.isFinite(Number(item.value)) ? Number(item.value) : null,
      qValue: item.qValue != null && Number.isFinite(Number(item.qValue)) ? Number(item.qValue) : null,
      label: item.label || "",
      raw: item.raw || ""
    }))
    .filter((item) => item.tile);
}

function validateScene(scene) {
  const missing = [];
  if (!scene.handTiles.length) missing.push("手牌");
  if (scene.handsBySeat.length !== 4 || scene.handsBySeat.some((hand) => !hand.length)) missing.push("4人分の手牌");
  if (!scene.doraTiles.length) missing.push("ドラ表示牌");
  if (!scene.roundText) missing.push("何局・本場");
  if (!scene.seatText) missing.push("自風・手番");
  if (!scene.tilesLeftText && !scene.currentTurn) missing.push("巡目");
  if (!scene.scores.length) missing.push("点数状況");
  if (!scene.actualDiscard) missing.push("実打");
  if (!scene.recommendedDiscard) missing.push("BigCoach推奨打牌");
  if (!scene.candidates.length) missing.push("BigCoach候補打牌と評価値");
  return { ...scene, missing };
}

function shinMistake(scene, settings) {
  const threshold = Number(settings.shinMistakeThreshold ?? 0.001);
  const actual = scene.candidates.find((candidate) => candidate.tile === scene.actualDiscard);
  const best = scene.candidates.find((candidate) => candidate.tile === scene.recommendedDiscard) || scene.candidates[0];
  if (!scene.actualDiscard || !best || scene.actualDiscard === best.tile) {
    return { enabled: Boolean(scene.actualDiscard && best), isShin: false, gap: 0, reason: "実打と推奨が一致" };
  }
  if (actual?.value != null && best.value != null) {
    const gap = best.value - actual.value;
    return {
      enabled: true,
      isShin: gap >= threshold,
      gap,
      reason: `BigCoach評価差 ${gap.toFixed(4)}（基準 ${threshold}）`
    };
  }
  return {
    enabled: false,
    isShin: false,
    gap: null,
    reason: "実打と推奨の評価値を取得できないため判定できません"
  };
}

module.exports = { parseWind, parseRemainingTiles, parseTurn, normalizeScene, validateScene, shinMistake };
