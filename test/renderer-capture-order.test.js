"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("BigCoach remains visible until card image capture finishes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );
  const handlerStart = source.indexOf('$("#preview-card").addEventListener');
  const handlerEnd = source.indexOf('$("#preview-close").addEventListener', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const capture = handler.indexOf("await window.bigcoachApp.previewCard");
  const showPreview = handler.indexOf('$("#preview-dialog").showModal()');
  const syncVisibility = handler.indexOf("await syncBigCoachVisibility()");

  assert.notEqual(handlerStart, -1);
  assert.notEqual(capture, -1);
  assert.notEqual(showPreview, -1);
  assert.notEqual(syncVisibility, -1);
  assert.ok(capture < showPreview, "card capture must finish before the preview opens");
  assert.ok(showPreview < syncVisibility, "BigCoach should only be hidden after the preview dialog is open");
});

test("slim UI keeps only card, URL, scene, and simulator sections", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  const anki = source.indexOf("<h2>Ankiカード登録</h2>");
  const reviewUrl = source.indexOf("<h2>解析済みURLを開く</h2>");
  const scene = source.indexOf("<h2>現在の局面</h2>");
  const simulator = source.indexOf("何切るシミュレーターを実行");

  assert.ok(anki >= 0);
  assert.ok(reviewUrl > anki);
  assert.ok(scene > reviewUrl);
  assert.ok(simulator > scene);
  assert.equal(source.includes("<h2>局面移動</h2>"), false);
  assert.equal(source.includes("シン悪手率"), false);
});

test("Anki registration closes preview immediately and continues in background", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );
  const handlerStart = source.indexOf('$("#register-card").addEventListener');
  const handlerEnd = source.indexOf('for (const dialog of $$("dialog"))', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /const previewId = state\.currentPreviewId/);
  assert.match(handler, /closeDialog\(dialog\)\.catch/);
  assert.match(handler, /window\.bigcoachApp\.registerCard\(payload\)\.then/);
  assert.doesNotMatch(handler, /await window\.bigcoachApp\.registerCard/);
  assert.doesNotMatch(handler, /await closeDialog\(dialog\)/);
  assert.match(source, /async function closeDialog\(dialog\)[\s\S]*dialog\.close\(\)[\s\S]*return syncBigCoachVisibility\(\)/);
  assert.match(source, /const overlayOpen = \$\$\("dialog"\)\.some\(\(dialog\) => dialog\.open\)/);
});

test("Anki registration button uses preview id and does not recapture from renderer flow", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );
  const handlerStart = source.indexOf('$("#register-card").addEventListener');
  const handlerEnd = source.indexOf('for (const dialog of $$("dialog"))', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(html, /id="register-card"[^>]*type="button"/);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /previewId/);
  assert.match(handler, /window\.bigcoachApp\.registerCard\(payload\)/);
  assert.match(handler, /resetNormalCardForm\(\)/);
  const normalReset = handler.indexOf("resetNormalCardForm()");
  const normalClose = handler.indexOf("closeDialog(dialog).catch", normalReset);
  const normalRegister = handler.indexOf("window.bigcoachApp.registerCard(payload)", normalClose);
  assert.ok(normalReset >= 0);
  assert.ok(normalClose > normalReset);
  assert.ok(normalRegister > normalClose);
});

test("programmatic dialog close skips duplicate overlay synchronization", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );
  assert.match(source, /dialog\.dataset\.skipCloseSync = "1"[\s\S]*dialog\.close\(\)[\s\S]*return syncBigCoachVisibility\(\)/);
  assert.match(source, /if \(dialog\.dataset\.skipCloseSync === "1"\)[\s\S]*return;/);
});

test("card capture restores initial AI state and hides opponent hands", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const handlerStart = source.indexOf("async function prepareCardImages()");
  const handlerEnd = source.indexOf("function cardVisualStateMatches", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const inspectInitial = handler.indexOf("captureDisplayState()");
  const renderFront = handler.indexOf("prepareCapture('front')");
  const renderBack = handler.indexOf("prepareCapture('back')");
  const restoreOriginal = handler.indexOf("restoreCapture");

  assert.ok(inspectInitial >= 0);
  assert.ok(renderFront > inspectInitial, "the initial state must be inspected before front mode is rendered");
  assert.ok(renderBack > renderFront, "back capture must happen after front capture");
  assert.ok(restoreOriginal > renderBack, "the saved original state must be restored after capture");
  assert.match(handler, /showMortal: Boolean\(initialDisplayState\?\.showMortal \?\? true\)/);
  assert.doesNotMatch(handler, /restored\.visualState\.aiBarsVisible/);
  assert.match(handler, /restored\.visualState\.opponentsHidden/);
});

