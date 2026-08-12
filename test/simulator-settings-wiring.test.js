"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "renderer", "renderer.js"), "utf8");
const simulator = fs.readFileSync(path.join(root, "src", "lib", "simulator.js"), "utf8");

const checkboxMappings = [
  ["enableRedDora", "enable_reddora"],
  ["enableUraDora", "enable_uradora"],
  ["enableShantenDown", "enable_shanten_down"],
  ["enableTegawari", "enable_tegawari"],
  ["autoDisableDeepSearch", "auto_disable_deep_search"],
  ["enableRiichi", "enable_riichi"]
];

test("every simulator checkbox is present, saved, and mapped to the engine", () => {
  for (const [setting, requestField] of checkboxMappings) {
    assert.match(indexHtml, new RegExp(`name=["']${setting}["']`));
    assert.match(renderer, new RegExp(`\\b${setting}\\b`));
    assert.match(simulator, new RegExp(`\\b${requestField}\\b`));
    assert.match(simulator, new RegExp(`settings\\.${setting}\\b`));
  }
});

test("tsumo share is present, saved as a number, and mapped to ron_rate", () => {
  assert.match(indexHtml, /name=["']tsumoWinSharePercent["']/);
  assert.match(renderer, /"tsumoWinSharePercent"/);
  assert.match(simulator, /settings\.tsumoWinSharePercent/);
  assert.match(simulator, /ron_rate/);
});
