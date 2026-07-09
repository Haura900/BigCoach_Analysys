"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateHandScore, roughDoraParts, countsFromTiles, redFiveCountsFromTiles } = require("../src/lib/hand-score");

test("calculates the shanten-free rough score with default weights", () => {
  const result = calculateHandScore({
    handTiles: ["1m", "2m", "3m", "4m", "5m", "6m", "2p", "2p", "7s", "8s", "9s", "5z", "5z"],
    doraTiles: ["7z"],
    roundWind: "1z",
    seatWind: "1z"
  });

  assert.equal(result.mentsuCount, 3);
  assert.equal(result.toitsuCount, 2);
  assert.equal(result.yakuhaiPairs, 1);
  assert.equal(result.nonYakuhaiPairs, 1);
  assert.equal(result.doraSingleCount, 2);
  assert.equal(result.doraPairCount, 1);
  assert.equal(result.doraPoints, 16);
  assert.equal(result.dealerBonus, 10);
  assert.equal(result.score, 65);
});

test("counts a red five plus matching dora indicator as double dora", () => {
  const handTiles = ["0s", "1m", "2m", "3m", "4m", "5m", "6m", "1p", "2p", "3p", "1z", "1z", "1z"];
  const parts = roughDoraParts(countsFromTiles(handTiles), redFiveCountsFromTiles(handTiles), ["4s"]);
  const result = calculateHandScore({ handTiles, doraTiles: ["4s"] });

  assert.deepEqual(parts, { doraSingleCount: 2, doraPairCount: 1 });
  assert.equal(result.doraPoints, 16);
});

test("allows score settings to be changed", () => {
  const scene = {
    handTiles: ["1m", "2m", "3m", "4m", "5m", "6m", "2p", "2p", "7s", "8s", "9s", "5z", "5z"],
    doraTiles: ["7z"],
    roundWind: "1z",
    seatWind: "1z"
  };
  const normal = calculateHandScore(scene);
  const changed = calculateHandScore(scene, {
    handScoreDealerBonus: 30,
    handScoreDoraPair: 20
  });

  assert.equal(changed.score, normal.score + 36);
});