test("front card visual state accepts hidden AI and hidden opponent hands", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const start = source.indexOf("function cardVisualStateMatches");
  const end = source.indexOf("async function waitForStablePaint", start);
  const helper = source.slice(start, end);

  assert.ok(start >= 0);
  assert.doesNotMatch(helper, /handDisplayChecked/);
  assert.match(helper, /!state\.aiBarsVisible/);
  assert.match(helper, /!state\.aiAdviceVisible/);
  assert.match(helper, /noAnalysisDataVisible/);
  assert.match(helper, /state\.opponentsHidden/);
});

test("modern card capture uses BigCoach keyboard shortcuts and checkboxes for state", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "bigcoach-adapter.js"),
    "utf8"
  );
  const renderStart = source.indexOf("async function renderCaptureMode");
  const renderEnd = source.indexOf("function captureDisplayState", renderStart);
  const render = source.slice(renderStart, renderEnd);
  const prepareStart = source.indexOf("async function prepareCapture");
  const prepareEnd = source.indexOf("async function restoreCapture", prepareStart);
  const prepare = source.slice(prepareStart, prepareEnd);
  const controlsStart = source.lastIndexOf("function modernControls");
  const controlsEnd = source.indexOf("function dispatchModernShortcut", controlsStart);
  const controls = source.slice(controlsStart, controlsEnd);

  assert.match(source, /function findModernCheckbox/);
  assert.match(source, /function setModernDisplayState/);
  assert.match(controls, /AI\(\?:表示\|Analysis\|解析\)\?/);
  assert.match(controls, /手牌表示\|手牌\|Hands\?/);
  assert.match(source, /function dispatchModernShortcut/);
  assert.match(source, /setModernShortcutState\(controls\.ai, expected\.showMortal, "m"\)/);
  assert.match(source, /setModernShortcutState\(controls\.hands, expected\.showHands, "h"\)/);
  assert.doesNotMatch(source, /input\.click\(\)/);
  assert.match(render, /setModernDisplayState/);
  assert.match(prepare, /setModernDisplayState/);
  assert.doesNotMatch(source, /closest\("div,li,section"\)/);
  assert.doesNotMatch(prepare, /applyModernCaptureMode\(mode\)/);
});

test("modern opponent hand visibility follows the hand display checkbox", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "bigcoach-adapter.js"),
    "utf8"
  );
  const start = source.indexOf("function modernCaptureVisualState");
  const end = source.indexOf("function applyModernCaptureMode", start);
  const helper = source.slice(start, end);

  assert.match(helper, /const handChecked = controls\.hands \? Boolean\(controls\.hands\.checked\) : null/);
  assert.match(helper, /opponentsRevealed: handChecked === null/);
  assert.match(helper, /: handChecked/);
  assert.match(helper, /opponentsHidden: handChecked === null/);
  assert.match(helper, /: !handChecked/);
});

test("modern capture waits up to one second only until display state changes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "bigcoach-adapter.js"),
    "utf8"
  );
  const displayStart = source.indexOf("async function setModernDisplayState");
  const displayEnd = source.indexOf("function modernCaptureVisualState", displayStart);
  const display = source.slice(displayStart, displayEnd);
  const waitStart = source.indexOf("async function waitForModernDisplayState");
  const waitEnd = source.indexOf("async function waitForVisualPaint", waitStart);
  const wait = source.slice(waitStart, waitEnd);
  const visualStart = source.indexOf("function modernCaptureVisualState");
  const visualEnd = source.indexOf("function applyModernCaptureMode", visualStart);
  const visual = source.slice(visualStart, visualEnd);

  assert.match(display, /waitForModernDisplayState\(expected, 1000\)/);
  assert.doesNotMatch(display, /setTimeout\(resolve,\s*1000\)/);
  assert.match(wait, /Date\.now\(\) \+ timeoutMs/);
  assert.match(wait, /displayStateMatches\(expected, state\)/);
  assert.match(wait, /setTimeout\(resolve,\s*50\)/);
  assert.doesNotMatch(visual, /aiChecked === false \? false/);
});

