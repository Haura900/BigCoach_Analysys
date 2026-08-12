"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { codesToIndices, windToIndex, removeKnownTiles, wallCounts } = require("./tiles");
const ENGINE_LOCK = require("../../engine-lock.json");

const ENGINE_VERSION = ENGINE_LOCK.version;
const ENGINE_API_VERSION = ENGINE_LOCK.apiVersion;

const YAKU_NAMES = new Map([
  [2 ** 0, "門前清自摸和"], [2 ** 1, "立直"], [2 ** 2, "一発"],
  [2 ** 3, "断么九"], [2 ** 4, "平和"], [2 ** 5, "一盃口"],
  [2 ** 6, "槍槓"], [2 ** 7, "嶺上開花"], [2 ** 8, "海底摸月"],
  [2 ** 9, "河底撈魚"], [2 ** 10, "ドラ"], [2 ** 11, "裏ドラ"],
  [2 ** 12, "赤ドラ"], [2 ** 13, "白"], [2 ** 14, "發"], [2 ** 15, "中"],
  [2 ** 16, "自風 東"], [2 ** 17, "自風 南"], [2 ** 18, "自風 西"],
  [2 ** 19, "自風 北"], [2 ** 20, "場風 東"], [2 ** 21, "場風 南"],
  [2 ** 22, "場風 西"], [2 ** 23, "場風 北"], [2 ** 24, "二重立直"],
  [2 ** 25, "七対子"], [2 ** 26, "対々和"], [2 ** 27, "三暗刻"],
  [2 ** 28, "三色同刻"], [2 ** 29, "三色同順"], [2 ** 30, "混老頭"],
  [2 ** 31, "一気通貫"], [2 ** 32, "混全帯么九"], [2 ** 33, "小三元"],
  [2 ** 34, "三槓子"], [2 ** 35, "混一色"], [2 ** 36, "純全帯么九"],
  [2 ** 37, "二盃口"], [2 ** 38, "流し満貫"], [2 ** 39, "清一色"],
  [2 ** 40, "天和"], [2 ** 41, "地和"], [2 ** 42, "人和"],
  [2 ** 43, "緑一色"], [2 ** 44, "大三元"], [2 ** 45, "小四喜"],
  [2 ** 46, "字一色"], [2 ** 47, "国士無双"], [2 ** 48, "九蓮宝燈"],
  [2 ** 49, "四暗刻"], [2 ** 50, "清老頭"], [2 ** 51, "四槓子"],
  [2 ** 52, "四暗刻単騎"], [2 ** 53, "大四喜"], [2 ** 54, "純正九蓮宝燈"],
  [2 ** 55, "国士無双十三面"], [2 ** 56, "抜きドラ"]
]);

