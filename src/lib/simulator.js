"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { codesToIndices, windToIndex, removeKnownTiles, wallCounts } = require("./tiles");

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function yakuName(value) {
  const numeric = Number(value);
  return YAKU_NAMES.get(numeric) || `役 ${numeric}`;
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
    const sceneShanten = Number(scene.shanten);
    const autoDisableDeepSearch = settings.autoDisableDeepSearch !== false;
    const disableDeepSearchOptions = autoDisableDeepSearch && scene.shanten != null &&
      Number.isFinite(sceneShanten) && sceneShanten >= 4;
    const payload = {
      game_mode: 1,
      enable_reddora: Boolean(settings.enableRedDora),
      enable_uradora: Boolean(settings.enableUraDora),
      enable_shanten_down: Boolean(settings.enableShantenDown) && !disableDeepSearchOptions,
      enable_tegawari: Boolean(settings.enableTegawari) && !disableDeepSearchOptions,
      auto_disable_deep_search: autoDisableDeepSearch,
      enable_riichi: Boolean(settings.enableRiichi),
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
      version: "0.9.8"
    };
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
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  parse(data, scene) {
    const response = data.response || data || {};
    const shanten = response.shanten || {};
    const turn = clamp(scene.currentTurn || 1, 1, 18);
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
        const yakuContributions = (stat.yaku_stats || []).map((entry) => ({
          yaku: Number(entry.yaku),
          name: yakuName(entry.yaku),
          inclusive: at(entry.inclusive_score),
          marginal: at(entry.marginal_score),
          shapley: at(entry.shapley_score)
        })).filter((entry) => Math.abs(entry.inclusive) > 1e-9 ||
          Math.abs(entry.marginal) > 1e-9 || Math.abs(entry.shapley) > 1e-9)
          .sort((a, b) => b.shapley - a.shapley);
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
          yakuContributions,
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
