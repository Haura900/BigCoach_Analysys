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

test("Anki card section is directly below scene navigation", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  const navigation = source.indexOf("<h2>局面移動</h2>");
  const anki = source.indexOf("<h2>Ankiカード</h2>");
  const reviewUrl = source.indexOf("<h2>解析済みURLを開く</h2>");

  assert.ok(navigation >= 0);
  assert.ok(anki > navigation);
  assert.ok(reviewUrl > anki);
});

test("Anki registration waits until BigCoach is visible again", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );
  const handlerStart = source.indexOf('$("#register-card").addEventListener');
  const handlerEnd = source.indexOf('$("#open-logs").addEventListener', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /await closeDialog\(dialog\)/);
  assert.match(source, /async function closeDialog\(dialog\)[\s\S]*dialog\.close\(\)[\s\S]*await syncBigCoachVisibility\(\)/);
  assert.match(source, /const overlayOpen = \$\$\("dialog"\)\.some\(\(dialog\) => dialog\.open\)/);
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

test("modern card capture uses BigCoach display checkboxes", () => {
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
  const controlsEnd = source.indexOf("async function setModernCheckbox", controlsStart);
  const controls = source.slice(controlsStart, controlsEnd);

  assert.match(source, /function findModernCheckbox/);
  assert.match(source, /function setModernDisplayState/);
  assert.match(controls, /AI\(\?:表示\|Analysis\|解析\)\?/);
  assert.match(controls, /手牌表示\|手牌\|Hands\?/);
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
  assert.match(renderer, /deckName: \$\("#preview-deck"\)\.value/);
});
