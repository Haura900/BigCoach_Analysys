const test = require("node:test");
const assert = require("node:assert/strict");
const { codesToMpsz, removeKnownTiles, wallCounts, buildMelds } = require("../src/lib/tiles");

test("牌コードをmpszへ変換する", () => {
  assert.equal(codesToMpsz(["1m", "3m", "2m", "0p", "5p", "1z"]), "123m05p1z");
});

test("既知牌を山から除外する", () => {
  const wall = removeKnownTiles(["1m", "1m", "0p", "5p"]);
  assert.equal(wall.length, 132);
  assert.equal(wall.filter((tile) => tile === "1m").length, 2);
  assert.equal(wall.filter((tile) => tile === "0p" || tile === "5p").length, 2);
});

test("副露をシミュレーター形式へ変換する", () => {
  assert.deepEqual(buildMelds(["1z", "1z", "1z"]), [{ type: 0, tiles: [27, 27, 27] }]);
  assert.deepEqual(buildMelds(["3m", "4m", "5m"]), [{ type: 1, tiles: [2, 3, 4] }]);
});

test("壁配列は37要素", () => {
  const counts = wallCounts(["1m", "0m", "1z"]);
  assert.equal(counts.length, 37);
  assert.equal(counts[0], 1);
  assert.equal(counts[34], 1);
  assert.equal(counts[27], 1);
});
