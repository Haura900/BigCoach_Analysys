"use strict";

const { normalizeTileCode } = require("./tiles");

const SCORE_SETTING_KEYS = [
  "handScoreDoraSingle",
  "handScoreDoraPair",
  "handScoreMentsu",
  "handScoreRyanmen",
  "handScoreKanchan",
  "handScorePenchan",
  "handScoreNonYakuhaiPair",
  "handScoreExcessPair",
  "handScoreYakuhaiPair",
  "handScoreDealerBonus"
];

const DEFAULT_HAND_SCORE_SETTINGS = {
  handScoreDoraSingle: 6,
  handScoreDoraPair: 4,
  handScoreMentsu: 10,
  handScoreRyanmen: 6,
  handScoreKanchan: 1,
  handScorePenchan: 1,
  handScoreNonYakuhaiPair: 3,
  handScoreExcessPair: 1,
  handScoreYakuhaiPair: 6,
  handScoreDealerBonus: 10
};

function calculateHandScore(scene, settings = {}) {
  if (!scene?.handTiles?.length) throw new Error("Hand tiles are not available. Refresh the scene before scoring.");
  const scoreSettings = scoreSettingsFrom(settings);
  const counts = countsFromTiles(scene.handTiles);
  const redFives = redFiveCountsFromTiles(scene.handTiles);
  const decomposition = chooseDecomposition(counts);
  const doraParts = roughDoraParts(counts, redFives, scene.doraTiles || []);
  const doraPoints =
    doraParts.doraSingleCount * scoreSettings.handScoreDoraSingle +
    doraParts.doraPairCount * scoreSettings.handScoreDoraPair;
  const yakuhaiPairs = yakuhaiToitsuCount(counts, scene.roundWind, scene.seatWind);
  const nonYakuhaiPairs = Math.max(0, decomposition.toitsuCount - yakuhaiPairs);
  const firstTwoNonYakuhaiPairs = Math.min(2, nonYakuhaiPairs);
  const excessPairs = Math.max(0, nonYakuhaiPairs - 2);
  const dealerBonus = isDealer(scene.seatWind) ? scoreSettings.handScoreDealerBonus : 0;
  const score =
    decomposition.mentsuCount * scoreSettings.handScoreMentsu +
    decomposition.ryanmenCount * scoreSettings.handScoreRyanmen +
    decomposition.kanchanCount * scoreSettings.handScoreKanchan +
    decomposition.penchanCount * scoreSettings.handScorePenchan +
    firstTwoNonYakuhaiPairs * scoreSettings.handScoreNonYakuhaiPair +
    excessPairs * scoreSettings.handScoreExcessPair +
    yakuhaiPairs * scoreSettings.handScoreYakuhaiPair +
    doraPoints +
    dealerBonus;

  return {
    score,
    mentsuCount: decomposition.mentsuCount,
    toitsuCount: decomposition.toitsuCount,
    ryanmenCount: decomposition.ryanmenCount,
    kanchanCount: decomposition.kanchanCount,
    penchanCount: decomposition.penchanCount,
    badWaitCount: decomposition.kanchanCount + decomposition.penchanCount,
    nonYakuhaiPairs,
    firstTwoNonYakuhaiPairs,
    excessPairs,
    yakuhaiPairs,
    doraSingleCount: doraParts.doraSingleCount,
    doraPairCount: doraParts.doraPairCount,
    doraPoints,
    dealerBonus,
    settings: scoreSettings
  };
}

function scoreSettingsFrom(settings = {}) {
  const merged = { ...DEFAULT_HAND_SCORE_SETTINGS };
  for (const key of SCORE_SETTING_KEYS) {
    const value = Number(settings[key]);
    if (Number.isFinite(value)) merged[key] = value;
  }
  return merged;
}

function countsFromTiles(tiles) {
  const counts = Array(34).fill(0);
  for (const raw of tiles || []) counts[tileIndex(raw)] += 1;
  return counts;
}

function redFiveCountsFromTiles(tiles) {
  const counts = Array(34).fill(0);
  for (const raw of tiles || []) {
    const code = normalizeTileCode(raw);
    if (code === "0m" || code === "0p" || code === "0s") counts[tileIndex(code)] += 1;
  }
  return counts;
}

function tileIndex(raw) {
  const code = normalizeTileCode(raw);
  const rank = code[0] === "0" ? 5 : Number(code[0]);
  const suit = code[1];
  if (suit === "m") return rank - 1;
  if (suit === "p") return 9 + rank - 1;
  if (suit === "s") return 18 + rank - 1;
  return 27 + rank - 1;
}

