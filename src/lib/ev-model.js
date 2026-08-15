"use strict";

const { TILE_CODE_TO_INDEX, TILE_INDEX_TO_CODE, normalizeTileCode, codesToIndices } = require("./tiles");

const DEFAULT_EV_HYPERPARAMETERS = Object.freeze({
  hazard: Object.freeze({
    opponentRiichi: 1.65,
    opponentDoubleRiichi: 2.10,
    opponentTwoMeld: 1.35,
    selfRiichi: 1.18
  }),
  dealInPoints: Object.freeze({
    riichiChild: 6000,
    riichiDealer: 8700,
    damaChild: 4000,
    damaDealer: 6000,
    openChild: 3500,
    openDealer: 5200,
    visibleDoraDelta: -380,
    exposedDoraBonus: 1200,
    discardDoraBonus: 2500,
    lateTurnDelta: 100,
    lateTurnAnchor: 9,
    childHanFloor: Object.freeze([0, 1000, 2000, 3900, 7700, 8000]),
    dealerHanFloor: Object.freeze([0, 1500, 2900, 5800, 11600, 12000])
  }),
  tenpaiPayment: 1500,
  call: Object.freeze({
    closedDealInRate: 0.115,
    openDealInRate: 0.135,
    closedRiskMultiplier: 1.0,
    openRiskMultiplier: 1.12
  }),
  riichi: Object.freeze({
    damaWinMultiplier: 1.10,
    damaGenbutsuWinMultiplier: 1.28
  })
});

function mergeHyperparameters(overrides = {}) {
  return {
    ...DEFAULT_EV_HYPERPARAMETERS,
    ...overrides,
    hazard: { ...DEFAULT_EV_HYPERPARAMETERS.hazard, ...(overrides.hazard || {}) },
    dealInPoints: { ...DEFAULT_EV_HYPERPARAMETERS.dealInPoints, ...(overrides.dealInPoints || {}) },
    call: { ...DEFAULT_EV_HYPERPARAMETERS.call, ...(overrides.call || {}) },
    riichi: { ...DEFAULT_EV_HYPERPARAMETERS.riichi, ...(overrides.riichi || {}) }
  };
}

function normalTile(code) {
  try {
    const normalized = normalizeTileCode(code);
    return normalized[0] === "0" ? `5${normalized[1]}` : normalized;
  } catch {
    return null;
  }
}

function doraFromIndicator(indicator) {
  const code = normalTile(indicator);
  if (!code) return null;
  const number = Number(code[0]);
  const suit = code[1];
  if (suit !== "z") return `${number === 9 ? 1 : number + 1}${suit}`;
  if (number <= 4) return `${number === 4 ? 1 : number + 1}z`;
  return `${number === 7 ? 5 : number + 1}z`;
}

function countTiles(tiles, target) {
  const wanted = normalTile(target);
  return (tiles || []).reduce((sum, tile) => sum + (normalTile(tile) === wanted ? 1 : 0), 0);
}

function visibleDoraCount(scene) {
  const visible = [
    ...(scene.handTiles || []),
    ...(scene.riverTiles || []),
    ...(scene.callTiles || [])
  ];
  return (scene.doraTiles || []).reduce((sum, indicator) =>
    sum + countTiles(visible, doraFromIndicator(indicator)), 0);
}

function threatWeight(opponent) {
  if (opponent.mode === "riichi") return 2.0;
  if (Number(opponent.openMeldCount || 0) >= 2) return 1.5;
  if (opponent.mode === "open") return 1.0;
  return 0.5;
}

