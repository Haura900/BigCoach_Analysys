"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFullWall, removeKnownTiles, wallCounts } = require("../src/lib/tiles");
const { SimulatorService } = require("../src/lib/simulator");
const { sceneForCallAction } = require("../src/lib/ev-model");
const simulator = new SimulatorService({ resourcesPath: "", log() {} });
const sum = counts => counts.slice(0, 34).reduce((a, b) => a + b, 0);
const scene = {
  handTiles: ["5m","0m","6m","1p","2p","3p","1s","2s","3s","5z","5z","7s","8s"],
  riverTiles: ["4m"], callTiles: [], selfCallTiles: [], selfMelds: [],
  doraTiles: [], roundWind: "1z", seatWind: "2z"
};
test("wall fives include their red copy without inflating the physical total", () => {
  const wall = wallCounts(createFullWall());
  assert.equal(sum(wall), 136);
  for (const [normal, red] of [[4,34],[13,35],[22,36]]) {
    assert.equal(wall[normal], 4);
    assert.equal(wall[red], 1);
  }
  const redOnly = wallCounts(removeKnownTiles(["5m","5m","5m"]));
  assert.equal(redOnly[4], 1);
  assert.equal(redOnly[34], 1);
});
test("red disabled merges physical fives and sends zero red flags", () => {
  const wall = wallCounts(removeKnownTiles(["5m","5m","5m","5m"], false), false);
  assert.equal(sum(wall), 132);
  assert.equal(wall[4], 0);
  assert.deepEqual(wall.slice(34), [0,0,0]);
  const payload = simulator.buildPayload(scene, {enableRedDora:false}, true);
  assert.deepEqual(payload.wall.slice(34), [0,0,0]);
});
test("duplicate physical tiles are rejected instead of silently altering the wall", () => {
  assert.throws(() => removeKnownTiles(["0m","0m"]), /枚数/);
  assert.throws(() => removeKnownTiles(Array(5).fill("3m")), /枚数/);
});
test("own 3m concealed kan gives zero remaining 3m for a 12m edge wait", () => {
  const payload = simulator.buildPayload({...scene, handTiles:["1m","2m","9p","6z","6z"],
    riverTiles:[], callTiles:["3m","3m","3m","3m","5z","5z","5z","1z","1z","1z"],
    selfMelds:[{type:2,tiles:[2,2,2,2]},{type:0,tiles:[31,31,31]},{type:0,tiles:[27,27,27]}]
  }, {enableRedDora:true}, true);
  assert.equal(payload.wall[2], 0);
  assert.equal(sum(payload.wall), 121);
});
test("chi consumes the exact red tile and transfers the river tile once", () => {
  const before = simulator.buildPayload(scene, {enableRedDora:true}, true).wall;
  const after = sceneForCallAction(scene, {type:"chi",pai:"4m",consumed:["0m","6m"]});
  assert.ok(after.handTiles.includes("5m"));
  assert.ok(!after.handTiles.includes("0m"));
  assert.deepEqual(after.riverTiles, []);
  assert.deepEqual(after.selfMelds, [{type:1,tiles:[3,34,5]}]);
  const afterWall = simulator.buildPayload(after, {enableRedDora:true}, true).wall;
  assert.deepEqual(afterWall, before);
  assert.throws(() => sceneForCallAction(scene, {type:"pon",pai:"2m",consumed:["2m","2m"]}), /手牌/);
});
test("kakan upgrades its pon and removes only the added concealed tile", () => {
  const before = {...scene, handTiles:["5m","1p","2p","3p","1s","2s","3s","5z","5z","7s","8s"],
    riverTiles:[], selfMelds:[{type:0,tiles:[34,4,4]}], selfCallTiles:["0m","5m","5m"],callTiles:["0m","5m","5m"]};
  const after = sceneForCallAction(before,{type:"kakan",pai:"5m",consumed:["0m","5m","5m"]});
  assert.equal(after.handTiles.length, 10);
  assert.deepEqual(after.selfMelds, [{type:4,tiles:[34,4,4,4]}]);
  assert.equal(after.callTiles.length, 4);
  assert.deepEqual(simulator.buildPayload(after,{enableRedDora:true},true).wall,
    simulator.buildPayload(before,{enableRedDora:true},true).wall);
});
test("actual red discard keeps its own EV even when the normal five ranks first", () => {
  const source = fs.readFileSync(path.join(__dirname,"../src/main.js"),"utf8");
  const lookup = vm.runInNewContext(source.slice(source.indexOf("function sameTile("),source.indexOf("function actionLabel("))+"\ncandidateForTile;");
  const candidates = [{tile:"5m",totalEv:200},{tile:"0m",totalEv:100}];
  assert.equal(lookup({candidates},"0m").totalEv,100);
});
