"use strict";

const { app, BrowserWindow, WebContentsView, ipcMain, shell, session, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { normalizeScene, validateScene } = require("./lib/scene");
const { SimulatorService } = require("./lib/simulator");
const { AnkiService } = require("./lib/anki");
const { AuthSessionStore } = require("./lib/auth-session");
const { tileFilename } = require("./lib/tiles");
const { DEFAULT_HAND_SCORE_SETTINGS, SCORE_SETTING_KEYS, calculateHandScore } = require("./lib/hand-score");
const {
  classifyShinMistake,
  classifyMajorMistake,
  listShinMistakes,
  listMajorMistakes
} = require("./lib/mistakes");
const {
  buildRoundRecords,
  mergeRoundRecords,
  summarizeRecords,
  buildTrend
} = require("./lib/stats");

if (process.env.BIGCOACH_E2E_USER_DATA_DIR) {
  app.setPath("userData", process.env.BIGCOACH_E2E_USER_DATA_DIR);
}

const DEFAULT_OTHER_WIN_HAZARD_PERCENT = [
  0.02, 0.08, 0.29, 0.78, 1.70, 3.05, 4.67, 6.44, 8.23,
  9.75, 11.08, 12.12, 12.76, 13.12, 13.23, 13.09, 11.70, 11.70
];

const DEFAULT_SETTINGS = {
  settingsVersion: 8,
  deckName: "BigCoach",
  riskReadingDeckName: "BigCoach::RiskReading",
  riskReadingNote: "相手の河から放銃危険度を読む。",
  riskReadingDeviationThreshold: 0.03,
  modelName: "Basic",
  tags: ["BigCoach"],
  language: "ja",
  enableRedDora: true,
  enableUraDora: true,
  enableShantenDown: true,
  enableTegawari: true,
  autoDisableDeepSearch: true,
  enableRiichi: true,
  enableCalls: false,
  enableOtherWinStop: true,
  otherWinHazardPercent: DEFAULT_OTHER_WIN_HAZARD_PERCENT,
  tsumoWinSharePercent: 100,
  simulatorTimeoutSec: 30,
  shinMistakeThreshold: 0.001,
  panelWidth: 500,
  ...DEFAULT_HAND_SCORE_SETTINGS
};

let mainWindow;
let bigCoachView;
let settings;
let currentScene;
let currentSimulation;
let currentMajorMistakes = [];
let currentDecisions = [];
let currentCardImages;
let currentCardPreview;
let currentRiskReadingPreview;
let tileImageCache;
let statsRefreshTimer;
let loadedReviewUrl = "";
let simulator;
let anki;
let adapterSource;
let logPath;
let authSessionStore;
let quitAfterSessionFlush = false;
let bigCoachHiddenForOverlay = false;

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

function firstDiscardStockPath() {
  return path.join(app.getPath("userData"), "first-discard-stock.csv");
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

const FIRST_DISCARD_CSV_COLUMNS = [
  "row_key",
  "task_id",
  "review_url",
  "kyoku_index",
  "entry_index",
  "round_text",
  "round_wind",
  "seat_wind",
  "honba",
  "turn",
  "hand_mpsz",
  "win_rate",
  "dora_indicators_mpsz",
  "called_by_opponents",
  "riichi_by_opponents",
  "actual_discard",
  "recommended_discard",
  "missing"
];

function csvEscape(value) {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function firstDiscardRowToCsv(row) {
  const values = {
    row_key: row.rowKey,
    task_id: row.taskId,
    review_url: row.reviewUrl,
    kyoku_index: row.kyokuIndex,
    entry_index: row.entryIndex,
    round_text: row.roundText,
    round_wind: row.roundWind,
    seat_wind: row.seatWind,
    honba: row.honba,
    turn: row.turn,
    hand_mpsz: row.handMpsz,
    win_rate: row.winRate == null ? "" : Number(row.winRate).toFixed(6),
    dora_indicators_mpsz: row.doraIndicatorsMpsz,
    called_by_opponents: row.calledByOpponents ? "1" : "0",
    riichi_by_opponents: row.riichiByOpponents ? "1" : "0",
    actual_discard: row.actualDiscard,
    recommended_discard: row.recommendedDiscard,
    missing: row.missing || []
  };
  return FIRST_DISCARD_CSV_COLUMNS.map((column) => csvEscape(values[column])).join(",");
}

function existingFirstDiscardKeys(filePath) {
  try {
    return new Set(fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .map((line) => line.split(",", 1)[0].replace(/^"|"$/g, "").replace(/""/g, '"')));
  } catch {
    return new Set();
  }
}

function ensureFirstDiscardCsvHeader(filePath) {
  const header = `${FIRST_DISCARD_CSV_COLUMNS.join(",")}\n`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header, "utf8");
    return;
  }
  const currentHeader = fs.readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0] || "";
  if (currentHeader === FIRST_DISCARD_CSV_COLUMNS.join(",")) return;
  const backupPath = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, header, "utf8");
}

async function stockFirstDiscards() {
  const rows = await executeAdapter("window.__bigcoachDesktop.listFirstDiscards()");
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("各局の第一打データを取得できませんでした。解析結果URLを開いてから実行してください。");
  }
  const filePath = firstDiscardStockPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  ensureFirstDiscardCsvHeader(filePath);
  const keys = existingFirstDiscardKeys(filePath);
  const additions = rows.filter((row) => row?.rowKey && !keys.has(row.rowKey));
  if (additions.length) {
    fs.appendFileSync(filePath, `${additions.map(firstDiscardRowToCsv).join("\n")}\n`, "utf8");
  }
  return {
    path: filePath,
    total: rows.length,
    added: additions.length,
    skipped: rows.length - additions.length,
    missingWinRate: rows.filter((row) => row.winRate == null).length,
    rows
  };
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (!saved.settingsVersion || saved.settingsVersion < 2) {
      if (Number(saved.shinMistakeThreshold) === 0.1) saved.shinMistakeThreshold = 0.001;
    }
    delete saved.enableProbabilityPruning;
    delete saved.probabilityPruneThresholdPercent;
    saved.settingsVersion = 8;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next) {
  const normalized = { ...next };
  for (const key of SCORE_SETTING_KEYS) {
    if (key in normalized) normalized[key] = Number(normalized[key]);
  }
  if ("tsumoWinSharePercent" in normalized) {
    normalized.tsumoWinSharePercent = Math.min(
      100,
      Math.max(0, Number(normalized.tsumoWinSharePercent))
    );
  }
  if (Array.isArray(normalized.otherWinHazardPercent)) {
    normalized.otherWinHazardPercent = DEFAULT_OTHER_WIN_HAZARD_PERCENT.map(
      (fallback, index) => Math.min(
        100,
        Math.max(0, Number(normalized.otherWinHazardPercent[index] ?? fallback))
      )
    );
    normalized.otherWinHazardPercent[17] = normalized.otherWinHazardPercent[16];
  }
  settings = {
    ...settings,
    ...normalized,
    tags: Array.isArray(normalized.tags) ? normalized.tags.filter(Boolean) : settings.tags
  };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  layoutViews();
  return settings;
}

