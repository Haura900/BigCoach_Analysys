"use strict";

const { app, BrowserWindow, WebContentsView, ipcMain, shell, session, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { normalizeScene, validateScene } = require("./lib/scene");
const { SimulatorService } = require("./lib/simulator");
const { AnkiService } = require("./lib/anki");
const { AuthSessionStore } = require("./lib/auth-session");
const { codesToMpsz, tileFilename } = require("./lib/tiles");
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
const {
  prefilterNanikiruDecisions,
  precheckNanikiruMistake,
  classifyNanikiruMistake
} = require("./lib/nanikiru-mistake");

const DEFAULT_SETTINGS = {
  settingsVersion: 3,
  deckName: "BigCoach",
  nanikiruMistakeDeckName: "BigCoach::何切る悪手",
  modelName: "基本",
  tags: ["BigCoach", "何切る"],
  language: "ja",
  enableRedDora: true,
  enableUraDora: false,
  enableShantenDown: true,
  enableTegawari: true,
  enableRiichi: false,
  simulatorTimeoutSec: 30,
  shinMistakeThreshold: 0.001,
  panelWidth: 500
};

let mainWindow;
let bigCoachView;
let settings;
let currentScene;
let currentSimulation;
let currentMajorMistakes = [];
let currentDecisions = [];
let currentNanikiruMistakes = null;
let currentCardImages;
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

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (!saved.settingsVersion || saved.settingsVersion < 2) {
      if (Number(saved.shinMistakeThreshold) === 0.1) saved.shinMistakeThreshold = 0.001;
    }
    saved.settingsVersion = 3;
    return { ...DEFAULT_SETTINGS, ...saved };
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
  currentNanikiruMistakes = null;
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

function findAnalysisFrame(frame = bigCoachView?.webContents.mainFrame) {
  if (!frame) return null;
  if (/\/ui_advanced(?:\/|[?#]|$)/.test(frame.url || "")) return frame;
  for (const child of frame.frames || []) {
    const found = findAnalysisFrame(child);
    if (found) return found;
  }
  return null;
}

async function waitForAnalysisFrame(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = findAnalysisFrame();
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("BigCoachの解析表示フレームを取得できませんでした。");
}

async function executeAdapter(expression) {
  const frame = await waitForAnalysisFrame();
  return frame.executeJavaScript(expression, true);
}

async function ensureAdapter() {
  if (!bigCoachView || bigCoachView.webContents.isDestroyed()) throw new Error("BigCoach表示が初期化されていません。");
  const frame = await waitForAnalysisFrame();
  const exists = await frame.executeJavaScript("Boolean(window.__bigcoachDesktop)", true);
  if (!exists) await frame.executeJavaScript(adapterSource, true);
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
  throw new Error("BigCoachの解析結果が読み込まれるまで待機しましたが、タイムアウトしました。");
}

async function captureScene() {
  await ensureAdapter();
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
    nanikiruMistake: {
      ...precheckNanikiruMistake(normalized),
      isNanikiruMistake: false
    }
  };
  currentSimulation = null;
  currentCardImages = null;
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

async function goToDecision(decision) {
  await ensureAdapter();
  const result = await executeAdapter(
    `window.__bigcoachDesktop.goToPosition(${Number(decision.handCounter)},${Number(decision.plyCounter)})`
  );
  if (!result.ok) throw new Error(result.reason || "指定局面へ移動できませんでした。");
  return captureScene();
}

function nanikiruPositionKey(decision) {
  return `${Number(decision.handCounter)}:${Number(decision.plyCounter)}`;
}

function ensureNanikiruCache() {
  if (!currentNanikiruMistakes) {
    currentNanikiruMistakes = { evaluated: new Map() };
  }
  return currentNanikiruMistakes;
}

async function evaluateNanikiruDecision(decision) {
  const cache = ensureNanikiruCache();
  const key = nanikiruPositionKey(decision);
  if (cache.evaluated.has(key)) return cache.evaluated.get(key);
  const scene = await goToDecision(decision);
  const precheck = precheckNanikiruMistake(scene);
  if (!precheck.eligible) {
    const result = { scene, simulation: null, classification: { ...precheck, isNanikiruMistake: false } };
    cache.evaluated.set(key, result);
    return result;
  }
  log(`nanikiru scan: simulating ${key} ${scene.roundText} ${scene.currentTurn}巡目`);
  const simulation = await simulator.analyze(scene, settings);
  const classification = classifyNanikiruMistake(scene, simulation);
  const result = { scene, simulation, classification };
  cache.evaluated.set(key, result);
  if (classification.isNanikiruMistake) log(`nanikiru scan: matched ${key}`);
  return result;
}

async function navigateNanikiru(kind, decisions, current) {
  ensureNanikiruCache();
  const direction = kind.startsWith("previous") ? -1 : 1;
  const candidates = prefilterNanikiruDecisions(decisions).sort(comparePosition);
  if (!candidates.length) throw new Error("何切る悪手の事前条件を満たす局面がありません。");
  const currentPosition = {
    handCounter: Number(current?.handCounter ?? -1),
    plyCounter: Number(current?.plyCounter ?? -1)
  };
  const start = direction > 0
    ? candidates.findIndex((item) => comparePosition(item, currentPosition) > 0)
    : [...candidates].reverse().findIndex((item) => comparePosition(item, currentPosition) < 0);
  const normalizedStart = start < 0
    ? 0
    : direction > 0 ? start : candidates.length - 1 - start;
  const ordered = Array.from({ length: candidates.length }, (_, offset) => {
    const index = (normalizedStart + direction * offset + candidates.length) % candidates.length;
    return candidates[index];
  });
  const original = current;
  for (const decision of ordered) {
    const { simulation, classification } = await evaluateNanikiruDecision(decision);
    if (classification.isNanikiruMistake) {
      const scene = await goToDecision(decision);
      scene.nanikiruMistake = classification;
      currentSimulation = simulation;
      return scene;
    }
  }
  if (original) await goToDecision(original);
  throw new Error("該当する何切る悪手がありません。");
}

async function navigateExcludingNanikiru(kind, targets, current) {
  const direction = kind.startsWith("previous") ? -1 : 1;
  const possibleNanikiru = new Set(
    prefilterNanikiruDecisions(targets).map(nanikiruPositionKey)
  );
  const filteredTargets = targets.filter((target) =>
    !possibleNanikiru.has(nanikiruPositionKey(target)));
  if (!filteredTargets.length) {
    throw new Error("何切る悪手候補を除く該当局面がありません。");
  }
  const currentPosition = {
    handCounter: Number(current?.handCounter ?? -1),
    plyCounter: Number(current?.plyCounter ?? -1)
  };
  const sorted = [...filteredTargets].sort(comparePosition);
  const start = direction > 0
    ? sorted.findIndex((item) => comparePosition(item, currentPosition) > 0)
    : [...sorted].reverse().findIndex((item) => comparePosition(item, currentPosition) < 0);
  const normalizedStart = start < 0 ? 0 : direction > 0 ? start : sorted.length - 1 - start;
  const ordered = Array.from({ length: sorted.length }, (_, offset) =>
    sorted[(normalizedStart + direction * offset + sorted.length) % sorted.length]);
  return goToDecision(ordered[0]);
}

async function navigate(kind) {
  const decisions = await loadDecisions();
  const current = currentScene?.sourcePosition || (await captureScene()).sourcePosition;
  const direction = kind.startsWith("previous") ? -1 : 1;
  if (kind.endsWith("Nanikiru")) {
    return navigateNanikiru(kind, decisions, current);
  }
  let targets;
  if (kind === "previous" || kind === "next") {
    targets = decisions.filter((item) => /^[0-9][mpsz]$/.test(item.actual || ""));
  } else if (kind.endsWith("Mistake")) {
    targets = decisions.filter((item) => item.isBad);
  } else if (kind.endsWith("Shin")) {
    targets = listShinMistakes(decisions, settings);
  } else if (kind.endsWith("Major")) {
    targets = listMajorMistakes(decisions, settings);
  } else {
    throw new Error(`未対応の移動操作です: ${kind}`);
  }
  if (!targets.length) throw new Error("該当する局面がありません。");
  if (kind.endsWith("Shin") || kind.endsWith("Major")) {
    return navigateExcludingNanikiru(kind, targets, current);
  }
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
    definition: `1シャンテン以下・聴牌・他家リーチ時に、実打とAI推奨が異なり、実打推奨度が${(Number(settings.shinMistakeThreshold) * 100).toFixed(1)}%以下の局面`
  };
}

async function goToMajorMistake(mismatchOrdinal) {
  const decisions = await loadDecisions();
  const target = listMajorMistakes(decisions, settings).find((item) =>
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

async function ensureSimulation(scene) {
  if (currentSimulation) {
    scene.nanikiruMistake = classifyNanikiruMistake(scene, currentSimulation);
    return currentSimulation;
  }
  if (scene.judgmentType === "call") {
    currentSimulation = {
      withWall: { candidates: [], recommendation: null },
      withoutWall: { candidates: [], recommendation: null },
      skippedReason: "副露判断のため何切るシミュレーター対象外"
    };
    return currentSimulation;
  }
  currentSimulation = await simulator.analyze(scene, settings);
  scene.nanikiruMistake = classifyNanikiruMistake(scene, currentSimulation);
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
  if (!code || !tileFilename(code)) return `<span>${escapeHtml(code || "取得なし")}</span>`;
  const src = mediaMode === "anki"
    ? `bigcoach_tile_${tileFilename(code)}`
    : tileDataUrls()[code];
  return `<img src="${src}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}" style="height:38px;vertical-align:middle">`;
}

function candidateTable(title, analysis, mediaMode = "preview") {
  if (!analysis?.candidates?.length) return `<h3>${escapeHtml(title)}</h3><p>結果なし</p>`;
  const rows = analysis.candidates.map((candidate) => `
    <tr><td>${tileHtml(candidate.tile, mediaMode)}</td><td>${candidate.expectedScore.toFixed(0)}</td>
    <td>${(candidate.winProbability * 100).toFixed(2)}%</td>
    <td>${(candidate.tenpaiProbability * 100).toFixed(2)}%</td>
    <td><div style="display:flex;flex-wrap:wrap;gap:2px">${candidate.ukeire.map((item) =>
      `<span style="display:inline-flex;align-items:end">${tileHtml(item.tile, mediaMode)}<small>×${item.count}</small></span>`).join("")}</div>
    <div>${candidate.ukeireTotal}枚</div></td></tr>`).join("");
  return `<h3>${escapeHtml(title)}</h3><table><thead><tr><th>打牌</th><th>期待値</th><th>和了率</th><th>聴牌率</th><th>受入</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function prepareCardImages() {
  await ensureAdapter();
  await executeAdapter("window.__bigcoachDesktop.closeOverlays()");
  const initialDisplayState = await executeAdapter(
    "window.__bigcoachDesktop.captureDisplayState()"
  );
  log(`card capture: initial display ${JSON.stringify(initialDisplayState)}`);
  const finalDisplayState = { showMortal: true, showHands: false };
  let frontState;
  let backState;
  try {
    log("card capture: preparing front");
    await ensureCardCaptureVisualState("front");
    await waitForStablePaint("front");
    frontState = await executeAdapter("window.__bigcoachDesktop.prepareCapture('front')");
    log(`card capture: front verified ${JSON.stringify(frontState.displayState)}`);
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
    const frontImage = await Promise.race([
      frontRect
        ? bigCoachView.webContents.capturePage(frontRect)
        : bigCoachView.webContents.capturePage(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("問題面の画像撮影が10秒でタイムアウトしました")), 10000))
    ]);
    log("card capture: front captured");
    log("card capture: preparing back");
    await ensureCardCaptureVisualState("back");
    await waitForStablePaint("back");
    backState = await executeAdapter("window.__bigcoachDesktop.prepareCapture('back')");
    log(`card capture: back verified ${JSON.stringify(backState.displayState)}`);
    const backImage = await Promise.race([
      bigCoachView.webContents.capturePage(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("解答面の画像撮影が10秒でタイムアウトしました")), 10000))
    ]);
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
    if (!restored.showMortal || restored.showHands ||
        !restored.visualState.aiBarsVisible ||
        !restored.visualState.aiAdviceVisible ||
        !restored.visualState.opponentsHidden) {
      throw new Error("カード画像撮影後にAI評価表示・他家手牌非表示へ戻せませんでした");
    }
    if (currentCardImages?.captureDiagnostics) {
      currentCardImages.captureDiagnostics.final = restored;
    }
    log(`card capture: restored normal display ${JSON.stringify(restored)}`);
  }
}

async function prepareNanikiruReferenceImage() {
  await ensureAdapter();
  const restored = await executeAdapter(
    "window.__bigcoachDesktop.restoreCapture({showMortal:true,showHands:false})"
  );
  if (!restored?.visualState?.aiAdviceVisible || !restored?.visualState?.opponentsHidden) {
    throw new Error("何切る悪手カード用のBigCoach参考表示を準備できませんでした");
  }
  bigCoachView.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await bigCoachView.webContents.capturePage();
  return image.toDataURL();
}

function cardVisualStateMatches(mode, state) {
  return mode === "front"
    ? !state.aiBarsVisible && !state.aiAdviceVisible && state.opponentsHidden
    : state.aiBarsVisible && state.aiAdviceVisible && state.opponentsRevealed;
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
      JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(
      `${mode === "front" ? "問題面" : "解答面"}の描画が安定していません。` +
      "BigCoachの表示更新完了後にもう一度お試しください。"
    );
  }
  log(`card capture: ${mode} compositor stable ${JSON.stringify(second)}`);
  return second;
}

async function ensureCardCaptureVisualState(mode) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    log(`card capture: ${mode} render attempt ${attempt + 1}`);
    const renderResult = await executeAdapter(
      `window.__bigcoachDesktop.renderCaptureMode(${JSON.stringify(mode)})`
    );
    log(`card capture: ${mode} render requested`);
    if (!renderResult.ok) throw new Error(renderResult.reason);
    await new Promise((resolve) => setTimeout(resolve, 200));
    log(`card capture: ${mode} inspecting DOM`);
    const state = await executeAdapter("window.__bigcoachDesktop.captureVisualState()");
    log(`card capture: ${mode} DOM ${JSON.stringify(state)}`);
    const matches = cardVisualStateMatches(mode, state);
    if (matches) return state;
  }
  const state = await executeAdapter("window.__bigcoachDesktop.captureVisualState()");
  throw new Error(
    `${mode === "front" ? "問題面" : "解答面"}の実表示を準備できませんでした。` +
    `AI棒グラフ=${state.aiBarsVisible ? "表示" : "非表示"}、` +
    `AI候補表=${state.aiAdviceVisible ? "表示" : "非表示"}、` +
    `相手手牌=${state.opponentsRevealed ? "表向き" : state.opponentsHidden ? "裏向き" : "判定不能"}`
  );
}

function judgmentPrompt(scene) {
  if (scene.judgmentType === "call") return "副露？";
  if (scene.judgmentType === "riichi") return "リーチ？";
  return "何切？";
}

function outcomeProbabilitiesHtml(outcomes) {
  const items = [
    ["流局確率", outcomes?.draw],
    ["横移動確率", outcomes?.movement],
    ["放銃確率", outcomes?.dealIn],
    ["和了確率", outcomes?.win]
  ];
  if (items.every(([, value]) => !Number.isFinite(value))) {
    return `<p>BigCoachの局面結果確率を取得できませんでした。</p>`;
  }
  return `<div style="display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:8px;margin:12px 0">
    ${items.map(([label, value]) => `<div style="padding:10px;border:1px solid #ddd;border-radius:8px;text-align:center">
      <div style="font-size:13px">${label}</div>
      <strong style="font-size:22px">${Number.isFinite(value) ? `${value.toFixed(1)}%` : "—"}</strong>
    </div>`).join("")}
  </div>`;
}

function cardHtml(scene, simulation, memo, images, mediaMode = "preview") {
  const comparison = comparisonStatus(scene, simulation);
  const front = `
    <div class="bigcoach-card">
      <div style="font-size:1px;color:#fff">BigCoach:${escapeHtml(scene.sceneId)}</div>
      <h2 style="text-align:center;font-size:28px">${judgmentPrompt(scene)}</h2>
      <img src="${escapeHtml(images.front)}" style="max-width:100%">
    </div>`;
  const back = `
    <div class="bigcoach-card">
      <h2>メモ</h2><div>${escapeHtml(memo || "（なし）").replace(/\n/g, "<br>")}</div>
      <img src="${escapeHtml(images.back)}" style="max-width:100%">
      ${outcomeProbabilitiesHtml(images.outcomes)}
      <h2>何切る比較</h2>
      <p>実打: ${tileHtml(comparison.actual, mediaMode)} / BigCoach推奨: ${tileHtml(comparison.bigCoach, mediaMode)} / シミュレーター推奨: ${tileHtml(comparison.simulator, mediaMode)}</p>
      <p>BigCoachとシミュレーター: <strong>${comparison.bigCoachMatchesSimulator ? "一致" : "不一致"}</strong></p>
      <p>シン悪手: ${scene.shinMistake.isShin ? "該当" : "非該当"} (${escapeHtml(scene.shinMistake.reason)})</p>
      <p>大悪手: ${scene.majorMistake?.isMajor ? "該当" : "非該当"} (${escapeHtml(scene.majorMistake?.reason || "判定不可")})</p>
      ${candidateTable("何切る結果（見えている牌を残り枚数から除外）", simulation?.withWall, mediaMode)}
      ${candidateTable("何切る結果（残り枚数を補正しない）", simulation?.withoutWall, mediaMode)}
      <hr><p><a href="${escapeHtml(scene.url)}">BigCoach解析結果</a></p>
      <p>局面ID: ${escapeHtml(scene.sceneId)}</p>
    </div>`;
  return { front, back, comparison };
}

function tileRowHtml(codes, mediaMode = "preview", height = 54) {
  return `<div style="display:flex;flex-wrap:wrap;gap:2px;align-items:flex-end">${
    (codes || []).map((code) => tileHtml(code, mediaMode).replace("height:38px", `height:${height}px`)).join("")
  }</div>`;
}

function tileStripSvg(codes) {
  const tiles = codes || [];
  const tileWidth = 66;
  const tileHeight = 90;
  const images = tiles.map((code, index) => {
    const filename = tileFilename(code);
    const data = fs.readFileSync(path.join(tileImagesDirectory(), filename)).toString("base64");
    return `<image x="${index * tileWidth}" y="0" width="${tileWidth}" height="${tileHeight}" href="data:image/png;base64,${data}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth * tiles.length}" height="${tileHeight}" viewBox="0 0 ${tileWidth * tiles.length} ${tileHeight}">${images}</svg>`;
}

function tileStripAsset(codes, sceneId, mediaMode = "preview") {
  const svg = tileStripSvg(codes);
  const data = Buffer.from(svg, "utf8").toString("base64");
  const filename = `bigcoach_hand_${sceneId}.svg`;
  return {
    filename,
    data,
    src: mediaMode === "anki" ? filename : `data:image/svg+xml;base64,${data}`
  };
}

function nanikiruMistakeCardHtml(scene, simulation, screenshot, mediaMode = "preview", handStripSrc = null) {
  const classification = classifyNanikiruMistake(scene, simulation);
  const handImage = handStripSrc || tileStripAsset(scene.handTiles, scene.sceneId, mediaMode).src;
  const structured = {
    schema: "bigcoach-nanikiru-mistake/v1",
    sceneId: scene.sceneId,
    sourceUrl: scene.url,
    handMpsz: scene.handMpsz,
    handTiles: scene.handTiles,
    selfCallMpsz: codesToMpsz(scene.selfCallTiles),
    selfCallTiles: scene.selfCallTiles,
    doraIndicatorsMpsz: codesToMpsz(scene.doraTiles),
    doraIndicators: scene.doraTiles,
    turn: scene.currentTurn,
    opponentRiichi: scene.opponentRiichi,
    opponentCallTiles: scene.opponentCallTiles,
    roundWind: scene.roundWind,
    seatWind: scene.seatWind,
    roundText: scene.roundText,
    actualDiscard: scene.actualDiscard,
    recommendedDiscard: scene.recommendedDiscard,
    simulatorWithRiverAdjustment: simulation.withWall.recommendation,
    simulatorWithoutRiverAdjustment: simulation.withoutWall.recommendation,
    simulatorWithoutRiverAdjustmentCandidates: simulation.withoutWall.candidates,
    shanten: scene.shanten
  };
  const dataJson = JSON.stringify(structured);
  const commonData = `data-schema="bigcoach-nanikiru-mistake-v1" data-scene-id="${escapeHtml(scene.sceneId)}" data-hand-mpsz="${escapeHtml(scene.handMpsz)}"`;
  const front = `
    <div class="nanikiru-flat-card" ${commonData}>
      <h2 style="text-align:center">何切る？</h2>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:8px;margin-bottom:12px">
        <div><small>場風</small>${tileRowHtml([scene.roundWind], mediaMode, 42)}</div>
        <div><small>自風</small>${tileRowHtml([scene.seatWind], mediaMode, 42)}</div>
        <div><small>巡目</small><strong style="display:block;font-size:24px">${scene.currentTurn}巡目</strong></div>
        <div><small>ドラ表示牌</small>${tileRowHtml(scene.doraTiles, mediaMode, 42)}</div>
      </div>
      <img src="${escapeHtml(handImage)}" alt="${escapeHtml(scene.handMpsz)}" data-hand-mpsz="${escapeHtml(scene.handMpsz)}"
        style="display:block;width:auto;max-width:100%;height:auto;white-space:nowrap">
      ${scene.selfCallTiles?.length ? `<div style="margin-top:8px"><small>副露</small>${tileRowHtml(scene.selfCallTiles, mediaMode, 46)}</div>` : ""}
    </div>`;
  const back = `
    <div class="nanikiru-flat-card" ${commonData}>
      <h2>正解: ${tileHtml(scene.recommendedDiscard, mediaMode)}</h2>
      <p>実打: ${tileHtml(scene.actualDiscard, mediaMode)} ／ AI: ${tileHtml(scene.recommendedDiscard, mediaMode)}
      ／ 河補正あり: ${tileHtml(simulation.withWall.recommendation, mediaMode)}
      ／ 河補正なし: ${tileHtml(simulation.withoutWall.recommendation, mediaMode)}</p>
      <p>手牌mpsz: <code>${escapeHtml(scene.handMpsz)}</code></p>
      <p>副露mpsz: <code>${escapeHtml(codesToMpsz(scene.selfCallTiles))}</code></p>
      <p>ドラ表示牌mpsz: <code>${escapeHtml(codesToMpsz(scene.doraTiles))}</code></p>
      <p>${escapeHtml(scene.roundText)} ／ ${scene.currentTurn}巡目 ／ 場風${escapeHtml(scene.roundWind)} ／ 自風${escapeHtml(scene.seatWind)}
      ／ ${escapeHtml(String(scene.shanten))}シャンテン</p>
      ${candidateTable(
        "補正無の何切る結果（河・副露を残り枚数へ反映しない）",
        simulation.withoutWall,
        mediaMode
      )}
      <details><summary>加工用JSON</summary><pre data-format="bigcoach-nanikiru-mistake-v1">${escapeHtml(dataJson)}</pre></details>
      <h3>BigCoach参考画像</h3>
      <img src="${escapeHtml(screenshot)}" style="max-width:100%">
      <p><a href="${escapeHtml(scene.url)}">BigCoach解析結果</a> ／ 局面ID: ${escapeHtml(scene.sceneId)}</p>
      <p>${escapeHtml(classification.reason)}</p>
    </div>`;
  return { front, back, structured, classification };
}

async function storeTileMediaForNanikiru(scene, simulation) {
  const codes = new Set([
    ...scene.handTiles,
    ...scene.selfCallTiles,
    ...scene.doraTiles,
    scene.roundWind,
    scene.seatWind,
    scene.actualDiscard,
    scene.recommendedDiscard,
    simulation?.withWall?.recommendation,
    simulation?.withoutWall?.recommendation,
    ...(simulation?.withoutWall?.candidates || []).flatMap((candidate) => [
      candidate.tile,
      ...(candidate.ukeire || []).map((item) => item.tile)
    ])
  ].filter((code) => tileFilename(code)));
  for (const code of codes) {
    const filename = tileFilename(code);
    const data = fs.readFileSync(path.join(tileImagesDirectory(), filename)).toString("base64");
    await anki.storeMedia(`bigcoach_tile_${filename}`, data);
  }
}

async function registerNanikiruMistakeCard(scene, simulation, screenshotDataUrl, duplicateMode = "skip") {
  await storeTileMediaForNanikiru(scene, simulation);
  const screenshotName = await anki.storeImage(screenshotDataUrl, scene.sceneId, "nanikiru");
  const handStrip = tileStripAsset(scene.handTiles, scene.sceneId, "anki");
  await anki.storeMedia(handStrip.filename, handStrip.data);
  const flat = nanikiruMistakeCardHtml(
    scene,
    simulation,
    screenshotName,
    "anki",
    handStrip.src
  );
  const dedicatedSettings = {
    ...settings,
    deckName: settings.nanikiruMistakeDeckName || `${settings.deckName}::何切る悪手`
  };
  const registration = await anki.add({
    settings: dedicatedSettings,
    scene,
    frontHtml: flat.front,
    backHtml: flat.back,
    duplicateMode,
    duplicatePrefix: "BigCoach_NanikiruMistake_ID",
    extraTags: ["何切る悪手", "BigCoach_何切る悪手"]
  });
  return { registration, deckName: dedicatedSettings.deckName, flat };
}

async function bulkRegisterNanikiruMistakes() {
  const decisions = prefilterNanikiruDecisions(await loadDecisions()).sort(comparePosition);
  const original = currentScene?.sourcePosition || (await captureScene()).sourcePosition;
  const summary = {
    candidates: decisions.length,
    qualified: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    failed: []
  };
  try {
    for (let index = 0; index < decisions.length; index += 1) {
      const decision = decisions[index];
      mainWindow?.webContents.send("nanikiru:bulk-progress", {
        current: index + 1,
        total: decisions.length,
        roundText: decision.roundText,
        turn: decision.turn
      });
      try {
        const evaluated = await evaluateNanikiruDecision(decision);
        if (!evaluated.classification.isNanikiruMistake) continue;
        summary.qualified += 1;
        const duplicates = await anki.findDuplicates(
          evaluated.scene.sceneId,
          "BigCoach_NanikiruMistake_ID"
        );
        if (duplicates.length) {
          summary.skipped += 1;
          continue;
        }
        const scene = await goToDecision(decision);
        scene.nanikiruMistake = evaluated.classification;
        const screenshot = await prepareNanikiruReferenceImage();
        const result = await registerNanikiruMistakeCard(
          scene,
          evaluated.simulation,
          screenshot,
          "skip"
        );
        if (result.registration.updated) summary.updated += 1;
        else if (result.registration.skipped) summary.skipped += 1;
        else summary.added += 1;
      } catch (error) {
        summary.failed.push({
          roundText: decision.roundText,
          turn: decision.turn,
          message: error.message
        });
        log(`nanikiru bulk registration failed at ${nanikiruPositionKey(decision)}: ${error.stack || error}`);
      }
    }
  } finally {
    if (original) await goToDecision(original).catch(() => {});
    mainWindow?.webContents.send("nanikiru:bulk-progress", {
      complete: true,
      ...summary
    });
  }
  return summary;
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
    result.bigCoach = { ok: url.startsWith("https://review.bigcoach.work"), message: url || "未読込" };
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
    currentDecisions = [];
    currentNanikiruMistakes = null;
    await bigCoachView.webContents.loadURL(url);
    const history = saveReviewHistory(url);
    return { url, history };
  });
  ipcMain.handle("bigcoach:history", () => readJson(historyPath(), []));
  ipcMain.handle("bigcoach:reload", async () => {
    await bigCoachView.webContents.loadURL(bigCoachUrl());
    return true;
  });
  ipcMain.handle("simulator:run", async () => {
    const scene = currentScene || await captureScene();
    currentSimulation = await ensureSimulation(scene);
    return {
      simulation: currentSimulation,
      comparison: comparisonStatus(scene, currentSimulation),
      nanikiruMistake: scene.nanikiruMistake
    };
  });
  ipcMain.handle("settings:save", (_event, next) => saveSettings(next));
  ipcMain.handle("app:diagnose", () => diagnose());
  ipcMain.handle("stats:refresh", () => refreshStats());
  ipcMain.handle("anki:bulk-register-nanikiru", () => bulkRegisterNanikiruMistakes());
  ipcMain.handle("anki:preview", async (_event, memo) => {
    const scene = currentScene || await captureScene();
    await ensureSimulation(scene);
    const images = currentCardImages || await prepareCardImages();
    const nanikiruMistake = classifyNanikiruMistake(scene, currentSimulation);
    const duplicates = await anki.findDuplicates(
      scene.sceneId,
      nanikiruMistake.isNanikiruMistake
        ? "BigCoach_NanikiruMistake_ID"
        : "BigCoach_ID"
    ).catch(() => []);
    const nanikiruMistakeCard = nanikiruMistake.isNanikiruMistake
      ? nanikiruMistakeCardHtml(scene, currentSimulation, images.backDataUrl)
      : null;
    return {
      ...cardHtml(scene, currentSimulation, memo, {
        front: images.frontDataUrl,
        back: images.backDataUrl,
        outcomes: images.outcomes
      }),
      duplicates,
      simulation: currentSimulation,
      comparison: comparisonStatus(scene, currentSimulation),
      nanikiruMistake,
      nanikiruMistakeCard,
      captureDiagnostics: images.captureDiagnostics
    };
  });
  ipcMain.handle("anki:register", async (_event, payload) => {
    const scene = currentScene || await captureScene();
    await ensureSimulation(scene);
    const images = currentCardImages || await prepareCardImages();
    const classification = classifyNanikiruMistake(scene, currentSimulation);
    if (classification.isNanikiruMistake) {
      try {
        const dedicated = await registerNanikiruMistakeCard(
          scene,
          currentSimulation,
          images.backDataUrl,
          payload.duplicateMode || "skip"
        );
        return {
          ...dedicated.registration,
          nanikiruMistake: {
            qualified: true,
            classification,
            deckName: dedicated.deckName,
            registration: dedicated.registration
          }
        };
      } catch (error) {
        throw new Error(`何切る悪手カードを登録できませんでした。${error.message}`);
      }
    }
    let frontName;
    let backName;
    try {
      frontName = await anki.storeImage(images.frontDataUrl, scene.sceneId, "front");
      backName = await anki.storeImage(images.backDataUrl, scene.sceneId, "back");
    } catch (error) {
      throw new Error(`Ankiへ局面画像を送信できませんでした。${error.message}`);
    }
    const tileCodes = new Set([
      scene.actualDiscard,
      scene.recommendedDiscard,
      currentSimulation?.withWall?.recommendation,
      currentSimulation?.withoutWall?.recommendation,
      ...scene.handTiles,
      ...scene.doraTiles,
      scene.roundWind,
      scene.seatWind,
      ...[currentSimulation?.withWall, currentSimulation?.withoutWall].flatMap((analysis) =>
        (analysis?.candidates || []).flatMap((candidate) =>
          [candidate.tile, ...(candidate.ukeire || []).map((item) => item.tile)]))
    ].filter((code) => tileFilename(code)));
    try {
      for (const code of tileCodes) {
        const filename = tileFilename(code);
        const data = fs.readFileSync(path.join(tileImagesDirectory(), filename)).toString("base64");
        await anki.storeMedia(`bigcoach_tile_${filename}`, data);
      }
    } catch (error) {
      throw new Error(`Ankiへ牌画像を送信できませんでした。${error.message}`);
    }
    try {
      const html = cardHtml(scene, currentSimulation, payload.memo || "", {
        front: frontName,
        back: backName,
        outcomes: images.outcomes
      }, "anki");
      const normalRegistration = await anki.add({
        settings,
        scene,
        frontHtml: html.front,
        backHtml: html.back,
        duplicateMode: payload.duplicateMode || "skip"
      });
      return {
        ...normalRegistration,
        nanikiruMistake: { qualified: false, classification }
      };
    } catch (error) {
      throw new Error(`Ankiカード本体を登録できませんでした。${error.message}`);
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
  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  const bigCoachSession = session.fromPartition("persist:bigcoach");
  authSessionStore = new AuthSessionStore({
    electronSession: bigCoachSession,
    safeStorage,
    filePath: path.join(app.getPath("userData"), "bigcoach-auth-session.bin"),
    log
  });
  await authSessionStore.restore();
  authSessionStore.start();

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
      const url = bigCoachView.webContents.getURL();
      if (url.includes("/review/")) await ensureAdapter();
      if (url !== loadedReviewUrl) {
        currentDecisions = [];
        currentNanikiruMistakes = null;
        currentScene = null;
        currentSimulation = null;
        currentCardImages = null;
        loadedReviewUrl = url;
      }
      const history = saveReviewHistory(url);
      mainWindow.webContents.send("bigcoach:status", { ok: true, url, history });
    } catch (error) {
      log(error.stack || error);
      mainWindow.webContents.send("bigcoach:status", { ok: false, message: error.message });
    }
  });
  bigCoachView.webContents.on("did-frame-finish-load", (_event, isMainFrame) => {
    if (!isMainFrame && bigCoachView.webContents.getURL().includes("/review/")) {
      scheduleAutomaticStatsRefresh();
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

app.on("before-quit", (event) => {
  if (quitAfterSessionFlush || !authSessionStore) return;
  event.preventDefault();
  quitAfterSessionFlush = true;
  authSessionStore.flush()
    .catch((error) => log(error.stack || error))
    .finally(() => app.quit());
});
