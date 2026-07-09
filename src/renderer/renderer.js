"use strict";

const state = { settings: null, scene: null, simulation: null, activeTab: "wall", history: [], tileImages: {} };
const HAND_SCORE_SETTING_KEYS = [
  "handScoreDoraSingle",
  "handScoreDoraPair",
  "handScoreMentsu",
  "handScoreRyanmen",
  "handScoreKanchan",
  "handScorePenchan",
  "handScoreNonYakuhaiPair",
  "handScoreExcessPair",
  "handScoreYakuhaiPair",
  "handScoreDealerBonus"
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function busy(text, enabled = true) {
  $("#busy-text").textContent = text;
  $("#busy").classList.toggle("hidden", !enabled);
}

let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.remove("hidden");
  toastTimer = setTimeout(() => element.classList.add("hidden"), error ? 8000 : 3500);
}

async function action(label, operation) {
  busy(label);
  try {
    return await operation();
  } catch (error) {
    toast(error.message || String(error), true);
    throw error;
  } finally {
    busy("", false);
  }
}

async function waitForSceneReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await window.bigcoachApp.refreshScene();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError || new Error("解析結果を読み込めませんでした。");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function tile(code) {
  return code && state.tileImages[code]
    ? `<img class="tile-image" src="${state.tileImages[code]}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}">`
    : (code ? `<span class="tile">${escapeHtml(code)}</span>` : "—");
}

function renderPreviewDecks(preview) {
  const decks = preview?.decks?.length
    ? preview.decks
    : [preview?.deckName || state.settings?.deckName || "BigCoach"];
  const selected = preview?.deckName || decks[0] || "";
  $("#preview-deck").innerHTML = decks.map((deck) =>
    `<option value="${escapeHtml(deck)}"${deck === selected ? " selected" : ""}>${escapeHtml(deck)}</option>`
  ).join("");
}

function renderScene(scene) {
  state.scene = scene;
  $("#copy-hand-mpsz").disabled = !scene?.handMpsz;
  $("#scene-title").textContent = `${scene.roundText || "局面不明"} / ${scene.currentTurn || "?"}巡目 / ${scene.actorText || "手番不明"}`;
  const chips = [
    `手牌 ${scene.handMpsz || "取得なし"}`,
    `ドラ ${scene.doraTiles?.join(" ") || "取得なし"}`,
    `実打 ${scene.actualDiscard || "取得なし"}`,
    `推奨 ${scene.recommendedDiscard || "取得なし"}`
  ];
  $("#scene-chips").innerHTML = chips.map((text) => `<span class="chip">${escapeHtml(text)}</span>`).join("");
  const missingItems = scene?.missing || [];
  $("#missing-info").classList.toggle("hidden", !missingItems.length);
  $("#missing-info").textContent = missingItems.length
    ? `取得できなかった情報: ${missingItems.join("、")}\n表示状態またはUI変更を確認してください。`
    : "";
  renderResults();
}

function renderComparison(comparison) {
  if (!comparison) {
    $("#comparison").innerHTML = "";
    return;
  }
  $("#comparison").innerHTML = [
    ["実打", comparison.actual],
    ["BigCoach", comparison.bigCoach],
    ["シミュレーター", comparison.simulator]
  ].map(([label, value]) => `<div class="comparison-item"><span>${label}</span><strong>${escapeHtml(value || "—")}</strong></div>`).join("");
}

function renderHandScore(result) {
  const container = $("#hand-score-result");
  if (!result?.score) {
    container.classList.add("empty");
    container.textContent = "局面を取得してから計算してください";
    return;
  }
  const score = result.score;
  container.classList.remove("empty");
  container.innerHTML = `
    <div class="hand-score-main">
      <strong>${score.score.toFixed(0)}点</strong>
      <span>レベルアップ後概算スコア</span>
    </div>
    <div class="hand-score-grid">
      <span>面子 <strong>${score.mentsuCount}</strong></span>
      <span>両面 <strong>${score.ryanmenCount}</strong></span>
      <span>カンチャン <strong>${score.kanchanCount}</strong></span>
      <span>ペンチャン <strong>${score.penchanCount}</strong></span>
      <span>対子 <strong>${score.toitsuCount}</strong></span>
      <span>役牌対子 <strong>${score.yakuhaiPairs}</strong></span>
      <span>役牌以外対子 <strong>${score.nonYakuhaiPairs}</strong></span>
      <span>3個目以降 <strong>${score.excessPairs}</strong></span>
      <span>ドラ枚数 <strong>${score.doraSingleCount}</strong></span>
      <span>ドラ対子/ダブドラ <strong>${score.doraPairCount}</strong></span>
      <span>ドラ点 <strong>${score.doraPoints}</strong></span>
      <span>親番点 <strong>${score.dealerBonus}</strong></span>
    </div>
  `;
}

