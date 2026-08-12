"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { SimulatorService } = require("../src/lib/simulator");

async function main() {
  const resourcesPath = path.join(__dirname, "..", "resources");
  const service = new SimulatorService({ resourcesPath, log: console.error });
  let owned = false;
  try {
    if (!(await service.isReady())) {
      await service.ensureStarted();
      owned = true;
    }
    const scene = {
      handTiles: ["1m", "2m", "3m", "4m", "5m", "6m", "1p", "2p", "3p", "7s", "8s", "9s", "1z", "2z"],
      doraTiles: ["4p"],
      riverTiles: [],
      callTiles: [],
      selfMelds: [],
      roundWind: "1z",
      seatWind: "1z",
      currentTurn: 1
    };
    const result = await service.analyze(scene, {
      enableRedDora: true,
      enableUraDora: false,
      enableShantenDown: true,
      enableTegawari: true,
      enableRiichi: false,
      simulatorTimeoutSec: 30
    });
    if (!result.withWall.candidates.length || !result.withoutWall.candidates.length) {
      throw new Error("候補打牌が返りませんでした");
    }
    const best = result.withWall.candidates[0];
    if (!best.yakuContributions?.length) {
      throw new Error("役別Shapley寄与が返りませんでした");
    }
    if (Math.abs(best.shapleyResidual) > 0.01) {
      throw new Error(`Shapley配分が総期待値と一致しません: ${best.shapleyResidual}`);
    }
    console.log(JSON.stringify({
      withWall: result.withWall.recommendation,
      withoutWall: result.withoutWall.recommendation,
      candidates: result.withWall.candidates.length,
      shapleyRoles: best.yakuContributions.length,
      shapleyResidual: best.shapleyResidual
    }));
  } finally {
    if (owned) service.stop();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