test("visual paint wait has a timeout fallback for throttled BigCoach frames", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "bigcoach-adapter.js"),
    "utf8"
  );
  const start = source.indexOf("async function waitForVisualPaint");
  const end = source.indexOf("async function renderCaptureMode", start);
  const helper = source.slice(start, end);

  assert.match(helper, /requestAnimationFrame\(finish\)/);
  assert.match(helper, /setTimeout\(finish, 100\)/);
  assert.match(helper, /return captureVisualState\(\)/);
});

test("review URL loading tolerates Electron navigation aborts", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const start = source.indexOf("async function loadBigCoachReviewUrl");
  const end = source.indexOf("async function captureScene", start);
  const helper = source.slice(start, end);

  assert.match(helper, /ERR_ABORTED/);
  assert.match(helper, /ERR_FAILED/);
  assert.match(helper, /renderer waits for scene readiness/);
  assert.match(helper, /replaceBigCoachView\(\)/);
  assert.match(source, /await loadBigCoachReviewUrl\(url\)/);
});

test("card paint stability ignores non-capture diagnostic noise", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const signatureStart = source.indexOf("function cardVisualStateSignature");
  const signatureEnd = source.indexOf("async function waitForStablePaint", signatureStart);
  const signature = source.slice(signatureStart, signatureEnd);
  const waitStart = source.indexOf("async function waitForStablePaint");
  const waitEnd = source.indexOf("async function ensureCardCaptureVisualState", waitStart);
  const wait = source.slice(waitStart, waitEnd);

  assert.ok(signatureStart >= 0);
  assert.match(signature, /aiBarsVisible/);
  assert.match(signature, /aiAdviceVisible/);
  assert.match(signature, /opponentsRevealed/);
  assert.match(signature, /opponentsHidden/);
  assert.match(wait, /cardVisualStateSignature\(first\) !== cardVisualStateSignature\(second\)/);
  assert.doesNotMatch(wait, /JSON\.stringify\(first\) !== JSON\.stringify\(second\)/);
});

test("active Anki card HTML uses Japanese prompts and readable simulator table labels", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const cardStart = source.lastIndexOf("function cardHtml");
  const cardEnd = source.indexOf("async function ankiDeckChoices", cardStart);
  const card = source.slice(cardStart, cardEnd);
  const promptStart = source.lastIndexOf("function judgmentPrompt", cardStart);
  const promptEnd = source.indexOf("function cardHtml", promptStart);
  const prompt = source.slice(promptStart, promptEnd);
  const tableStart = source.lastIndexOf("function candidateTable", cardStart);
  const tableEnd = source.indexOf("function judgmentPrompt", tableStart);
  const table = source.slice(tableStart, tableEnd);

  assert.match(card, /judgmentPrompt\(scene\)/);
  assert.match(card, /frontNote/);
  assert.match(prompt, /何切？/);
  assert.match(prompt, /副露？/);
  assert.match(prompt, /リーチ？/);
  assert.doesNotMatch(prompt, /Discard\?|Call\?|Riichi\?/);
  assert.doesNotMatch(card, /outcomeProbabilitiesHtml/);
  assert.match(table, /打牌/);
  assert.match(table, /期待値/);
  assert.match(table, /和了率/);
  assert.match(table, /聴牌率/);
  assert.match(table, /受入/);
  assert.match(table, /役別Shapley/);
  assert.match(table, /出現率/);
  assert.doesNotMatch(table, /<th>包含<\/th>/);
  assert.doesNotMatch(table, /<th>限界<\/th>/);
  assert.match(table, /commonScale/);
  assert.match(table, /yakuChartContributions/);
  assert.match(table, /entry\.shortName/);
  assert.match(table, />\$\{escapeHtml\(label\)\}<\/span>/);
  assert.match(table, /残差/);
  assert.match(table, /×\$\{item\.count\}/);
  assert.match(table, /\$\{candidate\.ukeireTotal\}枚/);
});

