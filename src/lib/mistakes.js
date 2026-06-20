"use strict";

function isCountable(decision) {
  return !decision.atSelfRiichi || decision.ownRiichiMoment;
}

function shinEligible(decision) {
  const hasShanten = decision.shanten != null && Number.isFinite(Number(decision.shanten));
  return isCountable(decision) &&
    ((hasShanten && Number(decision.shanten) <= 2) || Boolean(decision.opponentRiichi));
}

function majorEligible(decision) {
  const hasShanten = decision.shanten != null && Number.isFinite(Number(decision.shanten));
  return isCountable(decision) &&
    ((hasShanten && Number(decision.shanten) <= 1) || Boolean(decision.opponentRiichi));
}

function classifyShinMistake(decision, settings = {}) {
  const threshold = Number(settings.shinMistakeThreshold ?? 0.001);
  const eligible = shinEligible(decision);
  const hasProbability = Number.isFinite(decision.actualProbability);
  const isShin = eligible && decision.isBad && hasProbability &&
    decision.actualProbability <= threshold;
  return {
    ...decision,
    eligible,
    isShin,
    reason: !eligible
      ? "2シャンテン以下・聴牌・他家リーチのいずれにも該当しないか、自分のリーチ後です"
      : !decision.isBad
        ? "実打とAI推奨が一致"
        : !hasProbability
          ? "実打のAI推奨度を取得できません"
          : `実打推奨度 ${(decision.actualProbability * 100).toFixed(3)}% / 基準 ${(threshold * 100).toFixed(1)}%以下`
  };
}

function classifyMajorMistake(decision) {
  const eligible = majorEligible(decision);
  const isMajor = eligible && Boolean(decision.isBad);
  return {
    ...decision,
    eligible,
    isMajor,
    reason: !eligible
      ? "1シャンテン以下・聴牌・他家リーチのいずれにも該当しないか、自分のリーチ後です"
      : decision.isBad ? "条件内で実打とAI推奨が不一致" : "実打とAI推奨が一致"
  };
}

function listShinMistakes(decisions, settings = {}) {
  return decisions.map((item) => classifyShinMistake(item, settings)).filter((item) => item.isShin);
}

function listMajorMistakes(decisions) {
  return decisions.map(classifyMajorMistake).filter((item) => item.isMajor);
}

function calculateShinStats(decisions, settings = {}) {
  const classified = decisions.map((item) => classifyShinMistake(item, settings));
  const denominator = classified.filter((item) => item.eligible).length;
  const count = classified.filter((item) => item.isShin).length;
  return { count, denominator, rate: denominator ? count / denominator : 0 };
}

module.exports = {
  classifyShinMistake,
  classifyMajorMistake,
  listShinMistakes,
  listMajorMistakes,
  calculateShinStats,
  shinEligible,
  majorEligible
};
