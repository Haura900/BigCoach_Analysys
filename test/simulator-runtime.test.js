"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SimulatorService, formatExitCode } = require("../src/lib/simulator");

const simulatorDirectory = path.join(__dirname, "..", "resources", "simulator");

test("bundled simulator includes its app-local MSVC runtime", () => {
  for (const filename of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) {
    const filePath = path.join(simulatorDirectory, filename);
    assert.ok(fs.existsSync(filePath), `${filename} must be bundled beside nanikiru.exe`);
    assert.ok(fs.statSync(filePath).size > 0, `${filename} must not be empty`);
  }
});

test("Windows process exit codes are formatted as unsigned hexadecimal", () => {
  assert.equal(formatExitCode(-1073741515), "0xC0000135");
});

test("河・副露補正はポンされた牌3枚を山から除く", () => {
  const simulator = new SimulatorService({ resourcesPath: "", log: () => {} });
  const payload = simulator.buildPayload({
    handTiles: ["7m", "7m", "7m", "7p", "8p", "1s", "1s", "3s", "0s", "6s", "9s", "9s", "3z", "9m"],
    doraTiles: ["7m"],
    riverTiles: ["9m", "6m", "1z"],
    callTiles: ["2s", "2s", "2s"],
    selfMelds: [],
    roundWind: "2z",
    seatWind: "2z"
  }, {}, true);

  assert.equal(payload.wall[19], 1);
});
