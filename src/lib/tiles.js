"use strict";

const TILE_INDEX_TO_CODE = [
  "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
  "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
  "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
  "1z", "2z", "3z", "4z", "5z", "6z", "7z",
  "0m", "0p", "0s"
];
const TILE_CODE_TO_INDEX = Object.fromEntries(TILE_INDEX_TO_CODE.map((code, index) => [code, index]));
const HONOR_TILE_FILENAMES = {
  1: "ji1-66-90-s.png",
  2: "ji2-66-90-s.png",
  3: "ji3-66-90-s.png",
  4: "ji4-66-90-s.png",
  5: "ji6-66-90-s.png",
  6: "ji5-66-90-s.png",
  7: "ji7-66-90-s.png"
};

function normalizeTileCode(value) {
  if (typeof value === "number" && TILE_INDEX_TO_CODE[value]) return TILE_INDEX_TO_CODE[value];
  const text = String(value ?? "").trim();
  if (/^[0-9][mpsz]$/.test(text) && !(text[0] === "0" && text[1] === "z")) return text;
  if (/^\d+$/.test(text) && TILE_INDEX_TO_CODE[Number(text)]) return TILE_INDEX_TO_CODE[Number(text)];
  throw new Error(`未対応の牌コードです: ${value}`);
}

function codesToMpsz(codes) {
  const groups = { m: [], p: [], s: [], z: [] };
  for (const raw of codes || []) {
    const code = normalizeTileCode(raw);
    groups[code[1]].push(code[0]);
  }
  return ["m", "p", "s", "z"]
    .map((suit) => groups[suit].length ? `${groups[suit].sort((a, b) => Number(a || 5) - Number(b || 5)).join("")}${suit}` : "")
    .join("");
}

function codesToIndices(codes) {
  return (codes || []).map((code) => TILE_CODE_TO_INDEX[normalizeTileCode(code)]);
}

function windToIndex(code) {
  const normalized = normalizeTileCode(code);
  if (!["1z", "2z", "3z", "4z"].includes(normalized)) throw new Error(`風牌が不正です: ${code}`);
  return TILE_CODE_TO_INDEX[normalized];
}

function normalizeForCount(code) {
  const tile = normalizeTileCode(code);
  return tile[0] === "0" ? `5${tile[1]}` : tile;
}

function createFullWall() {
  const wall = [];
  for (const suit of ["m", "p", "s"]) {
    for (let number = 1; number <= 9; number += 1) {
      if (number === 5) wall.push(`0${suit}`, `5${suit}`, `5${suit}`, `5${suit}`);
      else wall.push(...Array(4).fill(`${number}${suit}`));
    }
  }
  for (let number = 1; number <= 7; number += 1) wall.push(...Array(4).fill(`${number}z`));
  return wall;
}

function removeKnownTiles(knownCodes) {
  const wall = createFullWall();
  for (const raw of knownCodes || []) {
    const code = normalizeTileCode(raw);
    let index = wall.indexOf(code);
    if (index < 0 && code[0] === "5") index = wall.indexOf(`0${code[1]}`);
    if (index < 0 && code[0] === "0") index = wall.indexOf(`5${code[1]}`);
    if (index >= 0) wall.splice(index, 1);
  }
  return wall;
}

function wallCounts(codes) {
  const counts = Array(37).fill(0);
  for (const code of codes || []) counts[TILE_CODE_TO_INDEX[normalizeTileCode(code)]] += 1;
  return counts;
}

function tileFilename(code) {
  if (!code) return null;
  if (code === "0p") return "aka1-66-90-s.png";
  if (code === "0s") return "aka2-66-90-s.png";
  if (code === "0m") return "aka3-66-90-s.png";
  const normalized = normalizeTileCode(code);
  if (normalized[1] === "z") return HONOR_TILE_FILENAMES[Number(normalized[0])] || null;
  const suit = { m: "man", p: "pin", s: "sou" }[normalized[1]];
  return suit ? `${suit}${normalized[0]}-66-90-s.png` : null;
}

function inferMeldType(tiles) {
  const normalized = tiles.map(normalizeForCount);
  if (new Set(normalized).size === 1) return normalized.length === 4 ? 3 : 0;
  const numbers = normalized.map((code) => Number(code[0])).sort((a, b) => a - b);
  const suits = new Set(normalized.map((code) => code[1]));
  if (normalized.length === 3 && suits.size === 1 && !suits.has("z") &&
      numbers[1] === numbers[0] + 1 && numbers[2] === numbers[1] + 1) return 1;
  return 0;
}

function buildMelds(callTiles) {
  const source = [...(callTiles || [])];
  const melds = [];
  for (let index = 0; index < source.length;) {
    const remaining = source.length - index;
    let size = 3;
    const four = source.slice(index, index + 4);
    if (remaining >= 4 && new Set(four.map(normalizeForCount)).size === 1 && (remaining - 4) % 3 === 0) size = 4;
    const tiles = source.slice(index, index + size);
    if (tiles.length < 3) break;
    melds.push({ type: inferMeldType(tiles), tiles: codesToIndices(tiles) });
    index += size;
  }
  return melds;
}

module.exports = {
  TILE_INDEX_TO_CODE,
  TILE_CODE_TO_INDEX,
  normalizeTileCode,
  codesToMpsz,
  codesToIndices,
  windToIndex,
  createFullWall,
  removeKnownTiles,
  wallCounts,
  buildMelds,
  tileFilename
};
