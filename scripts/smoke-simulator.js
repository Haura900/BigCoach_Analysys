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
    const effective = result.withWall.config;
    if (!effective.enable_reddora || effective.enable_uradora ||
        !effective.enable_shanten_down || !effective.enable_tegawari ||
        !effective.auto_disable_deep_search ||
        effective.enable_riichi || !effective.enable_turn_yaku ||
        Number(effective.ron_rate || 0) !== 0) {
      throw new Error(`設定がエンジン応答と一致しません: ${JSON.stringify(effective)}`);
    }

    const deepPayload = service.buildPayload({
      ...scene,
      handTiles: ["1m", "4m", "7m", "1p", "4p", "7p", "1s", "4s", "7s", "1z", "2z", "3z", "4z", "5z"],
      doraTiles: ["6z"]
    }, {
      enableRedDora: true,
      enableUraDora: false,
      enableShantenDown: true,
      enableTegawari: true,
      enableRiichi: false,
      tsumoWinSharePercent: 100
    }, false);
    deepPayload.calc_stats = false;
    deepPayload.enable_shanten_down = true;
    deepPayload.enable_tegawari = true;
    const deepResult = await service.request(deepPayload, 30000);
    if (Number(deepResult.shanten?.all) < 4 ||
        deepResult.config.enable_shanten_down || deepResult.config.enable_tegawari) {
      throw new Error(`4シャンテン以上の自動OFFが効いていません: ${JSON.stringify(deepResult.config)}`);
    }
    deepPayload.auto_disable_deep_search = false;
    const deepOptOut = await service.request(deepPayload, 30000);
    if (!deepOptOut.config.enable_shanten_down || !deepOptOut.config.enable_tegawari ||
        deepOptOut.config.auto_disable_deep_search) {
      throw new Error(`4シャンテン以上の自動OFFを解除できません: ${JSON.stringify(deepOptOut.config)}`);
    }

    const turnPayload = service.buildPayload({
      ...scene,
      handTiles: ["1m", "2m", "3m", "9m", "1p", "2p", "3p", "7p", "7p", "1s", "2s", "3s", "4s", "5s"],
      doraTiles: ["1z"],
      remainingTiles: 4
    }, {
      enableRedDora: true,
      enableUraDora: false,
      enableShantenDown: false,
      enableTegawari: false,
      enableRiichi: true,
      tsumoWinSharePercent: 50
    }, false);
    turnPayload.t_max = 18;
    const turnResult = await service.request(turnPayload, 30000);
    const turnStat = turnResult.stats.find((stat) => stat.tile === 8);
    const turnYaku = new Map((turnStat?.yaku_stats || []).map((entry) => [Number(entry.yaku), entry]));
    for (const yaku of [2 ** 2, 2 ** 8]) {
      if (!turnYaku.has(yaku) || Number(turnYaku.get(yaku).occurrence_prob?.[1] || 0) <= 0) {
        throw new Error(`巡目役 ${yaku} が期待値へ反映されていません`);
      }
    }
    if (turnYaku.has(2 ** 9)) {
      throw new Error("海底摸月と河底撈魚が同時に有効です");
    }
    console.log(JSON.stringify({
      withWall: result.withWall.recommendation,
      withoutWall: result.withoutWall.recommendation,
      candidates: result.withWall.candidates.length,
      shapleyRoles: best.yakuContributions.length,
      shapleyResidual: best.shapleyResidual,
      settingsConnected: true,
      deepOptionsDisabled: true,
      deepOptionsOptOut: true,
      turnYaku: ["一発", "海底摸月"]
    }));
  } finally {
    if (owned) service.stop();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
