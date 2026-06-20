"use strict";

function classifyMajorMistake(mistake, settings = {}) {
  const minQGap = Number(settings.majorMistakeQGap ?? 2);
  const maxProbability = Number(settings.majorMistakeMaxProbability ?? 0.01);
  const hasMetrics = Number.isFinite(mistake.qGap) && Number.isFinite(mistake.actualProbability);
  const isMajor = hasMetrics &&
    mistake.actual !== mistake.recommended &&
    mistake.qGap >= minQGap &&
    mistake.actualProbability <= maxProbability;
  return {
    ...mistake,
    isMajor,
    reason: hasMetrics
      ? `Q差 ${mistake.qGap.toFixed(3)} / 実打確率 ${(mistake.actualProbability * 100).toFixed(4)}%`
      : "Q値または実打確率を取得できません"
  };
}

function listMajorMistakes(mistakes, settings = {}) {
  return mistakes.map((item) => classifyMajorMistake(item, settings)).filter((item) => item.isMajor);
}

module.exports = { classifyMajorMistake, listMajorMistakes };
