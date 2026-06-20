"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { codesToIndices, windToIndex, removeKnownTiles, wallCounts } = require("./tiles");

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
    this.process = spawn(this.executable, [String(this.port)], {
      cwd: this.directory,
      windowsHide: true,
      stdio: "ignore"
    });
    this.process.once("error", (error) => this.log(`simulator spawn error: ${error.stack || error}`));
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await this.isReady()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("何切るシミュレーターを起動できませんでした。詳細ログを確認してください。");
  }

  buildPayload(scene, settings, withWall) {
    if (!scene.handTiles.length) throw new Error("手牌を取得できていないため実行できません。");
    const payload = {
      enable_reddora: Boolean(settings.enableRedDora),
      enable_uradora: Boolean(settings.enableUraDora),
      enable_shanten_down: Boolean(settings.enableShantenDown),
      enable_tegawari: Boolean(settings.enableTegawari),
      enable_riichi: Boolean(settings.enableRiichi),
      round_wind: windToIndex(scene.roundWind),
      dora_indicators: codesToIndices(scene.doraTiles),
      hand: codesToIndices(scene.handTiles),
      hand_tiles: codesToIndices(scene.handTiles),
      melds: scene.selfMelds || [],
      seat_wind: windToIndex(scene.seatWind),
      version: "0.9.1"
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
    const response = data.response || {};
    const shanten = response.shanten || {};
    const turn = Math.max(1, Number(scene.currentTurn || 1));
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
        return [{
          tile,
          shanten: Number(stat.shanten ?? shanten.all ?? 99),
          ukeire,
          ukeireTotal: ukeire.reduce((sum, item) => sum + item.count, 0),
          expectedScore: at(stat.exp_score),
          winProbability: at(stat.win_prob),
          tenpaiProbability: at(stat.tenpai_prob)
        }];
      } catch {
        return [];
      }
    }).sort((a, b) => b.expectedScore - a.expectedScore);
    return {
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

module.exports = { SimulatorService };