function analysisTable(analysis) {
  if (!analysis?.candidates?.length) return "<div class='empty'>候補なし</div>";
  return `<table><thead><tr><th>打牌</th><th>期待値</th><th>和了率</th><th>聴牌率</th><th>受入</th></tr></thead><tbody>${
    analysis.candidates.map((candidate, index) => `<tr class="${index === 0 ? "recommended" : ""}">
      <td>${tile(candidate.tile)}</td><td>${candidate.expectedScore.toFixed(0)}</td>
      <td>${(candidate.winProbability * 100).toFixed(2)}%</td>
      <td>${(candidate.tenpaiProbability * 100).toFixed(2)}%</td>
      <td><div class="ukeire-tiles">${candidate.ukeire.map((item) =>
        `<span>${tile(item.tile)}<small>×${item.count}</small></span>`).join("")}</div><small>${candidate.ukeireTotal}枚</small></td>
    </tr>`).join("")
  }</tbody></table>`;
}

function bigCoachTable(scene) {
  if (!scene?.candidates?.length) return "<div class='empty'>BigCoach候補評価を取得できませんでした。</div>";
  return `<table><thead><tr><th>打牌</th><th>評価</th><th>表示内容</th></tr></thead><tbody>${
    scene.candidates.map((candidate) => `<tr class="${candidate.tile === scene.recommendedDiscard ? "recommended" : ""}">
      <td>${tile(candidate.tile)}</td><td>${candidate.value == null ? "—" : candidate.value.toFixed(4)}</td>
      <td title="${escapeHtml(candidate.raw)}">${escapeHtml(candidate.label.slice(0, 35))}</td></tr>`).join("")
  }</tbody></table>`;
}

function renderResults() {
  const results = $("#results");
  if (state.activeTab === "bigcoach") {
    results.classList.remove("empty");
    results.innerHTML = bigCoachTable(state.scene);
    return;
  }
  if (!state.simulation) {
    results.classList.add("empty");
    results.textContent = "シミュレーター未実行";
    return;
  }
  results.classList.remove("empty");
  results.innerHTML = analysisTable(state.activeTab === "wall" ? state.simulation.withWall : state.simulation.withoutWall);
}

function renderHistory(history) {
  state.history = history || [];
  $("#review-history").innerHTML = `<option value="">履歴を選択</option>${state.history.map((item) => {
    const label = item.url.replace(/^https:\/\/(?:gokujan\.com|review\.bigcoach\.work)\/review\//, "");
    return `<option value="${escapeHtml(item.url)}">${escapeHtml(label)}</option>`;
  }).join("")}`;
}

function populateSettings() {
  const form = $("#settings-form");
  for (const [key, value] of Object.entries(state.settings)) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = Array.isArray(value) ? value.join(", ") : value;
  }
}

async function syncBigCoachVisibility() {
  const overlayOpen = $$("dialog").some((dialog) => dialog.open);
  return window.bigcoachApp.setOverlayOpen(overlayOpen);
}

async function closeDialog(dialog) {
  dialog.dataset.skipCloseSync = "1";
  dialog.close();
  return syncBigCoachVisibility();
}

function resetNormalCardForm() {
  $("#front-note").value = "";
  $("#memo").value = "";
  $("#front-preview").innerHTML = "";
  $("#back-preview").innerHTML = "";
  $("#duplicate-warning").classList.add("hidden");
  $("#duplicate-warning").textContent = "";
}

async function initialLoad() {
  const initial = await window.bigcoachApp.getState();
  Object.assign(state, initial);
  document.documentElement.style.setProperty("--panel-width", `${state.settings.panelWidth}px`);
  window.bigcoachApp.setPanelWidth(state.settings.panelWidth);
  if (state.scene) renderScene(state.scene);
  if (state.simulation) renderResults();
  populateSettings();
  renderHistory(initial.history);
}

$("#open-review-url").addEventListener("click", () => action("解析結果URLを開いています...", async () => {
  const result = await window.bigcoachApp.openReviewUrl($("#review-url").value);
  renderHistory(result.history);
  renderScene(await waitForSceneReady());
  toast("解析結果URLを開きました");
}));

$("#review-history").addEventListener("change", (event) => {
  if (!event.target.value) return;
  $("#review-url").value = event.target.value;
  $("#open-review-url").click();
});

$("#refresh-scene").addEventListener("click", () => action("局面を取得中...", async () => {
  renderScene(await window.bigcoachApp.refreshScene());
  toast("局面を取得しました");
}));

