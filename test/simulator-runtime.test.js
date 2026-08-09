"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { formatExitCode } = require("../src/lib/simulator");

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
