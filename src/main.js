"use strict";

const { app, BrowserWindow, WebContentsView, ipcMain, shell, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { normalizeScene, validateScene, shinMistake } = require("./lib/scene");
const { SimulatorService } = require("./lib/simulator");
const { AnkiService } = require("./lib/anki");

const DEFAULT_SETTINGS = {
  deckName: "BigCoach",
  modelName: "基本",
  tags: ["BigCoach", "何切る"],
  language: "ja",
  enableRedDora: true,
  enableUraDora: false,
  enableShantenDown: true,
  enableTegawari: true,
  enableRiichi: false,
  simulatorTimeoutSec: 30,
  shinMistakeThreshold: 0.08,
  shinSearchLimit: 60,
  panelWidth: 500
};

let mainWindow;
let bigCoachView;
let settings;
let currentScene;
let currentSimulation;
let simulator;
let anki;
let adapterSource;
let logPath;

function log(message) {
  const line = `${new Date().toISOString()} ${String(message)}\n`;
  try { fs.appendFileSync(logPath, line, "utf8"); } catch {}
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next) {
  settings = {
    ...settings,
    ...next,
    tags: Array.isArray(next.tags) ? next.tags.filter(Boolean) : settings.tags
  };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  layoutViews();
  return settings;
}

function bigCoachUrl() {
  return `https://review.bigcoach.work/?lang=${encodeURIComponent(settings.language || "ja")}`;
}

function layoutViews() {
  if (!mainWindow || !bigCoachView) return;
  const [width, height] = mainWindow.getContentSize();
  const panelWidth = Math.max(380, Math.min(760, Number(settings.panelWidth || 500)));
  bigCoachView.setBounds({ x: 0, y: 0, width: Math.max(320, width - panelWidth), height });
}

async function ensureAdapter() {
  if (!bigCoachView || bigCoachView.webContents.isDestroyed()) throw new Error("BigCoach表示が初期化されていません。");
  const exists = await bigCoachView.webContents.executeJavaScript("Boolean(window.__bigcoachDesktop)", true);
  if (!exists) await bigCoachView.webContents.executeJavaScript(adapterSource, true);
}

async function captureScene() {
  await ensureAdapter();
  const raw = await bigCoachView.webContents.executeJavaScript("window.__bigcoachDesktop.scrape()", true);
  const normalized = validateScene(normalizeScene(raw, bigCoachView.webContents.getURL()));
  const screenshot = await bigCoachView.webContents.capturePage();
  currentScene = {
    ...normalized,
    screenshotDataUrl: screenshot.toDataURL(),
    shinMistake: shinMistake(normalized, settings)
  };
  currentSimulation = null;
  return currentScene;
}

async function navigateOnce(kind) {
  await ensureAdapter();
  const result = await bigCoachView.webContents.executeJavaScript(
    `window.__bigcoachDesktop.navigate(${JSON.stringify(kind)})`, true
  );
  if (!result.ok) throw new Error(`${result.reason}。BigCoach側のUI変更の可能性があります。`);
  await new Promise((resolve) => setTimeout(resolve, 450));
  return captureScene();
}

async function navigate(kind) {
  if (kind === "previousShin" || kind === "nextShin") {
    const direction = kind === "previousShin" ? "previous" : "next";
    const limit = Math.max(1, Number(settings.shinSearchLimit || 60));
    for (let step = 0; step < limit; step += 1) {
      const scene = await navigateOnce(direction);
      if (!scene.shinMistake.enabled) {
        throw new Error(`シン悪手を判定できません: ${scene.shinMistake.reason}`);
      }
      if (scene.shinMistake.isShin) return scene;
    }
    throw new Error(`${limit}局面以内にシン悪手を見つけられませんでした。`);
  }
  return navigateOnce(kind);
}

function comparisonStatus(scene, simulation) {
  const simRecommendation = simulation?.withWall?.recommendation || null;
  return {
    actual: scene.actualDiscard,
    bigCoach: scene.recommendedDiscard,
    simulator: simRecommendation,
    bigCoachMatchesSimulator: Boolean(scene.recommendedDiscard && simRecommendation && scene.recommendedDiscard === simRecommendation),
    actualMatchesBigCoach: Boolean(scene.actualDiscard && scene.recommendedDiscard && scene.actualDiscard === scene.recommendedDiscard),
    actualMatchesSimulator: Boolean(scene.actualDiscard && simRecommendation && scene.actualDiscard === simRecommendation)
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function tileHtml(code) {
  return code ? `<span class="tile-text">${escapeHtml(code)}</span>` : "<span>取得なし</span>";
}

function candidateTable(title, analysis) {
  if (!analysis?.candidates?.length) return `<h3>${escapeHtml(title)}</h3><p>結果なし</p>`;
  const rows = analysis.candidates.map((candidate) => `
    <tr><td>${tileHtml(candidate.tile)}</td><td>${candidate.expectedScore.toFixed(0)}</td>
    <td>${(candidate.winProbability * 100).toFixed(2)}%</td>
    <td>${(candidate.tenpaiProbability * 100).toFixed(2)}%</td>
    <td>${candidate.ukeireTotal}</td></tr>`).join("");
  return `<h3>${escapeHtml(title)}</h3><table><thead><tr><th>打牌</th><th>期待値</th><th>和了率</th><th>聴牌率</th><th>受入</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function cardHtml(scene, simulation, memo, imageName = null) {
  const comparison = comparisonStatus(scene, simulation);
  const front = `
    <div class="bigcoach-card">
      <div style="font-size:1px;color:#fff">BigCoach:${escapeHtml(scene.sceneId)}</div>
      ${imageName ? `<img src="${escapeHtml(imageName)}" style="max-width:100%">` : `<img src="${scene.screenshotDataUrl}" style="max-width:100%">`}
      <h2>何を切りますか？</h2>
      <p>${escapeHtml(scene.roundText)} / ${scene.currentTurn}巡目 / ${escapeHtml(scene.actorText)}</p>
      <p>手牌: ${escapeHtml(scene.handMpsz)}</p>
    </div>`;
  const bigCoachCandidates = scene.candidates.length
    ? `<table><thead><tr><th>打牌</th><th>BigCoach評価</th></tr></thead><tbody>${scene.candidates.map((item) =>
        `<tr><td>${tileHtml(item.tile)}</td><td>${item.value == null ? escapeHtml(item.label) : item.value.toFixed(4)}</td></tr>`).join("")}</tbody></table>`
    : "<p>BigCoach候補評価は取得できませんでした。</p>";
  const back = `
    <div class="bigcoach-card">
      <h2>比較</h2>
      <p>実打: ${tileHtml(comparison.actual)} / BigCoach推奨: ${tileHtml(comparison.bigCoach)} / シミュレーター推奨: ${tileHtml(comparison.simulator)}</p>
      <p>BigCoachとシミュレーター: <strong>${comparison.bigCoachMatchesSimulator ? "一致" : "不一致"}</strong></p>
      <p>シン悪手: ${scene.shinMistake.enabled ? (scene.shinMistake.isShin ? "該当" : "非該当") : "判定不可"} (${escapeHtml(scene.shinMistake.reason)})</p>
      <h3>BigCoach候補</h3>${bigCoachCandidates}
      ${candidateTable("何切る結果（見えている牌を残り枚数から除外）", simulation?.withWall)}
      ${candidateTable("何切る結果（残り枚数を補正しない）", simulation?.withoutWall)}
      <h3>メモ</h3><div>${escapeHtml(memo).replace(/\n/g, "<br>")}</div>
      <hr><p><a href="${escapeHtml(scene.url)}">BigCoach解析結果</a></p>
      <p>局面ID: ${escapeHtml(scene.sceneId)}</p>
    </div>`;
  return { front, back, comparison };
}

async function diagnose() {
  const result = {
    bigCoach: { ok: false, message: "未確認" },
    scene: { ok: false, message: "未確認" },
    simulator: { ok: false, message: "未確認" },
    anki: { ok: false, message: "未確認" }
  };
  try {
    const url = bigCoachView?.webContents.getURL() || "";
    result.bigCoach = { ok: url.startsWith("https://review.bigcoach.work"), message: url || "未読込" };
  } catch (error) { result.bigCoach.message = error.message; }
  try {
    const scene = await captureScene();
    result.scene = {
      ok: scene.handTiles.length > 0,
      message: scene.handTiles.length ? `手牌 ${scene.handMpsz} を取得` : `不足: ${scene.missing.join("、")}`,
      missing: scene.missing
    };
  } catch (error) { result.scene.message = error.message; }
  try {
    await simulator.ensureStarted();
    result.simulator = { ok: true, message: "同梱シミュレーター利用可" };
  } catch (error) { result.simulator.message = error.message; }
  try {
    const info = await anki.diagnose(settings);
    result.anki = {
      ok: info.deckExists && info.modelExists,
      message: !info.deckExists ? `デッキ「${settings.deckName}」がありません` :
        !info.modelExists ? `ノートタイプ「${settings.modelName}」がありません` : "AnkiConnect利用可",
      info
    };
  } catch (error) { result.anki.message = error.message; }
  return result;
}

function registerIpc() {
  ipcMain.handle("app:get-state", async () => ({ settings, scene: currentScene, simulation: currentSimulation }));
  ipcMain.handle("bigcoach:scene", () => captureScene());
  ipcMain.handle("bigcoach:navigate", (_event, kind) => navigate(kind));
  ipcMain.handle("bigcoach:reload", async () => {
    await bigCoachView.webContents.loadURL(bigCoachUrl());
    return true;
  });
  ipcMain.handle("simulator:run", async () => {
    const scene = currentScene || await captureScene();
    currentSimulation = await simulator.analyze(scene, settings);
    return { simulation: currentSimulation, comparison: comparisonStatus(scene, currentSimulation) };
  });
  ipcMain.handle("settings:save", (_event, next) => saveSettings(next));
  ipcMain.handle("app:diagnose", () => diagnose());
  ipcMain.handle("anki:preview", async (_event, memo) => {
    const scene = currentScene || await captureScene();
    if (!currentSimulation) throw new Error("先に何切るシミュレーターを実行してください。");
    const duplicates = await anki.findDuplicates(scene.sceneId).catch(() => []);
    return { ...cardHtml(scene, currentSimulation, memo), duplicates };
  });
  ipcMain.handle("anki:register", async (_event, payload) => {
    const scene = currentScene || await captureScene();
    if (!currentSimulation) throw new Error("先に何切るシミュレーターを実行してください。");
    const imageName = await anki.storeImage(scene.screenshotDataUrl, scene.sceneId);
    const html = cardHtml(scene, currentSimulation, payload.memo || "", imageName);
    return anki.add({
      settings,
      scene,
      frontHtml: html.front,
      backHtml: html.back,
      duplicateMode: payload.duplicateMode || "skip"
    });
  });
  ipcMain.handle("app:open-logs", () => shell.openPath(logPath));
  ipcMain.on("layout:panel-width", (_event, width) => {
    settings.panelWidth = Number(width);
    layoutViews();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: "BigCoach Anki Studio",
    backgroundColor: "#0f141b",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  bigCoachView = new WebContentsView({
    webPreferences: {
      partition: "persist:bigcoach",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.contentView.addChildView(bigCoachView);
  layoutViews();
  mainWindow.on("resize", layoutViews);
  bigCoachView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://review.bigcoach.work")) {
      bigCoachView.webContents.loadURL(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  bigCoachView.webContents.on("did-finish-load", async () => {
    try {
      await ensureAdapter();
      mainWindow.webContents.send("bigcoach:status", { ok: true, url: bigCoachView.webContents.getURL() });
    } catch (error) {
      log(error.stack || error);
      mainWindow.webContents.send("bigcoach:status", { ok: false, message: error.message });
    }
  });
  bigCoachView.webContents.on("did-fail-load", (_event, code, description) => {
    mainWindow.webContents.send("bigcoach:status", { ok: false, message: `${description} (${code})` });
  });
  await bigCoachView.webContents.loadURL(bigCoachUrl());
}

app.whenReady().then(async () => {
  app.setAppUserModelId("work.bigcoach.anki-studio");
  logPath = path.join(app.getPath("userData"), "bigcoach-anki-studio.log");
  settings = loadSettings();
  adapterSource = fs.readFileSync(path.join(__dirname, "bigcoach-adapter.js"), "utf8");
  simulator = new SimulatorService({ resourcesPath: app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources"), log });
  anki = new AnkiService({ log });
  registerIpc();
  await createWindow();
}).catch((error) => {
  log(error.stack || error);
  app.quit();
});

app.on("window-all-closed", () => {
  simulator?.stop();
  if (process.platform !== "darwin") app.quit();
});