$("#copy-hand-mpsz").addEventListener("click", async () => {
  const handMpsz = state.scene?.handMpsz;
  if (!handMpsz) {
    toast("手牌mpszを取得できる局面を先に読み込んでください", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(handMpsz);
    toast(`手牌mpszをコピーしました: ${handMpsz}`);
  } catch (error) {
    toast(error.message || "クリップボードへコピーできませんでした", true);
  }
});

$("#stock-first-discards").addEventListener("click", () => action("各局第一打データをCSVへ保存中...", async () => {
  const result = await window.bigcoachApp.stockFirstDiscards();
  $("#first-discard-stock-status").textContent =
    `保存先: ${result.path}\n対象 ${result.total} 件 / 追加 ${result.added} 件 / 重複スキップ ${result.skipped} 件` +
    (result.missingWinRate ? ` / 和了率未取得 ${result.missingWinRate} 件` : "");
  toast(`第一打データをCSVに保存しました（追加 ${result.added} 件）`);
}));

$("#run-simulation").addEventListener("click", () => action("何切るシミュレーター実行中...", async () => {
  if (!state.scene) renderScene(await window.bigcoachApp.refreshScene());
  const result = await window.bigcoachApp.runSimulation();
  if (result.scene) renderScene(result.scene);
  state.simulation = result.simulation;
  renderComparison(result.comparison);
  renderResults();
  toast("シミュレーターが完了しました");
}));

$("#calculate-hand-score").addEventListener("click", () => action("配牌スコアを計算中...", async () => {
  const result = await window.bigcoachApp.calculateHandScore();
  if (result.scene) renderScene(result.scene);
  renderHandScore(result);
  toast(`配牌スコア: ${result.score.score.toFixed(0)}点`);
}));

$$(".tab").forEach((button) => button.addEventListener("click", () => {
  state.activeTab = button.dataset.tab;
  $$(".tab").forEach((item) => item.classList.toggle("active", item === button));
  renderResults();
}));

$("#settings-open").addEventListener("click", () => {
  populateSettings();
  $("#settings-dialog").showModal();
  syncBigCoachVisibility().catch((error) => toast(error.message || String(error), true));
});

$("#settings-save").addEventListener("click", async (event) => {
  event.preventDefault();
  const form = $("#settings-form");
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  for (const name of ["enableRedDora", "enableUraDora", "enableShantenDown", "enableTegawari", "enableRiichi"]) {
    data[name] = form.elements.namedItem(name).checked;
  }
  data.tags = data.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  for (const name of ["simulatorTimeoutSec", ...HAND_SCORE_SETTING_KEYS]) {
    data[name] = Number(data[name]);
  }
  state.settings = await action("設定を保存中...", () => window.bigcoachApp.saveSettings(data));
  await closeDialog($("#settings-dialog"));
  toast("設定を保存しました");
});

$("#preview-card").addEventListener("click", async () => {
  try {
    await action("何切る実行とカード画像作成中...", async () => {
      const preview = await window.bigcoachApp.previewCard({
        memo: $("#memo").value,
        frontNote: $("#front-note").value
      });
      if (preview.scene) renderScene(preview.scene);
      state.simulation = preview.simulation;
      renderComparison(preview.comparison);
      renderResults();
      renderPreviewDecks(preview);
      $("#front-preview").innerHTML = preview.front;
      $("#back-preview").innerHTML = preview.back;
      const warning = $("#duplicate-warning");
      warning.classList.toggle("hidden", !preview.duplicates.length);
      warning.textContent = preview.duplicates.length
        ? `同じ局面IDのカードが ${preview.duplicates.length} 件あります。登録方法を選択してください。`
        : "";
      $("#preview-dialog").dataset.mode = "normal";
      $("#preview-dialog").showModal();
      await syncBigCoachVisibility();
    });
  } catch {
    await syncBigCoachVisibility();
  }
});

$("#preview-close").addEventListener("click", () => {
  const dialog = $("#preview-dialog");
  dialog.dataset.mode = "";
  closeDialog(dialog).catch((error) => toast(error.message || String(error), true));
});

let registeringCard = false;
$("#register-card").addEventListener("click", (event) => {
  event.preventDefault();
  if (registeringCard) return;
  registeringCard = true;
  $("#register-card").disabled = true;
  action("Ankiへ登録中...", async () => {
    const dialog = $("#preview-dialog");
    const result = await window.bigcoachApp.registerCard({
      memo: $("#memo").value,
      frontNote: $("#front-note").value,
      deckName: $("#preview-deck").value,
      duplicateMode: $("#duplicate-mode").value
    });
    dialog.dataset.mode = "";
    resetNormalCardForm();
    await closeDialog(dialog);
    if (result.skipped) toast("重複カードのため登録をスキップしました");
    else if (result.updated) toast(`既存カードを更新しました（ID: ${result.noteId}）`);
    else toast(`Ankiカードを登録しました（ID: ${result.noteId}）`);
  }).finally(() => {
    registeringCard = false;
    $("#register-card").disabled = false;
  });
});

for (const dialog of $$("dialog")) {
  dialog.addEventListener("close", () => {
    if (dialog.dataset.skipCloseSync === "1") {
      dialog.dataset.skipCloseSync = "";
      return;
    }
    syncBigCoachVisibility().catch((error) => toast(error.message || String(error), true));
  });
}

window.bigcoachApp.onBigCoachStatus((status) => {
  $("#browser-status").textContent = status.ok ? "gokujan.com: 接続済み" : `gokujan.com: ${status.message || "エラー"}`;
  $("#browser-status").className = status.ok ? "muted diagnostic-ok" : "muted diagnostic-ng";
  if (status.history) renderHistory(status.history);
});

window.addEventListener("resize", () => {
  const width = $("#panel").getBoundingClientRect().width;
  window.bigcoachApp.setPanelWidth(width);
});

initialLoad().catch((error) => toast(error.message || String(error), true));