test("Anki preview dialog exposes deck selection from preview result", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  const renderer = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );

  assert.match(html, /id="preview-deck"/);
  assert.match(renderer, /function renderPreviewDecks/);
  assert.match(renderer, /renderPreviewDecks\(preview\)/);
  assert.match(renderer, /frontNote: \$\("#front-note"\)\.value/);
  assert.match(renderer, /deckName: \$\("#preview-deck"\)\.value/);
});

test("Anki registration reuses cached preview instead of recapturing BigCoach", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const previewStart = source.indexOf('ipcMain.handle("anki:preview"');
  const registerStart = source.indexOf('ipcMain.handle("anki:register"');
  const registerEnd = source.indexOf('ipcMain.handle("app:open-logs"', registerStart);
  const previewHandler = source.slice(previewStart, registerStart);
  const registerHandler = source.slice(registerStart, registerEnd);

  assert.match(previewHandler, /currentCardPreview = \{/);
  assert.match(previewHandler, /previewId/);
  assert.match(registerHandler, /const preview = currentCardPreview/);
  assert.match(registerHandler, /preview\.previewId !== payload\.previewId/);
  assert.match(registerHandler, /const scene = preview\.scene/);
  assert.match(registerHandler, /const simulation = preview\.simulation/);
  assert.match(registerHandler, /const images = preview\.images/);
  assert.doesNotMatch(registerHandler, /captureScene\(\)/);
  assert.doesNotMatch(registerHandler, /prepareCardImages\(\)/);
  assert.doesNotMatch(registerHandler, /ensureSimulation/);
});

test("adapter execution reinjects stale BigCoach adapter before calling new methods", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const adapter = fs.readFileSync(path.join(__dirname, "..", "src", "bigcoach-adapter.js"), "utf8");
  const executeStart = source.indexOf("async function executeAdapter");
  const executeEnd = source.indexOf("async function ensureAdapter", executeStart);
  const executeBody = source.slice(executeStart, executeEnd);
  const ensureStart = executeEnd;
  const ensureEnd = source.indexOf("async function waitForAnalysisReady", ensureStart);
  const ensureBody = source.slice(ensureStart, ensureEnd);
  assert.match(executeBody, /const frame = await ensureAdapter\(\)/);
  assert.match(ensureBody, /listFirstDiscards/);
  assert.match(ensureBody, /__version === '2026-07-06-first-discard-stock-winds'/);
  assert.match(adapter, /__version: "2026-07-06-first-discard-stock-winds"/);
  assert.match(adapter, /listFirstDiscards/);
});

test("the same yaku keeps the same chart color across discard rows", () => {
  const projectRoot = path.join(__dirname, "..");
  const mainSource = fs.readFileSync(path.join(projectRoot, "src", "main.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(projectRoot, "src", "renderer", "renderer.js"), "utf8");
  const rendererStyles = fs.readFileSync(path.join(projectRoot, "src", "renderer", "styles.css"), "utf8");
  assert.match(mainSource, /yakuColor\(entry\)/);
  assert.match(rendererSource, /yakuColor\(entry\)/);
  assert.doesNotMatch(rendererStyles, /yaku-chart-segment:nth-child/);
});

test("modern concealed kans preserve their meld type and restore four tiles", () => {
  const adapter = fs.readFileSync(
    path.join(__dirname, "..", "src", "bigcoach-adapter.js"),
    "utf8"
  );
  assert.match(adapter, /ankan:\s*2/);
  assert.match(adapter, /buildModernMelds\(selfFuuros\)/);
  assert.match(adapter, /type === "ankan".*tiles\.length < expectedSize/s);
  assert.match(adapter, /while \(tiles\.length < expectedSize\) tiles\.push\(concealedTile\)/);
});

test("first discard CSV includes round wind and seat wind columns", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const adapter = fs.readFileSync(path.join(__dirname, "..", "src", "bigcoach-adapter.js"), "utf8");
  assert.match(main, /"round_wind"/);
  assert.match(main, /"seat_wind"/);
  assert.match(main, /round_wind: row\.roundWind/);
  assert.match(main, /seat_wind: row\.seatWind/);
  assert.match(main, /ensureFirstDiscardCsvHeader/);
  assert.match(adapter, /roundWind: modernRoundWind\(gameInfo\)/);
  assert.match(adapter, /seatWind: modernSeatWind\(gameInfo\)/);
});
