"use strict";

const crypto = require("node:crypto");
const { calculateShinStats } = require("./mistakes");

function roundKey(initialHands) {
  const canonical = (initialHands || []).map((hand) => String(hand)).join("|");
  return canonical
    ? crypto.createHash("sha256").update(canonical).digest("hex")
    : null;
}

function buildRoundRecords(decisions, sourceUrl) {
  const grouped = new Map();
  for (const decision of decisions || []) {
    const key = roundKey(decision.initialHands);
    if (!key) continue;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        initialHands: decision.initialHands,
        roundText: decision.roundText,
        sourceUrl,
        recordedAt: new Date().toISOString(),
        decisions: []
      });
    }
    grouped.get(key).decisions.push({
      shanten: decision.shanten,
      opponentRiichi: decision.opponentRiichi,
      atSelfRiichi: decision.atSelfRiichi,
      ownRiichiMoment: decision.ownRiichiMoment,
      isBad: decision.isBad,
      actualProbability: decision.actualProbability
    });
  }
  return [...grouped.values()];
}

function mergeRoundRecords(existing, records) {
  const rounds = { ...(existing?.rounds || {}) };
  for (const record of records) rounds[record.key] = record;
  const analyses = { ...(existing?.analyses || deriveAnalyses(rounds)) };
  const roundKeys = [...new Set(records.map((record) => record.key).filter(Boolean))].sort();
  if (roundKeys.length) {
    const key = crypto.createHash("sha256").update(roundKeys.join("|")).digest("hex");
    if (!analyses[key]) {
      analyses[key] = {
        key,
        sourceUrl: records[0]?.sourceUrl || "",
        recordedAt: records[0]?.recordedAt || new Date().toISOString(),
        roundKeys
      };
    }
  }
  return { version: 2, rounds, analyses };
}

function summarizeRecords(records, settings) {
  const decisions = records.flatMap((record) => record.decisions || []);
  return calculateShinStats(decisions, settings);
}

function deriveAnalyses(rounds) {
  const grouped = new Map();
  for (const record of Object.values(rounds || {})) {
    const groupKey = record.sourceUrl || `legacy:${String(record.recordedAt || "").slice(0, 10)}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        sourceUrl: record.sourceUrl || "",
        recordedAt: record.recordedAt || new Date(0).toISOString(),
        roundKeys: []
      });
    }
    const group = grouped.get(groupKey);
    group.roundKeys.push(record.key);
    if (String(record.recordedAt || "") < group.recordedAt) group.recordedAt = record.recordedAt;
  }
  const analyses = {};
  for (const group of grouped.values()) {
    group.roundKeys = [...new Set(group.roundKeys)].sort();
    const key = crypto.createHash("sha256").update(group.roundKeys.join("|")).digest("hex");
    analyses[key] = { key, ...group };
  }
  return analyses;
}

function buildTrend(statsStore, settings) {
  const rounds = statsStore?.rounds || {};
  const analyses = Object.values(statsStore?.analyses || deriveAnalyses(rounds))
    .sort((left, right) => String(left.recordedAt).localeCompare(String(right.recordedAt)));
  const cumulativeKeys = new Set();
  return analyses.map((analysis) => {
    const analysisRecords = analysis.roundKeys.map((key) => rounds[key]).filter(Boolean);
    for (const key of analysis.roundKeys) {
      if (rounds[key]) cumulativeKeys.add(key);
    }
    const current = summarizeRecords(analysisRecords, settings);
    const cumulative = summarizeRecords([...cumulativeKeys].map((key) => rounds[key]), settings);
    return {
      key: analysis.key,
      sourceUrl: analysis.sourceUrl,
      recordedAt: analysis.recordedAt,
      rounds: analysisRecords.length,
      current,
      cumulative
    };
  });
}

module.exports = {
  roundKey,
  buildRoundRecords,
  mergeRoundRecords,
  summarizeRecords,
  deriveAnalyses,
  buildTrend
};
