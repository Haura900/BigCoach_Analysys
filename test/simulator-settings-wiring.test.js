"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "renderer", "renderer.js"), "utf8");
const simulator = fs.readFileSync(path.join(root, "src", "lib", "simulator.js"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");

const checkboxMappings = [
  ["enableRedDora", "enable_reddora"],
  ["enableUraDora", "enable_uradora"],
  ["enableShantenDown", "enable_shanten_down"],
  ["enableTegawari", "enable_tegawari"],
  ["autoDisableDeepSearch", "auto_disable_deep_search"],
  ["enableRiichi", "enable_riichi"],
  ["enableCalls", "enable_calls"],
  ["enableProbabilityPruning", "enable_probability_pruning"],
  ["enableOtherWinStop", "enable_other_win_stop"]
];

test("every simulator checkbox is present, saved, and mapped to the engine", () => {
  for (const [setting, requestField] of checkboxMappings) {
    assert.match(indexHtml, new RegExp(`name=["']${setting}["']`));
    assert.match(renderer, new RegExp(`\\b${setting}\\b`));
    assert.match(simulator, new RegExp(`\\b${requestField}\\b`));
    assert.match(simulator, new RegExp(`settings\\.${setting}\\b`));
  }
});

test("other-player win hazard table is editable and mapped to the engine", () => {
  assert.match(indexHtml, /other-win-hazard-grid/);
  assert.match(renderer, /otherWinHazardPercent_17/);
  assert.match(simulator, /other_win_hazard/);
  assert.match(main, /11\.70, 11\.70/);
});

test("every simulator checkbox defaults to enabled", () => {
  for (const [setting] of checkboxMappings) {
    if (setting === "enableCalls" || setting === "enableProbabilityPruning") continue;
    assert.match(main, new RegExp(`\\b${setting}: true[,\\n]`));
  }
});

test("tsumo share is present, saved as a number, and mapped to ron_rate", () => {
  assert.match(indexHtml, /name=["']tsumoWinSharePercent["']/);
  assert.match(renderer, /"tsumoWinSharePercent"/);
  assert.match(simulator, /settings\.tsumoWinSharePercent/);
  assert.match(simulator, /ron_rate/);
});

test("probability pruning has an independent toggle and editable threshold", () => {
  assert.match(indexHtml, /name=["']enableProbabilityPruning["']/);
  assert.match(indexHtml, /name=["']probabilityPruneThresholdPercent["']/);
  assert.match(renderer, /"probabilityPruneThresholdPercent"/);
  assert.match(simulator, /probability_prune_threshold/);
  assert.match(main, /probabilityPruneThresholdPercent: 0\.000001/);
});
