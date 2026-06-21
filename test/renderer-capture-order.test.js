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
  const hideBigCoach = handler.indexOf("window.bigcoachApp.setOverlayOpen(true)");
  const showPreview = handler.indexOf('$("#preview-dialog").showModal()');

  assert.notEqual(handlerStart, -1);
  assert.notEqual(capture, -1);
  assert.notEqual(hideBigCoach, -1);
  assert.notEqual(showPreview, -1);
  assert.ok(capture < hideBigCoach, "card capture must finish before BigCoach is hidden");
  assert.ok(hideBigCoach < showPreview, "BigCoach should only be hidden immediately before the dialog opens");
});
