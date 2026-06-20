"use strict";

const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { normalizeScene, validateScene } = require("./lib/scene");
const { SimulatorService } = require("./lib/simulator");
const { AnkiService } = require("./lib/anki");
const {
  classifyShinMistake,
  classifyMajorMistake,
  listShinMistakes,
  listMajorMistakes
} = require("./lib/mistakes");
const {
  buildRoundRecords,
  mergeRoundRecords,
  summarizeRecords
} = require("./lib/stats");

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
  shinMistakeThreshold: 0.1,
  panelWidth: 500
};

let mainWindow;
let bigCoachView;
let settings;
let currentScene;
let currentSimulation;
let currentMajorMistakes = [];
let currentDecisions = [];
let currentCardImages;
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

function statsPath() {
  return path.join(app.getPath("userData"), "shin-stats.json");
}

function historyPath() {
  return path.join(app.getPath("userData"), "review-history.json");
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
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

function validateReviewUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch {
    throw new Error("解析結果URLが正しくありません。");
  }
  if (url.protocol !== "https:" || url.hostname !== "review.bigcoach.work" ||
      !url.pathname.startsWith("/review/")) {
    throw new Error("https://review.bigcoach.work/review/... のURLを入力してください。");
  }
  return url.href;
}

function saveReviewHistory(url) {
  if (!url.includes("/review/")) return readJson(historyPath(), []);
  const history = readJson(historyPath(), []).filter((item) => item.url !== url);
  history.unshift({ url, openedAt: new Date().toISOString() });
  const limited = history.slice(0, 50);
  writeJson(historyPath(), limited);
  return limited;
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
  const actualCandidate = normalized.candidates.find((item) => item.tile === normalized.actualDiscard);
  const recommendedCandidate = normalized.candidates.find((item) => item.tile === normalized.recommendedDiscard) ||
    normalized.candidates[0];
  const decision = {
    actual: normalized.actualDiscard,
    recommended: normalized.recommendedDiscard,
    actualProbability: actualCandidate?.value ?? null,
    isBad: Boolean(normalized.actualDiscard && normalized.recommendedDiscard &&
      normalized.actualDiscard !== normalized.recommendedDiscard),
    shanten: normalized.shanten,
    atSelfRiichi: normalized.atSelfRiichi,
    ownRiichiMoment: normalized.ownRiichiMoment,
    opponentRiichi: normalized.opponentRiichi
  };
  const screenshot = await bigCoachView.webContents.capturePage();
  currentScene = {
    ...normalized,
    screenshotDataUrl: screenshot.toDataURL(),
    shinMistake: classifyShinMistake(decision, settings),
    majorMistake: classifyMajorMistake(decision)
  };
  currentSimulation = null;
  currentCardImages = null;
  return currentScene;
}

async function loadDecisions() {
  await ensureAdapter();
  currentDecisions = await bigCoachView.webContents.executeJavaScript(
    "window.__bigcoachDesktop.listDecisions()", true
  );
  return currentDecisions;
}

function comparePosition(left, right) {
  return (left.handCounter - right.handCounter) || (left.plyCounter - right.plyCounter);
}

async function goToDecision(decision) {
  await ensureAdapter();
  const result = await bigCoachView.webContents.executeJavaScript(
    `window.__bigcoachDesktop.goToPosition(${Number(decision.handCounter)},${Number(decision.plyCounter)})`, true
  );
  if (!result.ok) throw new Error(result.reason || "指定局面へ移動できませんでした。");
  return captureScene();
}

