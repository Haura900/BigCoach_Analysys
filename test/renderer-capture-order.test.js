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

test("settings expose a separate deck for nanikiru mistakes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  assert.match(source, /name="nanikiruMistakeDeckName"/);
});

test("navigation exposes previous and next nanikiru mistake buttons", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  assert.match(source, /data-nav="previousNanikiru"/);
  assert.match(source, /data-nav="nextNanikiru"/);
});

test("UI exposes bulk nanikiru mistake registration", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  const preload = fs.readFileSync(
    path.join(__dirname, "..", "src", "preload.js"),
    "utf8"
  );
  assert.match(html, /id="bulk-register-nanikiru"/);
  assert.match(preload, /bulkRegisterNanikiru/);
});

test("flat nanikiru card places metadata above one combined hand image", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const start = source.indexOf("function nanikiruMistakeCardHtml");
  const end = source.indexOf("async function refreshStats", start);
  const card = source.slice(start, end);
  const metadata = card.indexOf("<div><small>場風");
  const handImage = card.indexOf('<img src="${escapeHtml(handImage)}"');
  assert.ok(metadata >= 0 && handImage > metadata);
  assert.match(source, /function tileStripSvg\(codes\)/);
  assert.match(card, /<img src="\$\{escapeHtml\(handImage\)\}"/);
});

test("flat nanikiru card includes the unadjusted simulator result table", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const start = source.indexOf("function nanikiruMistakeCardHtml");
  const end = source.indexOf("async function refreshStats", start);
  const card = source.slice(start, end);
  assert.match(card, /補正無の何切る結果/);
  assert.match(card, /simulation\.withoutWall/);
  assert.match(card, /simulatorWithoutRiverAdjustmentCandidates/);
});

test("unadjusted result candidate and ukeire tile media are stored for Anki", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const start = source.indexOf("async function storeTileMediaForNanikiru");
  const end = source.indexOf("async function registerNanikiruMistakeCard", start);
  const media = source.slice(start, end);
  assert.match(media, /simulation\?\.withoutWall\?\.candidates/);
  assert.match(media, /candidate\.ukeire/);
});

test("shin and major navigation use the nanikiru exclusion path", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  assert.match(source, /kind\.endsWith\("Shin"\) \|\| kind\.endsWith\("Major"\)/);
  assert.match(source, /return navigateExcludingNanikiru\(kind, targets, current\)/);
});

test("nanikiru mistakes register exclusively to the dedicated deck", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const handlerStart = source.indexOf('ipcMain.handle("anki:register"');
  const handlerEnd = source.indexOf('ipcMain.handle("app:open-logs"', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const qualifiedBranch = handler.indexOf("if (classification.isNanikiruMistake)");
  const dedicatedAdd = handler.indexOf("registerNanikiruMistakeCard(", qualifiedBranch);
  const qualifiedReturn = handler.indexOf("return {", dedicatedAdd);
  const normalImages = handler.indexOf("let frontName", qualifiedReturn);
  const normalAdd = handler.indexOf("const normalRegistration = await anki.add", normalImages);

  assert.ok(qualifiedBranch >= 0);
  assert.ok(dedicatedAdd > qualifiedBranch);
  assert.ok(qualifiedReturn > dedicatedAdd);
  assert.ok(normalImages > qualifiedReturn);
  assert.ok(normalAdd > normalImages, "normal deck registration must be outside the qualified branch");
});

test("Anki registration waits until BigCoach is visible again", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8"
  );
  const handlerStart = source.indexOf('$("#register-card").addEventListener');
  const handlerEnd = source.indexOf('$("#open-logs").addEventListener', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /await closeDialog\(\$\("#preview-dialog"\)\)/);
  assert.match(source, /async function closeDialog\(dialog\)[\s\S]*dialog\.close\(\)[\s\S]*await syncBigCoachVisibility\(\)/);
  assert.match(source, /const overlayOpen = \$\$\("dialog"\)\.some\(\(dialog\) => dialog\.open\)/);
});

test("card capture finishes with AI visible and opponent hands hidden", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.js"),
    "utf8"
  );
  const handlerStart = source.indexOf("async function prepareCardImages()");
  const handlerEnd = source.indexOf("function cardVisualStateMatches", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const inspectInitial = handler.indexOf("captureDisplayState()");
  const renderFront = handler.indexOf('ensureCardCaptureVisualState("front")');
  const restoreOriginal = handler.indexOf("restoreCapture");

  assert.ok(inspectInitial >= 0);
  assert.ok(renderFront > inspectInitial, "the initial state must be inspected before front mode is rendered");
  assert.ok(restoreOriginal > renderFront, "the saved original state must be restored after capture");
  assert.match(handler, /const finalDisplayState = \{ showMortal: true, showHands: false \}/);
  assert.match(handler, /restored\.visualState\.aiBarsVisible/);
  assert.match(handler, /restored\.visualState\.opponentsHidden/);
});
