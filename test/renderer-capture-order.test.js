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