// Keep chart labels deliberately compact: the full name remains available in
// the tooltip and detail table, while even a narrow segment can show its role.
const YAKU_SHORT_NAMES = new Map([
  [2 ** 0, "\u81ea\u6478"], [2 ** 1, "\u7acb"], [2 ** 2, "\u4e00"],
  [2 ** 3, "\u65ad"], [2 ** 4, "\u5e73"], [2 ** 5, "\u4e00\u76c3"],
  [2 ** 6, "\u69cd"], [2 ** 7, "\u5dba"], [2 ** 8, "\u6d77"],
  [2 ** 9, "\u6cb3"], [2 ** 10, "\u30c9"], [2 ** 11, "\u88cf"],
  [2 ** 12, "\u8d64"], [2 ** 13, "\u767d"], [2 ** 14, "\u767c"],
  [2 ** 15, "\u4e2d"], [2 ** 16, "\u81ea\u6771"], [2 ** 17, "\u81ea\u5357"],
  [2 ** 18, "\u81ea\u897f"], [2 ** 19, "\u81ea\u5317"], [2 ** 20, "\u5834\u6771"],
  [2 ** 21, "\u5834\u5357"], [2 ** 22, "\u5834\u897f"], [2 ** 23, "\u5834\u5317"],
  [2 ** 24, "W\u7acb"], [2 ** 25, "\u4e03\u5bfe"], [2 ** 26, "\u5bfe\u3005"],
  [2 ** 27, "\u4e09\u6697"], [2 ** 28, "\u4e09\u523b"], [2 ** 29, "\u4e09\u8272"],
  [2 ** 30, "\u6df7\u8001"], [2 ** 31, "\u4e00\u901a"], [2 ** 32, "\u6df7\u5168"],
  [2 ** 33, "\u5c0f\u4e09"], [2 ** 34, "\u4e09\u69d3"], [2 ** 35, "\u6df7\u4e00"],
  [2 ** 36, "\u7d14\u5168"], [2 ** 37, "\u4e8c\u76c3"], [2 ** 38, "\u6e05\u4e00"]
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function yakuName(value) {
  const numeric = Number(value);
  return YAKU_NAMES.get(numeric) || `役 ${numeric}`;
}

function yakuShortName(value, name) {
  return YAKU_SHORT_NAMES.get(Number(value)) ||
    Array.from(String(name || "\u5f79")).slice(0, 2).join("");
}

function aggregateYakuContributions(entries, limit = 5) {
  const ranked = (entries || [])
    .filter((entry) => Number(entry.shapley) > 1e-9)
    .slice()
    .sort((a, b) => Number(b.shapley) - Number(a.shapley));
  const visible = ranked.slice(0, limit);
  const hidden = ranked.slice(limit);
  if (!hidden.length) return visible;
  return [...visible, {
    yaku: null,
    name: "その他",
    shortName: "\u4ed6",
    inclusive: hidden.reduce((sum, entry) => sum + Number(entry.inclusive || 0), 0),
    marginal: hidden.reduce((sum, entry) => sum + Number(entry.marginal || 0), 0),
    shapley: hidden.reduce((sum, entry) => sum + Number(entry.shapley || 0), 0),
    count: hidden.length
  }];
}

const MISSING_DLL_EXIT_CODE = 0xc0000135;

function unsignedExitCode(code) {
  return Number(code) >>> 0;
}

function formatExitCode(code) {
  return `0x${unsignedExitCode(code).toString(16).padStart(8, "0").toUpperCase()}`;
}

class SimulatorService {
  constructor({ resourcesPath, log }) {
    this.resourcesPath = resourcesPath;
    this.log = log;
    this.port = 50000;
    this.process = null;
  }

  get directory() {
    return path.join(this.resourcesPath, "simulator");
  }

  get executable() {
    return path.join(this.directory, "nanikiru.exe");
  }

  async isReady() {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: this.port });
      socket.setTimeout(400);
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("timeout", () => { socket.destroy(); resolve(false); });
      socket.on("error", () => resolve(false));
    });
  }

  async ensureStarted() {
    if (await this.isReady()) return;
    if (!fs.existsSync(this.executable)) {
      throw new Error("同梱の何切るシミュレーターが見つかりません。アプリを再インストールしてください。");
    }
    const child = spawn(this.executable, [String(this.port)], {
      cwd: this.directory,
      windowsHide: true,
      stdio: "ignore"
    });
    this.process = child;
    let spawnError = null;
    let exitResult = null;
    let ready = false;
    child.once("error", (error) => {
      spawnError = error;
      this.log(`simulator spawn error: ${error.stack || error}`);
    });
    child.once("exit", (code, signal) => {
      exitResult = { code, signal };
      if (this.process === child) this.process = null;
      if (!ready) this.log(`simulator exited before ready: code=${code}, signal=${signal || "none"}`);
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await this.isReady()) {
        ready = true;
        return;
      }
      if (spawnError) {
        throw new Error(`何切るシミュレーターを起動できませんでした: ${spawnError.message}`);
      }
      if (exitResult) {
        const { code, signal } = exitResult;
        if (code != null && unsignedExitCode(code) === MISSING_DLL_EXIT_CODE) {
          throw new Error("何切るシミュレーターに必要なDLLが見つかりません。アプリを再インストールしてください。");
        }
        const detail = code == null ? `signal ${signal || "unknown"}` : formatExitCode(code);
        throw new Error(`何切るシミュレーターが起動直後に終了しました (${detail})。詳細ログを確認してください。`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("何切るシミュレーターを起動できませんでした。詳細ログを確認してください。");
  }

  buildPayload(scene, settings, withWall) {
    if (!scene.handTiles.length) throw new Error("手牌を取得できていないため実行できません。");
    const autoDisableDeepSearch = settings.autoDisableDeepSearch !== false;
    const payload = {
      game_mode: 1,
      enable_reddora: Boolean(settings.enableRedDora),
      enable_uradora: Boolean(settings.enableUraDora),
      // The engine computes shanten from the actual hand and owns the automatic
      // deep-search cutoff. BigCoach's displayed shanten can describe a different
      // point in the review, so using it here can incorrectly remove valid routes.
      enable_shanten_down: Boolean(settings.enableShantenDown),
      enable_tegawari: Boolean(settings.enableTegawari),
      auto_disable_deep_search: autoDisableDeepSearch,
      enable_riichi: Boolean(settings.enableRiichi),
      enable_calls: Boolean(settings.enableCalls),
      enable_other_win_stop: Boolean(settings.enableOtherWinStop),
      other_win_hazard: Array.from({ length: 18 }, (_, index) =>
        clamp(Number(settings.otherWinHazardPercent?.[index] ?? 0), 0, 100) / 100),
      enable_turn_yaku: true,
      calc_stats: true,
      calc_yaku_stats: true,
      calc_shapley_stats: true,
      ron_rate: 1 - clamp(settings.tsumoWinSharePercent ?? 100, 0, 100) / 100,
      round_wind: windToIndex(scene.roundWind),
      dora_indicators: codesToIndices(scene.doraTiles),
      hand: codesToIndices(scene.handTiles),
      melds: scene.selfMelds || [],
      seat_wind: windToIndex(scene.seatWind),
      version: ENGINE_VERSION
    };
    if (Number.isInteger(scene.remainingTiles)) {
      payload.remaining_tiles = clamp(scene.remainingTiles, 0, 70);
    }
    payload.other_win_hazard[17] = payload.other_win_hazard[16];
    if (withWall) {
      const known = [
        ...scene.handTiles,
        ...scene.doraTiles,
        ...scene.riverTiles,
        ...scene.callTiles
      ];
      payload.wall = wallCounts(removeKnownTiles(known));
    }
    return payload;
  }

  async request(payload, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.err_msg || "シミュレーターが失敗を返しました");
      if (data.engine_version !== ENGINE_VERSION || data.api_version !== ENGINE_API_VERSION) {
        throw new Error(`Simulator engine mismatch: expected ${ENGINE_VERSION}/API ${ENGINE_API_VERSION}, got ${data.engine_version || "unknown"}/API ${data.api_version ?? "unknown"}`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  parse(data, scene) {
    const response = data.response || data || {};
    const shanten = response.shanten || {};
    const turn = Number.isInteger(scene.remainingTiles)
      ? clamp(18 - Math.floor(scene.remainingTiles / 4), 1, 18)
      : clamp(scene.currentTurn || 1, 1, 18);
    const candidates = (response.stats || []).flatMap((stat) => {
      try {
        const tile = require("./tiles").normalizeTileCode(stat.tile);
        const ukeire = (stat.necessary_tiles || []).flatMap((item) => {
          try {
            return [{ tile: require("./tiles").normalizeTileCode(item.tile), count: Number(item.count || 0) }];
          } catch {
            return [];
          }
        });
        const at = (values) => Number(values?.[turn] ?? 0);
        const callProbability = at(stat.call_prob);
        const callWinProbability = at(stat.call_win_prob);
        const yakuContributions = (stat.yaku_stats || []).map((entry) => {
          const name = yakuName(entry.yaku);
          return {
            yaku: Number(entry.yaku),
            name,
            shortName: yakuShortName(entry.yaku, name),
            occurrence: at(entry.occurrence_prob),
            inclusive: at(entry.inclusive_score),
            marginal: at(entry.marginal_score),
            shapley: at(entry.shapley_score)
          };
        }).filter((entry) => entry.occurrence > 1e-12 || Math.abs(entry.inclusive) > 1e-9 ||
          Math.abs(entry.marginal) > 1e-9 || Math.abs(entry.shapley) > 1e-9)
          .sort((a, b) => b.shapley - a.shapley);
        const calledYakuContributions = callProbability > 1e-12
          ? (stat.yaku_stats || []).map((entry) => {
            const name = yakuName(entry.yaku);
            return {
              yaku: Number(entry.yaku),
              name,
              shortName: yakuShortName(entry.yaku, name),
              occurrence: at(entry.called_occurrence_prob) / callProbability,
              shapley: at(entry.called_shapley_score) / callProbability
            };
          }).filter((entry) => entry.occurrence > 1e-12 || Math.abs(entry.shapley) > 1e-9)
            .sort((a, b) => b.shapley - a.shapley)
          : [];
        const callTileRates = callProbability > 1e-12
          ? (stat.call_tile_stats || []).map((entry) => ({
            tile: require("./tiles").normalizeTileCode(entry.tile),
            probability: at(entry.probability),
            conditionalProbability: at(entry.probability) / callProbability
          })).filter((entry) => entry.probability > 1e-12)
            .sort((a, b) => b.probability - a.probability)
          : [];
        const expectedScore = at(stat.exp_score);
        const shapleyTotal = yakuContributions.reduce((sum, entry) => sum + entry.shapley, 0);
        return [{
          tile,
          shanten: Number(stat.shanten ?? shanten.all ?? 99),
          ukeire,
          ukeireTotal: ukeire.reduce((sum, item) => sum + item.count, 0),
          expectedScore,
          winProbability: at(stat.win_prob),
          tenpaiProbability: at(stat.tenpai_prob),
          callProbability,
          callWinProbability,
          callTileRates,
          yakuContributions,
          calledYakuContributions,
          yakuChartContributions: aggregateYakuContributions(yakuContributions),
          shapleyTotal,
          shapleyResidual: expectedScore - shapleyTotal
        }];
      } catch {
        return [];
      }
    }).sort((a, b) => b.expectedScore - a.expectedScore);
    return {
      config: response.config || {},
      shanten,
      searched: Number(response.searched || 0),
      candidates,
      recommendation: candidates[0]?.tile || null
    };
  }

  async analyze(scene, settings) {
    await this.ensureStarted();
    const timeoutMs = Math.max(3000, Number(settings.simulatorTimeoutSec || 30) * 1000);
    const [withWallRaw, withoutWallRaw] = await Promise.all([
      this.request(this.buildPayload(scene, settings, true), timeoutMs),
      this.request(this.buildPayload(scene, settings, false), timeoutMs)
    ]);
    return {
      withWall: this.parse(withWallRaw, scene),
      withoutWall: this.parse(withoutWallRaw, scene)
    };
  }

  stop() {
    if (this.process && !this.process.killed) this.process.kill();
    this.process = null;
  }
}

module.exports = { SimulatorService, aggregateYakuContributions, formatExitCode };