function doraFromIndicator(index) {
  if (index < 27) {
    const suitStart = Math.floor(index / 9) * 9;
    const rank = index - suitStart;
    return suitStart + ((rank + 1) % 9);
  }
  const honor = index - 27;
  if (honor < 4) return 27 + ((honor + 1) % 4);
  return 31 + ((honor - 3) % 3);
}

function roughDoraParts(counts, redFives, indicators) {
  const doraCounts = [...redFives];
  for (const indicator of indicators || []) {
    const doraIndex = doraFromIndicator(tileIndex(indicator));
    doraCounts[doraIndex] += counts[doraIndex];
  }
  return {
    doraSingleCount: doraCounts.reduce((sum, count) => sum + count, 0),
    doraPairCount: doraCounts.filter((count) => count >= 2).length
  };
}

function isDealer(seatWind) {
  return seatWind === "1z";
}

function yakuhaiToitsuCount(counts, roundWind, seatWind) {
  const yakuhai = new Set([31, 32, 33]);
  for (const wind of [roundWind, seatWind]) {
    if (["1z", "2z", "3z", "4z"].includes(wind)) yakuhai.add(tileIndex(wind));
  }
  return [...yakuhai].filter((index) => counts[index] >= 2).length;
}

function chooseDecomposition(counts) {
  return decompose(counts).sort((a, b) => compareScore(scoreDecomposition(b), scoreDecomposition(a)))[0];
}

function scoreDecomposition(item) {
  return [
    item.mentsuCount,
    Math.min(5, item.blocks.length),
    item.ryanmenCount,
    item.toitsuCount,
    item.ryanmenCount + item.kanchanCount + item.penchanCount,
    Math.min(5, item.blocks.length + item.isolated.length)
  ];
}

function compareScore(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const decompositionCache = new Map();

function decompose(counts) {
  const key = counts.join("");
  if (decompositionCache.has(key)) return decompositionCache.get(key);
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) {
    const empty = [makeDecomposition([], [])];
    decompositionCache.set(key, empty);
    return empty;
  }
  const results = [];
  const addBlock = (kind, tiles) => {
    const next = [...counts];
    for (const tile of tiles) next[tile] -= 1;
    for (const tail of decompose(next)) results.push(makeDecomposition([{ kind, tiles }, ...tail.blocks], tail.isolated));
  };
  if (counts[first] >= 3) addBlock("mentsu", [first, first, first]);
  if (first < 27 && first % 9 <= 6 && counts[first + 1] && counts[first + 2]) addBlock("mentsu", [first, first + 1, first + 2]);
  if (counts[first] >= 2) addBlock("toitsu", [first, first]);
  if (first < 27) {
    const rank = first % 9 + 1;
    if (first % 9 <= 7 && counts[first + 1]) addBlock(2 <= rank && rank <= 7 ? "ryanmen" : "penchan", [first, first + 1]);
    if (first % 9 <= 6 && counts[first + 2]) addBlock("kanchan", [first, first + 2]);
  }
  const next = [...counts];
  next[first] -= 1;
  for (const tail of decompose(next)) results.push(makeDecomposition(tail.blocks, [first, ...tail.isolated]));
  decompositionCache.set(key, results);
  return results;
}

function makeDecomposition(blocks, isolated) {
  return {
    blocks,
    isolated,
    mentsuCount: blocks.filter((block) => block.kind === "mentsu").length,
    toitsuCount: blocks.filter((block) => block.kind === "toitsu").length,
    ryanmenCount: blocks.filter((block) => block.kind === "ryanmen").length,
    kanchanCount: blocks.filter((block) => block.kind === "kanchan").length,
    penchanCount: blocks.filter((block) => block.kind === "penchan").length
  };
}

function normalShantenNumber(counts) {
  let best = 8;
  for (const item of decompose(counts)) {
    const mentsu = item.mentsuCount;
    const toitsu = item.toitsuCount;
    const taatsu = item.ryanmenCount + item.kanchanCount + item.penchanCount;
    for (const hasHead of [0, 1]) {
      if (hasHead && !toitsu) continue;
      const usableTaatsu = Math.min(taatsu + toitsu - hasHead, Math.max(0, 4 - mentsu));
      best = Math.min(best, 8 - 2 * mentsu - usableTaatsu - hasHead);
    }
  }
  return best;
}

function chiitoiShantenNumber(counts) {
  const pairs = counts.filter((count) => count >= 2).length;
  const unique = counts.filter((count) => count > 0).length;
  return 6 - pairs + Math.max(0, 7 - unique);
}

module.exports = {
  DEFAULT_HAND_SCORE_SETTINGS,
  SCORE_SETTING_KEYS,
  calculateHandScore,
  scoreSettingsFrom,
  countsFromTiles,
  redFiveCountsFromTiles,
  roughDoraParts,
  normalShantenNumber,
  chiitoiShantenNumber
};
