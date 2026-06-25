const test = require("node:test");
const assert = require("node:assert/strict");
const { codesToMpsz, removeKnownTiles, wallCounts, buildMelds, tileFilename } = require("../src/lib/tiles");

test("codesToMpsz converts tile codes to mpsz", () => {
  assert.equal(codesToMpsz(["1m", "3m", "2m", "0p", "5p", "1z"]), "123m05p1z");
});

test("removeKnownTiles removes known tiles from the wall", () => {
  const wall = removeKnownTiles(["1m", "1m", "0p", "5p"]);
  assert.equal(wall.length, 132);
  assert.equal(wall.filter((tile) => tile === "1m").length, 2);
  assert.equal(wall.filter((tile) => tile === "0p" || tile === "5p").length, 2);
});

test("buildMelds converts triplets and sequences", () => {
  assert.deepEqual(buildMelds(["1z", "1z", "1z"]), [{ type: 0, tiles: [27, 27, 27] }]);
  assert.deepEqual(buildMelds(["3m", "4m", "5m"]), [{ type: 1, tiles: [2, 3, 4] }]);
});

test("wallCounts has 37 entries", () => {
  const counts = wallCounts(["1m", "0m", "1z"]);
  assert.equal(counts.length, 37);
  assert.equal(counts[0], 1);
  assert.equal(counts[34], 1);
  assert.equal(counts[27], 1);
});

test("honor tile filenames map 白/發/中 correctly", () => {
  assert.equal(tileFilename("5z"), "ji6-66-90-s.png");
  assert.equal(tileFilename("6z"), "ji5-66-90-s.png");
  assert.equal(tileFilename("7z"), "ji7-66-90-s.png");
});