async function navigate(kind) {
  const decisions = await loadDecisions();
  const current = currentScene?.sourcePosition || (await captureScene()).sourcePosition;
  const direction = kind.startsWith("previous") ? -1 : 1;
  let targets;
  if (kind === "previous" || kind === "next") {
    targets = decisions.filter((item) => /^[0-9][mpsz]$/.test(item.actual || ""));
  } else if (kind.endsWith("Mistake")) {
    targets = decisions.filter((item) => item.isBad);
  } else if (kind.endsWith("Shin")) {
    targets = listShinMistakes(decisions, settings);
  } else if (kind.endsWith("Major")) {
    targets = listMajorMistakes(decisions);
  } else {
    throw new Error(`未対応の移動操作です: ${kind}`);
  }
  if (!targets.length) throw new Error("該当する局面がありません。");
  const currentPosition = {
    handCounter: Number(current?.handCounter ?? -1),
    plyCounter: Number(current?.plyCounter ?? -1)
  };
  const ordered = [...targets].sort(comparePosition);
  const target = direction > 0
    ? ordered.find((item) => comparePosition(item, currentPosition) > 0) || ordered[0]
    : [...ordered].reverse().find((item) => comparePosition(item, currentPosition) < 0) || ordered.at(-1);
  return goToDecision(target);
}

async function loadMajorMistakes() {
  const decisions = await loadDecisions();
  currentMajorMistakes = listMajorMistakes(decisions);
  return {
    items: currentMajorMistakes,
    definition: "1シャンテン以下・聴牌・他家リーチ時の、実打とAI推奨が異なる局面"
  };
}

