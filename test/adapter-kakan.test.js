"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/bigcoach-adapter.js"), "utf8");
const block = source.slice(source.indexOf("  function modernMeldTileCodes("), source.indexOf("  function buildModernMelds("));
const { normalizeTileCode } = require("../src/lib/tiles");
const convert = vm.runInNewContext(block + "\nmodernMeldTileCodes;", {
  normalizeTile: raw => raw == null ? null : normalizeTileCode(raw),
  normalizeForMeld: tile => tile[0] === "0" ? `5${tile[1]}` : tile,
});
test("review kakan includes its previous called tile exactly once", () => {
  const review = {type:"kakan", pai:"5m", previous_pon_pai:"0m", consumed:["5m", "5m"]};
  assert.equal(JSON.stringify(convert(review)), JSON.stringify(["5m", "0m", "5m", "5m"]));
  const mjai = {type:"kakan", pai:"5m", consumed:["0m", "5m", "5m"]};
  assert.equal(convert(mjai).length, 4);
});
