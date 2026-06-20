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
  return { version: 1, rounds };
}

function summarizeRecords(records, settings) {
  const decisions = records.flatMap((record) => record.decisions || []);
  return calculateShinStats(decisions, settings);
}

module.exports = { roundKey, buildRoundRecords, mergeRoundRecords, summarizeRecords };