function predictedOpponentPoints(opponent, scene, discardTile, hyperparameters = DEFAULT_EV_HYPERPARAMETERS) {
  hyperparameters = mergeHyperparameters(hyperparameters);
  const p = hyperparameters.dealInPoints;
  const dealer = Boolean(opponent.dealer);
  const base = opponent.mode === "riichi"
    ? (dealer ? p.riichiDealer : p.riichiChild)
    : opponent.mode === "open"
      ? (dealer ? p.openDealer : p.openChild)
      : (dealer ? p.damaDealer : p.damaChild);
  const han = Math.max(0, Math.min(5, Math.floor(Number(opponent.confirmedHan || 0))));
  const floor = (dealer ? p.dealerHanFloor : p.childHanFloor)[han] || 0;
  const actualDora = (scene.doraTiles || []).map(doraFromIndicator).filter(Boolean);
  const discardIsDora = actualDora.some((tile) => normalTile(tile) === normalTile(discardTile));
  const estimate = base +
    p.visibleDoraDelta * visibleDoraCount(scene) +
    p.exposedDoraBonus * Number(opponent.exposedDoraCount || 0) +
    (discardIsDora ? p.discardDoraBonus : 0) +
    p.lateTurnDelta * Math.max(0, Number(scene.currentTurn || 1) - p.lateTurnAnchor);
  return Math.max(floor, estimate, 1000);
}

function predictedDealInPoints(scene, discardTile, hyperparameters = DEFAULT_EV_HYPERPARAMETERS, perOpponentRates = []) {
  const params = mergeHyperparameters(hyperparameters);
  const opponents = scene.opponents || [];
  if (!opponents.length) return params.dealInPoints.damaChild;
  const rates = opponents.map((opponent, index) => Number(perOpponentRates[index] || 0));
  const hasRates = rates.some((rate) => rate > 0);
  const weights = hasRates ? rates : opponents.map(threatWeight);
  const denominator = weights.reduce((sum, value) => sum + value, 0) || 1;
  return opponents.reduce((sum, opponent, index) =>
    sum + weights[index] * predictedOpponentPoints(opponent, scene, discardTile, params), 0) / denominator;
}

function candidateForTile(scene, tile) {
  const normalized = normalTile(tile);
  return (scene.candidates || []).find((candidate) => normalized
    ? normalTile(candidate.tile) === normalized
    : String(candidate.tile || "") === String(tile || ""));
}

function buildDefensiveEngineInput(scene, hyperparameters = DEFAULT_EV_HYPERPARAMETERS) {
  const params = mergeHyperparameters(hyperparameters);
  const probability = Array(37).fill(0);
  const value = Array(37).fill(0);
  for (const code of TILE_INDEX_TO_CODE) {
    const candidate = candidateForTile(scene, code);
    if (!candidate) continue;
    const index = TILE_CODE_TO_INDEX[code];
    probability[index] = Math.max(0, Math.min(1, Number(candidate.dealInRate || 0)));
    value[index] = predictedDealInPoints(scene, code, params, candidate.dealInByOpponent);
  }
  const opponents = scene.opponents || [];
  return {
    enable_situational_hazard: true,
    opponent_riichi_count: opponents.filter((opponent) => opponent.mode === "riichi").length,
    opponent_two_meld_count: opponents.filter((opponent) => Number(opponent.openMeldCount || 0) >= 2).length,
    self_riichi: Boolean(scene.atSelfRiichi || scene.ownRiichiMoment),
    hazard_multipliers: {
      opponent_riichi: params.hazard.opponentRiichi,
      opponent_double_riichi: params.hazard.opponentDoubleRiichi,
      opponent_two_meld: params.hazard.opponentTwoMeld,
      self_riichi: params.hazard.selfRiichi
    },
    enable_ev_breakdown: true,
    deal_in_probability: probability,
    deal_in_value: value,
    tenpai_payment: Number(params.tenpaiPayment)
  };
}

function applyDamaWinBonus(candidate, isGenbutsuWait, hyperparameters = DEFAULT_EV_HYPERPARAMETERS) {
  const params = mergeHyperparameters(hyperparameters);
  const multiplier = isGenbutsuWait
    ? params.riichi.damaGenbutsuWinMultiplier
    : params.riichi.damaWinMultiplier;
  const baseWinProbability = Number(candidate.winProbability || 0);
  const adjustedWinProbability = Math.min(1, baseWinProbability * multiplier);
  const ratio = baseWinProbability > 0 ? adjustedWinProbability / baseWinProbability : 1;
  const winEv = Number(candidate.winEv ?? candidate.expectedScore ?? 0) * ratio;
  const dealInEv = Number(candidate.dealInEv || 0);
  const tenpaiEv = Number(candidate.tenpaiEv || 0);
  return {
    ...candidate,
    winProbability: adjustedWinProbability,
    winEv,
    totalEv: winEv + dealInEv + tenpaiEv,
    damaWinMultiplier: multiplier
  };
}