async function goToMajorMistake(mismatchOrdinal) {
  const decisions = await loadDecisions();
  const target = listMajorMistakes(decisions).find((item) =>
    Number(item.mismatchOrdinal) === Number(mismatchOrdinal));
  if (!target) throw new Error("指定した大悪手が見つかりませんでした。");
  return goToDecision(target);
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

async function prepareCardImages() {
  await ensureAdapter();
  let frontState;
  try {
    frontState = await bigCoachView.webContents.executeJavaScript(
      "window.__bigcoachDesktop.prepareCapture('front')", true
    );
    const frontImage = frontState.rect
      ? await bigCoachView.webContents.capturePage(frontState.rect)
      : await bigCoachView.webContents.capturePage();
    await bigCoachView.webContents.executeJavaScript(
      "window.__bigcoachDesktop.prepareCapture('back')", true
    );
    const backImage = await bigCoachView.webContents.capturePage();
    currentCardImages = {
      frontDataUrl: frontImage.toDataURL(),
      backDataUrl: backImage.toDataURL()
    };
    return currentCardImages;
  } finally {
    if (frontState?.previous) {
      await bigCoachView.webContents.executeJavaScript(
        `window.__bigcoachDesktop.restoreCapture(${JSON.stringify(frontState.previous)})`, true
      ).catch(() => {});
    }
  }
}

function cardHtml(scene, simulation, memo, images) {
  const comparison = comparisonStatus(scene, simulation);
  const front = `
    <div class="bigcoach-card">
      <div style="font-size:1px;color:#fff">BigCoach:${escapeHtml(scene.sceneId)}</div>
      <img src="${escapeHtml(images.front)}" style="max-width:100%">
    </div>`;
  const back = `
    <div class="bigcoach-card">
      <img src="${escapeHtml(images.back)}" style="max-width:100%">
      <h2>何切る比較</h2>
      <p>実打: ${tileHtml(comparison.actual)} / BigCoach推奨: ${tileHtml(comparison.bigCoach)} / シミュレーター推奨: ${tileHtml(comparison.simulator)}</p>
      <p>BigCoachとシミュレーター: <strong>${comparison.bigCoachMatchesSimulator ? "一致" : "不一致"}</strong></p>
      <p>シン悪手: ${scene.shinMistake.isShin ? "該当" : "非該当"} (${escapeHtml(scene.shinMistake.reason)})</p>
      <p>大悪手: ${scene.majorMistake?.isMajor ? "該当" : "非該当"} (${escapeHtml(scene.majorMistake?.reason || "判定不可")})</p>
      ${candidateTable("何切る結果（見えている牌を残り枚数から除外）", simulation?.withWall)}
      ${candidateTable("何切る結果（残り枚数を補正しない）", simulation?.withoutWall)}
      <h3>メモ</h3><div>${escapeHtml(memo).replace(/\n/g, "<br>")}</div>
      <hr><p><a href="${escapeHtml(scene.url)}">BigCoach解析結果</a></p>
      <p>局面ID: ${escapeHtml(scene.sceneId)}</p>
    </div>`;
  return { front, back, comparison };
}

async function refreshStats() {
  const decisions = await loadDecisions();
  const sourceUrl = bigCoachView.webContents.getURL();
  const currentRecords = buildRoundRecords(decisions, sourceUrl);
  const merged = mergeRoundRecords(readJson(statsPath(), { version: 1, rounds: {} }), currentRecords);
  writeJson(statsPath(), merged);
  return {
    current: summarizeRecords(currentRecords, settings),
    cumulative: summarizeRecords(Object.values(merged.rounds), settings),
    uniqueRounds: Object.keys(merged.rounds).length,
    currentRounds: currentRecords.length
  };
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
  ipcMain.handle("app:get-state", async () => ({
    settings,
    scene: currentScene,
    simulation: currentSimulation,
    history: readJson(historyPath(), [])
  }));
  ipcMain.handle("bigcoach:scene", () => captureScene());
  ipcMain.handle("bigcoach:navigate", (_event, kind) => navigate(kind));
  ipcMain.handle("bigcoach:major-mistakes", () => loadMajorMistakes());
  ipcMain.handle("bigcoach:go-to-mistake", (_event, ordinal) => goToMajorMistake(ordinal));
  ipcMain.handle("bigcoach:open-url", async (_event, value) => {
    const url = validateReviewUrl(value);
    currentScene = null;
    currentSimulation = null;
    currentCardImages = null;
    await bigCoachView.webContents.loadURL(url);
    return { url, history: saveReviewHistory(url) };
  });
  ipcMain.handle("bigcoach:history", () => readJson(historyPath(), []));
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
  ipcMain.handle("stats:refresh", () => refreshStats());
  ipcMain.handle("anki:preview", async (_event, memo) => {
    const scene = currentScene || await captureScene();
    if (!currentSimulation) currentSimulation = await simulator.analyze(scene, settings);
    const images = currentCardImages || await prepareCardImages();
    const duplicates = await anki.findDuplicates(scene.sceneId).catch(() => []);
    return {
      ...cardHtml(scene, currentSimulation, memo, {
        front: images.frontDataUrl,
        back: images.backDataUrl
      }),
      duplicates,
      simulation: currentSimulation,
      comparison: comparisonStatus(scene, currentSimulation)
    };
  });
  ipcMain.handle("anki:register", async (_event, payload) => {
    const scene = currentScene || await captureScene();
    if (!currentSimulation) currentSimulation = await simulator.analyze(scene, settings);
    const images = currentCardImages || await prepareCardImages();
    const [frontName, backName] = await Promise.all([
      anki.storeImage(images.frontDataUrl, scene.sceneId, "front"),
      anki.storeImage(images.backDataUrl, scene.sceneId, "back")
    ]);
    const html = cardHtml(scene, currentSimulation, payload.memo || "", {
      front: frontName,
      back: backName
    });
    return anki.add({
      settings,
      scene,
      frontHtml: html.front,
      backHtml: html.back,
      duplicateMode: payload.duplicateMode || "skip"
    });
  });
  ipcMain.handle("app:open-logs", () => shell.openPath(logPath));
  ipcMain.on("layout:overlay-open", (_event, open) => {
    if (bigCoachView) bigCoachView.setVisible(!Boolean(open));
  });
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
      const url = bigCoachView.webContents.getURL();
      const history = saveReviewHistory(url);
      mainWindow.webContents.send("bigcoach:status", { ok: true, url, history });
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