function bigCoachUrl() {
  return "https://gokujan.com/";
}

function validateReviewUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch {
    throw new Error("Invalid review URL.");
  }
  const allowedHost = url.hostname === "gokujan.com" || url.hostname === "review.bigcoach.work";
  if (url.protocol !== "https:" || !allowedHost || !url.pathname.startsWith("/review/")) {
    throw new Error("Please enter a URL like https://gokujan.com/review/...");
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

function attachBigCoachViewEvents(view) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://gokujan.com") || url.startsWith("https://review.bigcoach.work")) {
      view.webContents.loadURL(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  view.webContents.on("did-finish-load", async () => {
    try {
      const url = view.webContents.getURL();
      if (url.includes("/review/")) await ensureAdapter();
      if (url !== loadedReviewUrl) {
        currentDecisions = [];
        currentScene = null;
        currentSimulation = null;
        currentCardImages = null;
        currentCardPreview = null;
        currentRiskReadingPreview = null;
        loadedReviewUrl = url;
      }
      const history = saveReviewHistory(url);
      mainWindow.webContents.send("bigcoach:status", { ok: true, url, history });
    } catch (error) {
      log(error.stack || error);
      mainWindow.webContents.send("bigcoach:status", { ok: false, message: error.message });
    }
  });
  view.webContents.on("did-fail-load", (_event, code, description) => {
    mainWindow.webContents.send("bigcoach:status", { ok: false, message: `${description} (${code})` });
  });
}

function createBigCoachView() {
  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:bigcoach",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  attachBigCoachViewEvents(view);
  return view;
}

function replaceBigCoachView() {
  try {
    if (bigCoachView) mainWindow.contentView.removeChildView(bigCoachView);
  } catch {}
  try {
    if (bigCoachView?.webContents && !bigCoachView.webContents.isDestroyed()) {
      bigCoachView.webContents.destroy();
    }
  } catch {}
  bigCoachView = createBigCoachView();
  mainWindow.contentView.addChildView(bigCoachView);
  layoutViews();
  return bigCoachView;
}

function findAnalysisFrame(frame = bigCoachView?.webContents.mainFrame) {
  if (!frame) return null;
  if (/\/ui_advanced(?:\/|[?#]|$)/.test(frame.url || "")) return frame;
  for (const child of frame.frames || []) {
    const found = findAnalysisFrame(child);
    if (found) return found;
  }
  if (/^https:\/\/(?:gokujan\.com|review\.bigcoach\.work)\/review\/[^/?#]+/.test(frame.url || "")) return frame;
  return null;
}

async function waitForAnalysisFrame(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = findAnalysisFrame();
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Could not find the BigCoach analysis frame.");
}

async function executeAdapter(expression) {
  const frame = await ensureAdapter();
  return frame.executeJavaScript(expression, true);
}

async function ensureAdapter() {
  if (!bigCoachView || bigCoachView.webContents.isDestroyed()) throw new Error("BigCoach display is not available.");
  const frame = await waitForAnalysisFrame();
  const exists = await frame.executeJavaScript(
    "Boolean(window.__bigcoachDesktop && window.__bigcoachDesktop.__version === '2026-07-06-first-discard-stock-winds' && typeof window.__bigcoachDesktop.listFirstDiscards === 'function')",
    true
  );
  if (!exists) await frame.executeJavaScript(adapterSource, true);
  return frame;
}

async function waitForAnalysisReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await ensureAdapter();
      const ready = await executeAdapter(
        `window.__bigcoachDesktop.listDecisions().then(() => true).catch(() => false)`, true
      );
      if (ready) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("BigCoach results did not become ready before timeout.");
}

async function loadBigCoachReviewUrl(url) {
  const contents = bigCoachView?.webContents;
  if (!contents) throw new Error("BigCoach display is not available.");
  try {
    await Promise.race([
      contents.loadURL(url),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
  } catch (error) {
    if (!["ERR_ABORTED", "ERR_FAILED"].includes(error?.code)) throw error;
    log(`loadURL reported ${error.code} for ${url}; continuing because renderer waits for scene readiness`);
    if (contents.isDestroyed()) {
      const replacement = replaceBigCoachView();
      replacement.webContents.loadURL(url).catch((loadError) =>
        log(`replacement loadURL reported ${loadError.code || loadError.message} for ${url}`));
    }
  }
}

async function captureScene() {
  await ensureAdapter();
  await waitForAnalysisReady();
  const raw = await executeAdapter("window.__bigcoachDesktop.scrape()");
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
  currentScene = {
    ...normalized,
    screenshotDataUrl: null,
    shinMistake: classifyShinMistake(decision, settings),
    majorMistake: classifyMajorMistake(decision, settings),
    
  };
  currentSimulation = null;
  currentCardImages = null;
  currentCardPreview = null;
  currentRiskReadingPreview = null;
  return currentScene;
}

async function loadDecisions() {
  if (currentDecisions.length) return currentDecisions;
  await ensureAdapter();
  currentDecisions = await executeAdapter("window.__bigcoachDesktop.listDecisions()");
  return currentDecisions;
}

function comparePosition(left, right) {
  return (left.handCounter - right.handCounter) || (left.plyCounter - right.plyCounter);
}

function listLanceMistakes(decisions) {
  return decisions.filter((item) =>
    item.judgmentType === "discard" &&
    Number.isFinite(Number(item.lanceProbability)) &&
    Number(item.lanceProbability) < 0.05
  );
}

async function goToDecision(decision) {
  await ensureAdapter();
  const result = await executeAdapter(
    `window.__bigcoachDesktop.goToPosition(${Number(decision.handCounter)},${Number(decision.plyCounter)})`
  );
  if (!result.ok) throw new Error(result.reason || "Could not move to the target scene.");
  return captureScene();
}

async function navigate(kind) {
  if (kind.endsWith("Lance") || kind.endsWith("Mistake")) {
    await ensureAdapter();
    const result = await executeAdapter(
      `window.__bigcoachDesktop.navigate(${JSON.stringify(kind)})`
    );
    if (!result.ok) throw new Error(result.reason || "Lance悪手局面へ移動できませんでした。");
    return captureScene();
  }
  if (kind.endsWith("Shin") || kind.endsWith("Major")) {
    await ensureAdapter();
    const modern = await executeAdapter("window.__bigcoachDesktop.captureDisplayState().then(state => typeof state?.aiDisplayChecked === 'boolean').catch(() => false)");
    if (modern) {
      const result = await executeAdapter(
        `window.__bigcoachDesktop.navigate(${JSON.stringify(kind)})`
      );
      if (!result.ok) throw new Error(result.reason || "BigCoachの遷移対象局面へ移動できませんでした。");
      return captureScene();
    }
  }
  const decisions = await loadDecisions();
  const current = currentScene?.sourcePosition || (await captureScene()).sourcePosition;
  const direction = kind.startsWith("previous") ? -1 : 1;
  let targets;
  if (kind === "previous" || kind === "next") {
    targets = decisions.filter((item) => /^[0-9][mpsz]$/.test(item.actual || ""));
  } else if (kind.endsWith("Mistake")) {
    targets = decisions.filter((item) => item.isBad);
  } else if (kind.endsWith("Lance")) {
    targets = listLanceMistakes(decisions);
  } else if (kind.endsWith("Shin")) {
    targets = listShinMistakes(decisions, settings);
  } else if (kind.endsWith("Major")) {
    targets = listMajorMistakes(decisions, settings);
  } else {
    throw new Error(`未対応の遷移種別です: ${kind}`);
  }
  if (!targets.length) throw new Error("No target scenes found.");
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
  currentMajorMistakes = listMajorMistakes(decisions, settings);
  return {
    items: currentMajorMistakes,
    definition: `1シャンテン以下、聴牌時、または他家リーチ時の悪手で、実打のAI推奨度が ${(Number(settings.shinMistakeThreshold) * 100).toFixed(1)}% 以下の局面`
  };
}

async function goToMajorMistake(mismatchOrdinal) {
  const decisions = await loadDecisions();
  const target = listMajorMistakes(decisions, settings).find((item) =>
    Number(item.mismatchOrdinal) === Number(mismatchOrdinal));
  if (!target) throw new Error("No major mistake target found.");
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

async function ensureSimulation(scene) {
  if (currentSimulation) {
    return currentSimulation;
  }
  if (scene.judgmentType === "call") {
    currentSimulation = {
      withWall: { candidates: [], recommendation: null },
      withoutWall: { candidates: [], recommendation: null },
      skippedReason: "Skipped because call scenes are not simulator targets."
    };
    return currentSimulation;
  }
  currentSimulation = await simulator.analyze(scene, settings);
  return currentSimulation;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function tileImagesDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "pai-images")
    : path.join(__dirname, "..", "resources", "pai-images");
}

function tileDataUrls() {
  if (tileImageCache) return tileImageCache;
  tileImageCache = {};
  for (const suit of ["m", "p", "s", "z"]) {
    const max = suit === "z" ? 7 : 9;
    for (let number = 1; number <= max; number += 1) {
      const code = `${number}${suit}`;
      const filename = tileFilename(code);
      tileImageCache[code] = `data:image/png;base64,${fs.readFileSync(path.join(tileImagesDirectory(), filename)).toString("base64")}`;
    }
  }
  for (const code of ["0m", "0p", "0s"]) {
    const filename = tileFilename(code);
    tileImageCache[code] = `data:image/png;base64,${fs.readFileSync(path.join(tileImagesDirectory(), filename)).toString("base64")}`;
  }
  return tileImageCache;
}

function tileHtml(code, mediaMode = "preview") {
  if (!code || !tileFilename(code)) return `<span>${escapeHtml(code || "unknown")}</span>`;
  const src = mediaMode === "anki"
    ? `bigcoach_tile_${tileFilename(code)}`
    : tileDataUrls()[code];
  return `<img src="${src}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}" style="height:38px;vertical-align:middle">`;
}

function safeTileFilename(code) {
  try {
    return tileFilename(code);
  } catch {
    return null;
  }
}

function safeTileHtml(code, mediaMode = "preview") {
  const filename = safeTileFilename(code);
  if (!code || !filename) return `<span>${escapeHtml(code || "unknown")}</span>`;
  const src = mediaMode === "anki"
    ? `bigcoach_tile_${filename}`
    : tileDataUrls()[code];
  return `<img src="${src}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}" style="height:38px;vertical-align:middle">`;
}

tileHtml = safeTileHtml;

function candidateTable(title, analysis, mediaMode = "preview") {
  if (!analysis?.candidates?.length) return `<h3>${escapeHtml(title)}</h3><p>結果なし</p>`;
  const commonScale = Math.max(1, ...analysis.candidates.map((candidate) =>
    Math.max(0, Number(candidate.shapleyTotal || 0))));
  const yakuColor = (entry) => {
    if (entry?.yaku == null || entry?.isOther || entry?.name === "その他") return "#687386";
    let hash = 2166136261;
    for (const character of String(entry?.yaku ?? "unknown")) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    }
    return `hsl(${hash % 360} 62% 55%)`;
  };
  const contributionHtml = (candidate) => {
    const entries = candidate.yakuContributions || [];
    if (!entries.length) return "なし";
    const chartEntries = candidate.yakuChartContributions || entries.slice(0, 5);
    const segments = chartEntries.map((entry) => {
      const width = Math.max(0, Number(entry.shapley || 0)) / commonScale * 100;
      const suffix = entry.count ? `（${entry.count}役）` : "";
      const label = entry.shortName || Array.from(String(entry.name || "役")).slice(0, 2).join("");
      return `<span title="${escapeHtml(entry.name)}${suffix}: ${Number(entry.shapley).toFixed(1)}点" style="display:flex;align-items:center;justify-content:center;width:${width.toFixed(4)}%;min-width:1px;height:18px;overflow:hidden;background:${yakuColor(entry)};border-right:1px solid #111;color:#fff;font-size:10px;font-weight:800;line-height:1;white-space:nowrap;text-shadow:0 1px 2px #000">${escapeHtml(label)}</span>`;
    }).join("");
    const rows = entries.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td>${(entry.occurrence * 100).toFixed(2)}%</td><td>${entry.shapley.toFixed(1)}</td></tr>`).join("");
    const residual = Math.abs(Number(candidate.shapleyResidual || 0));
    return `<div style="display:flex;width:220px;height:18px;overflow:hidden;border-radius:3px;background:#111">${segments}</div>
      <details style="margin-top:4px"><summary>詳細</summary><table style="font-size:11px;margin-top:4px"><thead><tr><th>役</th><th>出現率</th><th>Shapley</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><th>合計</th><td>期待値 ${candidate.expectedScore.toFixed(1)}</td><td>${candidate.shapleyTotal.toFixed(1)}</td></tr>
      <tr><th>残差</th><td colspan="2">${residual.toFixed(4)}</td></tr></tfoot></table></details>`;
  };
  const rows = analysis.candidates.map((candidate) => `
    <tr>
      <td>${tileHtml(candidate.tile, mediaMode)}</td>
      <td>${candidate.expectedScore.toFixed(0)}</td>
      <td>${(candidate.winProbability * 100).toFixed(2)}%</td>
      <td>${(candidate.tenpaiProbability * 100).toFixed(2)}%</td>
      <td>${(candidate.callProbability * 100).toFixed(2)}%</td>
      <td>
        <div style="display:flex;flex-wrap:wrap;gap:2px">${(candidate.ukeire || []).map((item) =>
          `<span style="display:inline-flex;align-items:end">${tileHtml(item.tile, mediaMode)}<small>×${item.count}</small></span>`).join("")}</div>
        <div>${candidate.ukeireTotal}枚</div>
      </td>
      <td style="white-space:normal">${contributionHtml(candidate)}</td>
    </tr>`).join("");
  return `<h3>${escapeHtml(title)}</h3><table><thead><tr><th>打牌</th><th>期待値</th><th>和了率</th><th>聴牌率</th><th>副露率</th><th>受入</th><th>役別Shapley<br><small>共通上限 ${commonScale.toFixed(0)}点</small></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function normalizeCaptureRect(rect) {
  if (!rect) return null;
  const bounds = bigCoachView?.getBounds?.() || {};
  const maxWidth = Number(bounds.width) || 0;
  const maxHeight = Number(bounds.height) || 0;
  const x = Math.max(0, Math.floor(Number(rect.x) || 0));
  const y = Math.max(0, Math.floor(Number(rect.y) || 0));
  let width = Math.floor(Number(rect.width) || 0);
  let height = Math.floor(Number(rect.height) || 0);
  if (maxWidth > 0) width = Math.min(width, Math.max(0, maxWidth - x));
  if (maxHeight > 0) height = Math.min(height, Math.max(0, maxHeight - y));
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

async function captureBigCoachPage(rect, label) {
  const clip = normalizeCaptureRect(rect);
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      bigCoachView.webContents.invalidate();
      await executeAdapter("window.__bigcoachDesktop.waitForVisualPaint(2)").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      const image = await Promise.race([
        clip ? bigCoachView.webContents.capturePage(clip) : bigCoachView.webContents.capturePage(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} capture timed out`)), 10000))
      ]);
      log(`card capture: ${label} captured ${clip ? JSON.stringify(clip) : "full page"} attempt=${attempt}`);
      return image;
    } catch (error) {
      lastError = error;
      log(`card capture: ${label} capture failed attempt=${attempt}: ${error.stack || error}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error(`${label} capture failed`);
}

async function prepareCardImages() {
  await ensureAdapter();
  await executeAdapter("window.__bigcoachDesktop.closeOverlays()");
  const initialDisplayState = await executeAdapter("window.__bigcoachDesktop.captureDisplayState()");
  log(`card capture: initial display ${JSON.stringify(initialDisplayState)}`);
  const finalDisplayState = {
    showMortal: Boolean(initialDisplayState?.showMortal ?? true),
    showHands: false
  };
  let frontState;
  let backState;
  try {
    log("card capture: preparing front");
    frontState = await executeAdapter("window.__bigcoachDesktop.prepareCapture('front')");
    log(`card capture: front verified ${JSON.stringify(frontState.displayState)}`);
    await waitForStablePaint("front");
    let frontRect = frontState.rect;
    if (frontRect && frontState.relativeToFrame) {
      const frameRect = await bigCoachView.webContents.executeJavaScript(`(()=>{
        const frame=document.querySelector("iframe[title='Analysis Result'],iframe[title='Classic Analysis Result']");
        if(!frame)return null;
        const rect=frame.getBoundingClientRect();
        return {x:rect.x,y:rect.y};
      })()`, true);
      if (frameRect) frontRect = {
        ...frontRect,
        x: Math.floor(frontRect.x + frameRect.x),
        y: Math.floor(frontRect.y + frameRect.y)
      };
    }
    const frontImage = await captureBigCoachPage(frontRect, "front");
    log("card capture: front captured");
    log("card capture: preparing back");
    backState = await executeAdapter("window.__bigcoachDesktop.prepareCapture('back')");
    log(`card capture: back verified ${JSON.stringify(backState.displayState)}`);
    await waitForStablePaint("back");
    const backImage = await captureBigCoachPage(null, "back");
    log("card capture: back captured");
    currentCardImages = {
      frontDataUrl: frontImage.toDataURL(),
      backDataUrl: backImage.toDataURL(),
      outcomes: backState?.outcomes || null,
      captureDiagnostics: {
        front: frontState?.displayState || null,
        back: backState?.displayState || null,
        initial: initialDisplayState,
        final: null
      }
    };
    return currentCardImages;
  } finally {
    const restored = await executeAdapter(
      `window.__bigcoachDesktop.restoreCapture(${JSON.stringify(finalDisplayState)})`
    );
    if (restored.showHands || !restored.visualState.opponentsHidden) {
      throw new Error("カード画像撮影後に手牌表示OFFへ戻せませんでした。");
    }
    if (currentCardImages?.captureDiagnostics) currentCardImages.captureDiagnostics.final = restored;
    log(`card capture: restored normal display ${JSON.stringify(restored)}`);
  }
}

async function captureCurrentBigCoachImage() {
  await ensureAdapter();
  bigCoachView.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await captureBigCoachPage(null, "current");
  return image.toDataURL();
}

async function prepareRiskReadingFrontImage() {
  await ensureAdapter();
  await executeAdapter("window.__bigcoachDesktop.closeOverlays()");
  const finalDisplayState = { showMortal: true, showHands: false };
  try {
    const frontState = await executeAdapter("window.__bigcoachDesktop.prepareCapture('front')");
    await waitForStablePaint("front");
    let frontRect = frontState.rect;
    if (frontRect && frontState.relativeToFrame) {
      const frameRect = await bigCoachView.webContents.executeJavaScript(`(()=>{
        const frame=document.querySelector("iframe[title='Analysis Result'],iframe[title='Classic Analysis Result']");
        if(!frame)return null;
        const rect=frame.getBoundingClientRect();
        return {x:rect.x,y:rect.y};
      })()`, true);
      if (frameRect) frontRect = {
        ...frontRect,
        x: Math.floor(frontRect.x + frameRect.x),
        y: Math.floor(frontRect.y + frameRect.y)
      };
    }
    const image = await captureBigCoachPage(frontRect, "risk-front");
    return image.toDataURL();
  } finally {
    await executeAdapter(
      `window.__bigcoachDesktop.restoreCapture(${JSON.stringify(finalDisplayState)})`
    ).catch((error) => log(`risk reading capture restore failed: ${error.stack || error}`));
  }
}

function cardVisualStateMatches(mode, state) {
  return mode === "front"
    ? !state.aiBarsVisible && !state.aiAdviceVisible && state.opponentsHidden
    : ((state.aiBarsVisible && state.aiAdviceVisible) ||
        (state.aiDisplayChecked && state.noAnalysisDataVisible)) && state.opponentsRevealed;
}

function cardVisualStateSignature(state) {
  return JSON.stringify({
    aiBarsVisible: Boolean(state?.aiBarsVisible),
    aiAdviceVisible: Boolean(state?.aiAdviceVisible),
    noAnalysisDataVisible: Boolean(state?.noAnalysisDataVisible),
    opponentsRevealed: Boolean(state?.opponentsRevealed),
    opponentsHidden: Boolean(state?.opponentsHidden)
  });
}

async function waitForStablePaint(mode) {
  log(`card capture: waiting for ${mode} compositor paint`);
  await executeAdapter("window.__bigcoachDesktop.waitForVisualPaint(5)");
  bigCoachView.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const first = await executeAdapter("window.__bigcoachDesktop.captureVisualState()");
  await executeAdapter("window.__bigcoachDesktop.waitForVisualPaint(2)");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = await executeAdapter("window.__bigcoachDesktop.captureVisualState()");
  if (!cardVisualStateMatches(mode, first) || !cardVisualStateMatches(mode, second) ||
      cardVisualStateSignature(first) !== cardVisualStateSignature(second)) {
    throw new Error(
      `${mode} card rendering is not stable. ` +
      "Please try again after BigCoach finishes updating the display."
    );
  }
  log(`card capture: ${mode} compositor stable ${JSON.stringify(second)}`);
  return second;
}

function judgmentPrompt(scene) {
  if (scene.judgmentType === "call") return "副露？";
  if (scene.judgmentType === "riichi") return "リーチ？";
  return "何切？";
}

function cardHtml(scene, simulation, memo, images, mediaMode = "preview", options = {}) {
  const comparison = comparisonStatus(scene, simulation);
  const frontNote = String(options.frontNote || "").trim();
  const front = `
    <div class="bigcoach-card">
      <div style="font-size:1px;color:#fff">BigCoach:${escapeHtml(scene.sceneId)}</div>
      <h2 style="text-align:center;font-size:28px">${judgmentPrompt(scene)}</h2>
      ${frontNote ? `<div style="text-align:center;font-size:18px;font-weight:700;margin:-8px 0 10px">${escapeHtml(frontNote)}</div>` : ""}
      <img src="${escapeHtml(images.front)}" style="max-width:100%">
    </div>`;
  const back = `
    <div class="bigcoach-card">
      <h2>メモ</h2><div>${escapeHtml(memo || "（なし）").replace(/\n/g, "<br>")}</div>
      <img src="${escapeHtml(images.back)}" style="max-width:100%">
      <h2>何切る比較</h2>
      <p>実打: ${tileHtml(comparison.actual, mediaMode)} / BigCoach推奨: ${tileHtml(comparison.bigCoach, mediaMode)} / シミュレーター推奨: ${tileHtml(comparison.simulator, mediaMode)}</p>
      <p>BigCoachとシミュレーター: <strong>${comparison.bigCoachMatchesSimulator ? "一致" : "不一致"}</strong></p>
      ${candidateTable("何切る結果（見えている牌を残り枚数から除外）", simulation?.withWall, mediaMode)}
      ${candidateTable("何切る結果（補正なし）", simulation?.withoutWall, mediaMode)}
      <hr><p><a href="${escapeHtml(scene.url)}">BigCoach解析結果</a></p>
      <p>局面ID: ${escapeHtml(scene.sceneId)}</p>
    </div>`;
  return { front, back, comparison };
}

async function ankiDeckChoices(fallbackDeckName) {
  const decks = await anki.listDecks().catch(() => []);
  const selectedDeck = fallbackDeckName || settings.deckName;
  return {
    decks: [...new Set([selectedDeck, ...decks].filter(Boolean))],
    deckName: selectedDeck
  };
}

function riskOpponent(scene, targetKey) {
  const opponents = scene?.dealInRisk?.opponents || [];
  return opponents.find((item) => item.key === targetKey) || null;
}

function riskRatePercent(rate) {
  return `${(Number(rate || 0) * 100).toFixed(2)}%`;
}

const RISK_TILE_CODES_34 = [
  "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
  "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
  "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
  "1z", "2z", "3z", "4z", "5z", "6z", "7z"
];

const RISK_TABLE_COLUMNS = [
  "スジ19", "スジ2378", "片スジ456", "両スジ456", "無スジ19", "無スジ2378", "無スジ456",
  "1枚見えオタ風", "2枚見えオタ風", "3枚見えオタ風", "1枚見え役牌", "2枚見え役牌", "3枚見え役牌"
];

const RISK_TABLE_ROWS = [
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"],
  ["~5%", "~10%", "~10%", "~5%", "~10%", "~10%", "~15%", "~5%", "~5%", "~5%", "~10%", "~5%", "~5%"]
];

function riskTableValue(turn, category) {
  const row = RISK_TABLE_ROWS[Math.max(1, Math.min(18, Number(turn || 1))) - 1];
  const index = RISK_TABLE_COLUMNS.indexOf(category);
  return index >= 0 ? riskRange(row[index]) : null;
}

function tileIndex34(code) {
  const normalized = code?.[0] === "0" ? `5${code[1]}` : code;
  return RISK_TILE_CODES_34.indexOf(normalized);
}

function windOffset(wind) {
  return { "1z": 0, "2z": 1, "3z": 2, "4z": 3 }[wind] ?? 0;
}

function targetSeatWind(scene, opponent) {
  const base = windOffset(scene.seatWind);
  const offset = { shimocha: 1, toimen: 2, kamicha: 3 }[opponent.key] ?? Number(opponent.seat || 0);
  return `${((base + offset) % 4) + 1}z`;
}

function visibleCounts(scene) {
  const counts = new Map();
  const tiles = [
    ...(scene.handTiles || []),
    ...(scene.doraTiles || []),
    ...(scene.riverTiles || []),
    ...(scene.callTiles || [])
  ];
  for (const tile of tiles) {
    const normalized = tile?.[0] === "0" ? `5${tile[1]}` : tile;
    if (normalized) counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return counts;
}

function genbutsuTiles(scene, opponent) {
  const absoluteSeat = relativeSeatToAbsolute(scene, opponent.seat);
  const fromRiver = new Set((scene.discardsBySeat?.[absoluteSeat] || [])
    .map((tile) => tile?.[0] === "0" ? `5${tile[1]}` : tile)
    .filter(Boolean));
  const opponentIndex = (scene.dealInRisk?.opponents || []).findIndex((item) => item.key === opponent.key);
  const fromBigCoach = new Set((scene.dealInRisk?.genbutsu?.[opponentIndex] || [])
    .map((index) => RISK_TILE_CODES_34[Number(index)])
    .filter(Boolean));
  return new Set([...fromRiver, ...fromBigCoach]);
}

function riskCategoryForTile(tile, scene, opponent, genbutsu, counts) {
  const normalized = tile?.[0] === "0" ? `5${tile[1]}` : tile;
  if (!normalized) return null;
  if (genbutsu.has(normalized)) return "現物";
  const number = Number(normalized[0]);
  const suit = normalized[1];
  if (suit === "z") {
    const visible = Math.max(1, Math.min(3, counts.get(normalized) || 0));
    const yakuhai = ["5z", "6z", "7z", scene.roundWind, targetSeatWind(scene, opponent)].includes(normalized);
    return `${visible}枚見え${yakuhai ? "役牌" : "オタ風"}`;
  }
  const has = (n) => genbutsu.has(`${n}${suit}`);
  if ([1, 2, 3, 7, 8, 9].includes(number)) {
    const target = number <= 3 ? number + 3 : number - 3;
    const suji = has(target);
    if (number === 1 || number === 9) return suji ? "スジ19" : "無スジ19";
    return suji ? "スジ2378" : "無スジ2378";
  }
  if (number === 4 || number === 5 || number === 6) {
    const left = has(number - 3);
    const right = has(number + 3);
    if (left && right) return "両スジ456";
    if (left || right) return "片スジ456";
    return "無スジ456";
  }
  return null;
}

function buildRiskReadingProblem(scene, targetKey, threshold = 0.03) {
  const opponent = riskOpponent(scene, targetKey);
  if (!opponent) return null;
  const counts = visibleCounts(scene);
  const genbutsu = genbutsuTiles(scene, opponent);
  const byTile = new Map((opponent.rates || []).map((item) => [item.tile, Number(item.rate || 0)]));
  const items = RISK_TILE_CODES_34.map((tile) => {
    const category = riskCategoryForTile(tile, scene, opponent, genbutsu, counts);
    const expected = category ? riskTableValue(scene.currentTurn, category) : null;
    const actual = byTile.get(tile) || 0;
    const deviation = expected
      ? Math.max(0, expected.min - actual, actual - expected.max)
      : 0;
    return {
      tile,
      category,
      expected: category === "現物" ? { min: 0, max: 0, label: "現物" } : expected,
      actual,
      deviation,
      isQuestion: Boolean(expected && category !== "現物" && deviation >= Number(threshold || 0))
    };
  }).filter((item) => item.category && item.expected);
  return {
    opponent,
    items,
    questions: items.filter((item) => item.isQuestion),
    threshold: Number(threshold || 0),
    turn: Math.max(1, Math.min(18, Number(scene.currentTurn || 1)))
  };
}

function riskProblemTableHtml(problem, mediaMode = "preview", showActual = false) {
  const questions = problem.questions || [];
  const questionSummary = questions.length ? `
    <div class="risk-question-summary">
      <div class="risk-question-summary-title">出題</div>
      <div class="risk-question-strip">
        ${questions.map((item) => `
          <div class="risk-question-card ${riskRowBand(item)}">
            <div class="risk-question-tile">${tileHtml(item.tile, mediaMode)}</div>
          </div>`).join("")}
      </div>
    </div>
  ` : "";
  const suits = [
    ["m", ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m"]],
    ["p", ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"]],
    ["s", ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s"]],
    ["z", ["1z", "2z", "3z", "4z", "5z", "6z", "7z"]]
  ];
  const itemByTile = new Map(problem.items.map((item) => [item.tile, item]));
  const rows = suits.map(([label, tiles]) => `
    <div class="risk-suit-row">
      <div class="risk-suit-cells">
        ${tiles.map((tile) => {
          const item = itemByTile.get(tile);
          if (!item) {
            return `<div class="risk-suit-cell empty"><div class="risk-suit-tile">${tileHtml(tile, mediaMode)}</div></div>`;
          }
          return `
            <div class="risk-suit-cell ${riskRowBand(item)} ${item.isQuestion ? "risk-question" : ""}">
              <div class="risk-suit-tile">${tileHtml(item.tile, mediaMode)}</div>
              <div class="risk-suit-category">${escapeHtml(riskCategoryShort(item.category))}</div>
              <div class="risk-suit-basis">${escapeHtml(riskRangeShort(item.expected))}</div>
              <div class="risk-suit-actual">${item.isQuestion ? "出題" : (showActual ? riskRatePercent(item.actual) : "")}</div>
            </div>`;
        }).join("")}
      </div>
    </div>`).join("");
  return `${questionSummary}
  <div class="risk-suit-table">${rows}</div>`;
}

function riskHeatmapHtml(opponent, mediaMode = "preview") {
  const groups = [
    ["萬子", ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m"]],
    ["筒子", ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"]],
    ["索子", ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s"]],
    ["字牌", ["1z", "2z", "3z", "4z", "5z", "6z", "7z"]]
  ];
  const byTile = new Map((opponent?.rates || []).map((item) => [item.tile, Number(item.rate || 0)]));
  const genbutsu = new Set((opponent?.genbutsu || []).map((index) => RISK_TILE_CODES_34[Number(index)]).filter(Boolean));
  const cell = (tile) => {
    const rate = byTile.get(tile) || 0;
    const band = riskRateBand(rate);
    const palette = {
      "band-5": { background: "#1e4f38", color: "#f2fff8", label: "~5%" },
      "band-10": { background: "#5d7a22", color: "#f8ffef", label: "~10%" },
      "band-15": { background: "#a06b16", color: "#fff7ea", label: "~15%" },
      "band-20": { background: "#b84d1d", color: "#fff4ea", label: "~20%" },
      "band-20p": { background: "#8e2430", color: "#fff2f4", label: "20%~" }
    }[band];
    const badge = genbutsu.has(tile) ? `<div class="risk-heatmap-genbutsu">現物</div>` : "";
    return `<td style="text-align:center;background:${palette.background};color:${palette.color};border:1px solid #ddd;padding:5px">
      <div>${tileHtml(tile, mediaMode)}</div>
      <strong style="display:block;font-size:13px">${riskRatePercent(rate)}</strong>
      ${badge}
    </td>`;
  };
  return `<div class="risk-heatmap">
    ${groups.map(([label, tiles]) => `<h3>${label}</h3>
      <table style="width:auto;border-collapse:collapse;margin-bottom:10px"><tbody><tr>
        ${tiles.map(cell).join("")}
      </tr></tbody></table>`).join("")}
  </div>`;
}

function riskReadingCardHtml(scene, frontImage, targetKey, memo, mediaMode = "preview") {
  const problem = buildRiskReadingProblem(scene, targetKey, settings.riskReadingDeviationThreshold);
  if (!problem?.opponent) {
    throw new Error("この局面から指定した相手の放銃危険度を取得できませんでした。");
  }
  if (!problem.questions.length) {
    throw new Error("設定した乖離幅以上にテーブルから外れた牌がありません。");
  }
  const opponent = problem.opponent;
  const structured = {
    schema: "bigcoach-risk-reading/v1",
    sceneId: scene.sceneId,
    sourceUrl: scene.url,
    target: { key: opponent.key, label: opponent.label, seat: opponent.seat },
    threshold: problem.threshold,
    questions: problem.questions,
    classifiedTiles: problem.items,
    allOpponents: scene.dealInRisk?.opponents || [],
    roundText: scene.roundText,
    turn: scene.currentTurn,
    handMpsz: scene.handMpsz
  };
  const questionText = problem.questions.map((item) =>
    `${item.tile}（${item.category} / 表: ${item.expected.label}）`).join("、");
  const front = `
    <div class="bigcoach-risk-card" data-schema="bigcoach-risk-reading/v1" data-scene-id="${escapeHtml(scene.sceneId)}">
      <h2 style="text-align:center">危険度読み: ${escapeHtml(opponent.label)}</h2>
      <p><strong>${escapeHtml(opponent.label)}への放銃率が表の基準から外れている牌を読む。</strong></p>
      <img src="${escapeHtml(frontImage)}" style="max-width:100%">
      <h2>表から参照した基準</h2>
      <div class="risk-table-note">表の基準: ~5%, ~10%, ~15%, ~20%, 20%~</div>
      ${riskProblemTableHtml(problem, mediaMode, false)}
    </div>`;
  const back = `
    <div class="bigcoach-risk-card" data-schema="bigcoach-risk-reading/v1" data-scene-id="${escapeHtml(scene.sceneId)}">
      <h2>危険度読み: ${escapeHtml(opponent.label)}</h2>
      <div style="margin-bottom:10px">${escapeHtml(memo || "").replace(/\n/g, "<br>")}</div>
      <img src="${escapeHtml(frontImage)}" style="max-width:100%">
      <h2>基準表と実測放銃率</h2>
      <div class="risk-table-note">表の基準: ~5%, ~10%, ~15%, ~20%, 20%~</div>
      ${riskProblemTableHtml(problem, mediaMode, true)}
      <h2>生の放銃危険度ヒートマップ</h2>
      ${riskHeatmapHtml(opponent, mediaMode)}
      <details><summary>加工用JSON</summary><pre data-format="bigcoach-risk-reading/v1">${escapeHtml(JSON.stringify(structured))}</pre></details>
      <p><a href="${escapeHtml(scene.url)}">BigCoach解析結果</a> / 局面ID: ${escapeHtml(scene.sceneId)}</p>
    </div>`;
  return { front, back, structured, opponent };
}

async function storeRiskReadingTileMedia(scene) {
  const codes = new Set((scene.dealInRisk?.opponents || [])
    .flatMap((opponent) => opponent.rates || [])
    .map((item) => item.tile)
    .filter((code) => safeTileFilename(code)));
  return Promise.all([...codes].map((code) => {
    const filename = safeTileFilename(code);
    const data = fs.readFileSync(path.join(tileImagesDirectory(), filename)).toString("base64");
    return anki.storeMedia(`bigcoach_tile_${filename}`, data);
  }));
}

async function registerRiskReadingCard(payload = {}) {
  const scene = await captureScene();
  const target = payload.target || "kamicha";
  const opponent = riskOpponent(scene, target);
  if (!opponent) {
    throw new Error("BigCoachの放銃危険度ヒートマップを取得できませんでした。解析結果画面で局面を表示してから再試行してください。");
  }
  const cached = currentRiskReadingPreview?.sceneId === scene.sceneId &&
    currentRiskReadingPreview?.target === target
    ? currentRiskReadingPreview
    : await previewRiskReadingCard(payload);
  const frontDataUrl = cached.frontDataUrl;
  const frontName = await anki.storeImage(frontDataUrl, `${scene.sceneId}_${target}`, "risk_front");
  await storeRiskReadingTileMedia(scene);
  const dedicatedSettings = {
    ...settings,
    deckName: payload.deckName || settings.riskReadingDeckName || `${settings.deckName}::RiskReading`
  };
  const riskScene = {
    ...scene,
    sceneId: `${scene.sceneId}_${target}`
  };
  const html = riskReadingCardHtml(
    scene,
    frontName,
    target,
    payload.memo || settings.riskReadingNote || "",
    "anki"
  );
  const registration = await anki.add({
    settings: dedicatedSettings,
    scene: riskScene,
    frontHtml: html.front,
    backHtml: html.back,
    duplicateMode: payload.duplicateMode || "skip",
    duplicatePrefix: "BigCoach_RiskReading_ID",
    extraTags: ["RiskReading", "BigCoach_RiskReading", `Risk_${opponent.key}`]
  });
  return { ...registration, deckName: dedicatedSettings.deckName, opponent, riskReading: html.structured };
}

async function previewRiskReadingCard(payload = {}) {
  const scene = await captureScene();
  const target = payload.target || "kamicha";
  const opponent = riskOpponent(scene, target);
  if (!opponent) {
    throw new Error("BigCoachの放銃危険度ヒートマップを取得できませんでした。解析結果画面で局面を表示してから再試行してください。");
  }
  const frontDataUrl = currentCardImages?.frontDataUrl || await prepareRiskReadingFrontImage();
  const html = riskReadingCardHtml(
    scene,
    frontDataUrl,
    target,
    payload.memo || settings.riskReadingNote || "",
    "preview"
  );
  currentRiskReadingPreview = {
    sceneId: scene.sceneId,
    target,
    memo: payload.memo || "",
    frontDataUrl,
    html
  };
  const duplicates = await anki.findDuplicates(`${scene.sceneId}_${target}`, "BigCoach_RiskReading_ID").catch(() => []);
  const deckChoices = await ankiDeckChoices(settings.riskReadingDeckName || `${settings.deckName}::RiskReading`);
  return {
    ...html,
    scene,
    duplicates,
    frontDataUrl,
    deckName: deckChoices.deckName,
    decks: deckChoices.decks
  };
}

function tileRowHtml(codes, mediaMode = "preview", height = 54) {
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;align-items:flex-end">${
    (codes || []).map((code) => tileHtml(code, mediaMode).replace("height:38px", `height:${height}px`)).join("")
  }</div>`;
}

async function refreshStats() {
  const decisions = await loadDecisions();
  const sourceUrl = bigCoachView.webContents.getURL();
  const currentRecords = buildRoundRecords(decisions, sourceUrl);
  const merged = mergeRoundRecords(readJson(statsPath(), { version: 2, rounds: {}, analyses: {} }), currentRecords);
  writeJson(statsPath(), merged);
  return {
    current: summarizeRecords(currentRecords, settings),
    cumulative: summarizeRecords(Object.values(merged.rounds), settings),
    uniqueRounds: Object.keys(merged.rounds).length,
    currentRounds: currentRecords.length,
    trend: buildTrend(merged, settings)
  };
}

function scheduleAutomaticStatsRefresh() {
  clearTimeout(statsRefreshTimer);
  statsRefreshTimer = setTimeout(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await waitForAnalysisReady(1000);
        const result = await refreshStats();
        mainWindow?.webContents.send("stats:updated", result);
        return;
      } catch (error) {
        if (attempt === 19) log(`automatic stats refresh failed: ${error.stack || error}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }, 300);
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
    result.bigCoach = {
      ok: url.startsWith("https://gokujan.com") || url.startsWith("https://review.bigcoach.work"),
      message: url || "未読込"
    };
  } catch (error) { result.bigCoach.message = error.message; }
  try {
    const scene = await captureScene();
    const handSummary = scene.handsBySeat.length === 4
      ? scene.handsBySeat.map((hand, index) => `P${index}:${hand.length}枚`).join(" / ")
      : "4人分を取得できません";
    result.scene = {
      ok: scene.handTiles.length > 0 && scene.handsBySeat.length === 4,
      message: scene.handTiles.length ? `4人手牌 ${handSummary}` : `不足: ${scene.missing.join("、")}`,
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
    history: readJson(historyPath(), []),
    tileImages: tileDataUrls()
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
    currentRiskReadingPreview = null;
    currentDecisions = [];
    await loadBigCoachReviewUrl(url);
    const history = saveReviewHistory(url);
    return { url, history };
  });
  ipcMain.handle("bigcoach:history", () => readJson(historyPath(), []));
  ipcMain.handle("bigcoach:stock-first-discards", () => stockFirstDiscards());
  ipcMain.handle("bigcoach:hand-score", async () => {
    const scene = currentScene || await captureScene();
    currentScene = scene;
    return { scene, score: calculateHandScore(scene, settings) };
  });
  ipcMain.handle("bigcoach:reload", async () => {
    await bigCoachView.webContents.loadURL(bigCoachUrl());
    return true;
  });
  ipcMain.handle("simulator:run", async () => {
    const scene = await captureScene();
    currentSimulation = await ensureSimulation(scene);
    return {
      scene,
      simulation: currentSimulation,
      comparison: comparisonStatus(scene, currentSimulation)
    };
  });
  ipcMain.handle("settings:save", (_event, next) => saveSettings(next));
  ipcMain.handle("app:diagnose", () => diagnose());
  ipcMain.handle("stats:refresh", () => refreshStats());
  ipcMain.handle("anki:preview-risk-reading", (_event, payload) => previewRiskReadingCard(payload));
  ipcMain.handle("anki:register-risk-reading", (_event, payload) => registerRiskReadingCard(payload));
  ipcMain.handle("anki:preview", async (_event, payload) => {
    const memo = typeof payload === "object" && payload ? payload.memo : payload;
    const frontNote = typeof payload === "object" && payload ? payload.frontNote : "";
    const scene = await captureScene();
    await ensureSimulation(scene);
    currentCardImages = null;
    const images = await prepareCardImages();
    const duplicates = await anki.findDuplicates(scene.sceneId, "BigCoach_ID").catch(() => []);
    const deckChoices = await ankiDeckChoices(settings.deckName);
    const html = cardHtml(scene, currentSimulation, memo, {
      front: images.frontDataUrl,
      back: images.backDataUrl
    }, "preview", { frontNote });
    const previewId = `${scene.sceneId}-${Date.now()}`;
    currentCardPreview = {
      previewId,
      scene,
      simulation: currentSimulation,
      images,
      memo: memo || "",
      frontNote,
      html,
      comparison: comparisonStatus(scene, currentSimulation),
      captureDiagnostics: images.captureDiagnostics
    };
    return {
      previewId,
      scene,
      ...html,
      duplicates,
      decks: deckChoices.decks,
      deckName: deckChoices.deckName,
      simulation: currentSimulation,
      comparison: currentCardPreview.comparison,
      captureDiagnostics: images.captureDiagnostics
    };
  });
  ipcMain.handle("anki:register", async (_event, payload) => {
    payload = payload || {};
    const preview = currentCardPreview;
    if (!preview || preview.previewId !== payload.previewId) {
      throw new Error("プレビュー内容が見つかりません。もう一度カード内容をプレビューしてから登録してください。");
    }
    const scene = preview.scene;
    const simulation = preview.simulation;
    const images = preview.images;
    let frontName;
    let backName;
    try {
      frontName = await anki.storeImage(images.frontDataUrl, scene.sceneId, "front");
      backName = await anki.storeImage(images.backDataUrl, scene.sceneId, "back");
    } catch (error) {
      throw new Error(`Ankiにカード画像を保存できませんでした: ${error.message}`);
    }
    const tileCodes = new Set([
      scene.actualDiscard,
      scene.recommendedDiscard,
      simulation?.withWall?.recommendation,
      simulation?.withoutWall?.recommendation,
      ...scene.handTiles,
      ...scene.doraTiles,
      scene.roundWind,
      scene.seatWind,
      ...[simulation?.withWall, simulation?.withoutWall].flatMap((analysis) =>
        (analysis?.candidates || []).flatMap((candidate) =>
          [candidate.tile, ...(candidate.ukeire || []).map((item) => item.tile)]))
    ].filter((code) => safeTileFilename(code)));
    try {
      for (const code of tileCodes) {
        const filename = safeTileFilename(code);
        if (!filename) continue;
        const data = fs.readFileSync(path.join(tileImagesDirectory(), filename)).toString("base64");
        await anki.storeMedia(`bigcoach_tile_${filename}`, data);
      }
    } catch (error) {
      throw new Error(`Ankiに牌画像を保存できませんでした: ${error.message}`);
    }
    try {
      const html = cardHtml(scene, simulation, preview.memo || "", {
        front: frontName,
        back: backName
      }, "anki", { frontNote: preview.frontNote || "" });
      const registrationSettings = {
        ...settings,
        deckName: payload.deckName || settings.deckName
      };
      return await anki.add({
        settings: registrationSettings,
        scene,
        frontHtml: html.front,
        backHtml: html.back,
        duplicateMode: payload.duplicateMode || "skip"
      });
    } catch (error) {
      throw new Error(`Ankiカードを登録できませんでした: ${error.message}`);
    } finally {
      if (currentCardPreview?.previewId === payload.previewId) currentCardPreview = null;
      currentCardImages = null;
    }
  });
  ipcMain.handle("app:open-logs", () => shell.openPath(logPath));
  ipcMain.handle("layout:overlay-open", (_event, open) => {
    const hidden = Boolean(open);
    if (bigCoachView && hidden !== bigCoachHiddenForOverlay) {
      bigCoachHiddenForOverlay = hidden;
      bigCoachView.setVisible(!hidden);
      log(`BigCoach view ${hidden ? "hidden" : "shown"} for app dialog`);
    }
    return { visible: !bigCoachHiddenForOverlay };
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
  const bigCoachSession = session.fromPartition("persist:bigcoach");
  authSessionStore = new AuthSessionStore({
    electronSession: bigCoachSession,
    safeStorage,
    filePath: path.join(app.getPath("userData"), "bigcoach-auth-session.bin"),
    log
  });
  await authSessionStore.restore();
  authSessionStore.start();

  bigCoachView = createBigCoachView();
  mainWindow.contentView.addChildView(bigCoachView);
  layoutViews();
  mainWindow.on("resize", layoutViews);
  const initialUrl = process.env.BIGCOACH_E2E_REVIEW_URL || bigCoachUrl();
  bigCoachView.webContents.loadURL(initialUrl)
    .catch((error) => log(`initial BigCoach loadURL reported ${error.code || error.message} for ${initialUrl}`));
  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
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

app.on("before-quit", (event) => {
  if (quitAfterSessionFlush || !authSessionStore) return;
  event.preventDefault();
  quitAfterSessionFlush = true;
  authSessionStore.flush()
    .catch((error) => log(error.stack || error))
    .finally(() => app.quit());
});