function callFutureRiskEv(scene, isOpen, hyperparameters = DEFAULT_EV_HYPERPARAMETERS) {
  const params = mergeHyperparameters(hyperparameters);
  const rate = isOpen ? params.call.openDealInRate : params.call.closedDealInRate;
  const multiplier = isOpen ? params.call.openRiskMultiplier : params.call.closedRiskMultiplier;
  return -rate * multiplier * predictedDealInPoints(scene, null, params);
}

function removeConsumedTiles(handTiles, consumed) {
  const hand = [...(handTiles || [])];
  for (const raw of consumed || []) {
    const wanted = normalTile(raw);
    const index = hand.findIndex((tile) => normalTile(tile) === wanted);
    if (index >= 0) hand.splice(index, 1);
  }
  return hand;
}

function sceneForCallAction(scene, action) {
  if (!action || action.type === "none") {
    return { ...scene, actualDiscard: null, recommendedDiscard: null, candidates: [] };
  }
  const type = { pon: 0, chi: 1, ankan: 2, daiminkan: 3, kakan: 4 }[action.type];
  if (type == null) throw new Error(`未対応の副露です: ${action.type}`);
  const called = action.pai ? normalizeTileCode(action.pai) : null;
  const consumed = (action.consumed || []).map(normalizeTileCode);
  const meldTiles = [called, ...consumed].filter(Boolean);
  return {
    ...scene,
    handTiles: removeConsumedTiles(scene.handTiles, consumed),
    selfCallTiles: [...(scene.selfCallTiles || []), ...meldTiles],
    callTiles: [...(scene.callTiles || []), ...meldTiles],
    selfMelds: [...(scene.selfMelds || []), { type, tiles: codesToIndices(meldTiles) }],
    actualDiscard: null,
    recommendedDiscard: null,
    candidates: []
  };
}

function isOpponentGenbutsuWait(candidate, scene) {
  const waits = (candidate?.ukeire || []).map((item) => normalTile(item.tile)).filter(Boolean);
  if (!waits.length) return false;
  const genbutsu = new Set((scene.opponents || [])
    .filter((opponent) => opponent.mode === "riichi")
    .flatMap((opponent) => opponent.genbutsu || [])
    .map(normalTile).filter(Boolean));
  return waits.every((tile) => genbutsu.has(tile));
}

function actionFingerprint(action) {
  if (!action) return "";
  const consumed = (action.consumed || []).map(normalTile).filter(Boolean).sort();
  return JSON.stringify([action.type || "", normalTile(action.pai) || "", consumed]);
}

function isEvReviewCandidate(scene, threshold) {
  const actualAction = scene.decisionActions?.actual;
  const recommendedAction = scene.decisionActions?.recommended;
  const differs = actualAction || recommendedAction
    ? actionFingerprint(actualAction) !== actionFingerprint(recommendedAction)
    : normalTile(scene.actualDiscard) !== normalTile(scene.recommendedDiscard);
  if (!differs) return false;
  const actualFingerprint = actionFingerprint(actualAction);
  const actual = actualFingerprint
    ? (scene.candidates || []).find((candidate) =>
      actionFingerprint(candidate.action) === actualFingerprint)
    : candidateForTile(scene, scene.actualDiscard);
  return Number(actual?.value ?? 1) <= Number(threshold);
}

module.exports = {
  DEFAULT_EV_HYPERPARAMETERS,
  mergeHyperparameters,
  doraFromIndicator,
  visibleDoraCount,
  predictedOpponentPoints,
  predictedDealInPoints,
  buildDefensiveEngineInput,
  applyDamaWinBonus,
  callFutureRiskEv,
  sceneForCallAction,
  isOpponentGenbutsuWait,
  isEvReviewCandidate
};
