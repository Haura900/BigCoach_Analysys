"use strict";

const state = { settings: null, scene: null, simulation: null, activeTab: "wall", history: [], tileImages: {}, currentPreviewId: null };
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

function yakuColor(entry) {
  if (entry?.yaku == null || entry?.isOther || entry?.name === "その他") return "#687386";
  let hash = 2166136261;
  for (const character of String(entry?.yaku ?? "unknown")) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return `hsl(${hash % 360} 62% 55%)`;
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
      <strong>${Number(score.score || 0).toFixed(0)}点</strong>
      <span>レベルアップ後概算スコア</span>
    </div>
    <div class="hand-score-grid">
      <span>面子 <strong>${score.mentsuCount ?? 0}</strong></span>
      <span>両面 <strong>${score.ryanmenCount ?? 0}</strong></span>
      <span>嵌張 <strong>${score.kanchanCount ?? 0}</strong></span>
      <span>辺張 <strong>${score.penchanCount ?? 0}</strong></span>
      <span>ドラ <strong>${score.doraCount ?? 0}</strong></span>
      <span>対子 <strong>${score.pairCount ?? 0}</strong></span>
    </div>`;
}

function analysisTable(analysis) {
  if (!analysis?.candidates?.length) return "<div class='empty'>候補なし</div>";
  const commonScale = Math.max(1, ...analysis.candidates.map((candidate) =>
    Math.max(0, Number(candidate.shapleyTotal || 0))));
  const contributionHtml = (candidate) => {
    const entries = candidate.yakuContributions || [];
    if (!entries.length) return "<span class='muted'>なし</span>";
    const chartEntries = candidate.yakuChartContributions || entries.slice(0, 5);
    const segments = chartEntries.map((entry) => {
      const width = Math.max(0, Number(entry.shapley || 0)) / commonScale * 100;
      const suffix = entry.count ? `（${entry.count}役）` : "";
      const label = entry.shortName || Array.from(String(entry.name || "役")).slice(0, 2).join("");
      return `<span class="yaku-chart-segment" style="width:${width.toFixed(4)}%;background:${yakuColor(entry)}" title="${escapeHtml(entry.name)}${suffix}: ${Number(entry.shapley).toFixed(1)}点">${escapeHtml(label)}</span>`;
    }).join("");
    const rows = entries.map((entry) =>
      `<tr><td>${escapeHtml(entry.name)}</td><td>${(entry.occurrence * 100).toFixed(2)}%</td><td>${entry.shapley.toFixed(1)}</td></tr>`
    ).join("");
    const calledRows = (candidate.calledYakuContributions || []).map((entry) =>
      `<tr><td>${escapeHtml(entry.name)}</td><td>${(entry.occurrence * 100).toFixed(2)}%</td><td>${entry.shapley.toFixed(1)}</td></tr>`
    ).join("");
    const calledTiles = (candidate.callTileRates || []).map((entry) =>
      `<span>${tile(entry.tile)}<small>全体 ${(entry.probability * 100).toFixed(2)}% / 副露時 ${(entry.conditionalProbability * 100).toFixed(1)}%</small></span>`
    ).join("");
    const calledDetails = candidate.callProbability > 1e-12
      ? `<h4>副露時の内訳 <small>副露発生 ${(candidate.callProbability * 100).toFixed(2)}%</small></h4>
        <div class="ukeire-tiles">${calledTiles || "なし"}</div>
        <table class="yaku-detail-table"><thead><tr><th>役</th><th>副露時出現率</th><th>副露時Shapley</th></tr></thead>
          <tbody>${calledRows || '<tr><td colspan="3">該当役なし</td></tr>'}</tbody></table>`
      : "";
    const residual = Math.abs(Number(candidate.shapleyResidual || 0));
    return `<div class="yaku-chart-track" aria-label="役別Shapley寄与。共通上限${commonScale.toFixed(1)}点">${segments}</div>
      <details class="yaku-contributions"><summary>詳細</summary>
        <table class="yaku-detail-table"><thead><tr><th>役</th><th>出現率</th><th>Shapley</th></tr></thead>
          <tbody>${rows}</tbody><tfoot><tr><th>合計</th><td>期待値 ${candidate.expectedScore.toFixed(1)}</td><td>${candidate.shapleyTotal.toFixed(1)}</td></tr>
          <tr><th>残差</th><td colspan="2">${residual.toFixed(4)}</td></tr></tfoot></table>${calledDetails}
      </details>`;
  };
  return `<table><thead><tr><th>打牌</th><th>期待値</th><th>和了率</th><th>聴牌率</th><th>副露和了率</th><th>受入</th><th>役別Shapley<small class="scale-label">共通上限 ${commonScale.toFixed(0)}点</small></th></tr></thead><tbody>${
    analysis.candidates.map((candidate, index) => `<tr class="${index === 0 ? "recommended" : ""}">
      <td>${tile(candidate.tile)}</td><td>${candidate.expectedScore.toFixed(0)}</td>
      <td>${(candidate.winProbability * 100).toFixed(2)}%</td>
      <td>${(candidate.tenpaiProbability * 100).toFixed(2)}%</td>
      <td>${(candidate.callWinProbability * 100).toFixed(2)}%</td>
      <td><div class="ukeire-tiles">${candidate.ukeire.map((item) =>
        `<span>${tile(item.tile)}<small>×${item.count}</small></span>`).join("")}</div><small>${candidate.ukeireTotal}枚</small></td><td>${contributionHtml(candidate)}</td>
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
  const hazards = Array.isArray(state.settings?.otherWinHazardPercent)
    ? state.settings.otherWinHazardPercent
    : [];
  $("#other-win-hazard-grid").innerHTML = Array.from({ length: 6 }, (_, row) =>
    [row + 1, row + 7, row + 13].map((turn) =>
      `<td>${turn}</td><td><input name="otherWinHazardPercent_${turn}" type="number" min="0" max="100" step="0.01" value="${Number(hazards[turn - 1] ?? 0).toFixed(2)}"${turn === 18 ? " readonly" : ""}></td>`
    ).join("")
  ).map((cells) => `<tr>${cells}</tr>`).join("");
  const turn17 = form.elements.namedItem("otherWinHazardPercent_17");
  const turn18 = form.elements.namedItem("otherWinHazardPercent_18");
  turn17?.addEventListener("input", () => { turn18.value = turn17.value; });
  for (const [key, value] of Object.entries(state.settings || {})) {
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
  state.currentPreviewId = null;
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
  toast(`配牌スコア: ${Number(result.score?.score || 0).toFixed(0)}点`);
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
  for (const name of ["enableRedDora", "enableUraDora", "enableShantenDown", "enableTegawari", "autoDisableDeepSearch", "enableRiichi", "enableCalls", "enableOtherWinStop"]) {
    data[name] = form.elements.namedItem(name).checked;
  }
  data.tags = data.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  for (const name of ["simulatorTimeoutSec", "tsumoWinSharePercent", ...HAND_SCORE_SETTING_KEYS]) {
    data[name] = Number(data[name]);
  }
  data.otherWinHazardPercent = Array.from({ length: 18 }, (_, index) =>
    Number(form.elements.namedItem(`otherWinHazardPercent_${index + 1}`).value));
  data.otherWinHazardPercent[17] = data.otherWinHazardPercent[16];
  for (let turn = 1; turn <= 18; ++turn) delete data[`otherWinHazardPercent_${turn}`];
  state.settings = await action("設定を保存中...", () => window.bigcoachApp.saveSettings(data));
  await closeDialog($("#settings-dialog"));
  toast("設定を保存しました");
});

let preparingCardPreview = false;
$("#preview-card").addEventListener("click", async () => {
  if (preparingCardPreview) return;
  preparingCardPreview = true;
  $("#preview-card").disabled = true;
  let capture;
  try {
    capture = await action("カード画像を撮影中...", () => window.bigcoachApp.captureCardPreview({
      memo: $("#memo").value,
      frontNote: $("#front-note").value
    }));
    if (capture.scene) renderScene(capture.scene);
    toast("撮影が完了しました。何切る解析をバックグラウンドで実行しています。");
  } catch {
    preparingCardPreview = false;
    $("#preview-card").disabled = false;
    await syncBigCoachVisibility();
    return;
  }

  window.bigcoachApp.finishCardPreview({ captureId: capture.captureId }).then(async (preview) => {
    if (preview.scene) renderScene(preview.scene);
    state.currentPreviewId = preview.previewId;
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
  }).catch(async (error) => {
    toast(error.message || String(error), true);
    await syncBigCoachVisibility();
  }).finally(() => {
    preparingCardPreview = false;
    $("#preview-card").disabled = false;
  });
});

$("#preview-close").addEventListener("click", () => {
  const dialog = $("#preview-dialog");
  dialog.dataset.mode = "";
  resetNormalCardForm();
  closeDialog(dialog).catch((error) => toast(error.message || String(error), true));
});

let registeringCard = false;
$("#register-card").addEventListener("click", (event) => {
  event.preventDefault();
  if (registeringCard) return;
  const previewId = state.currentPreviewId;
  if (!previewId) {
    toast("プレビュー内容が見つかりません。もう一度プレビューしてください。", true);
    return;
  }
  registeringCard = true;
  $("#register-card").disabled = true;
  const dialog = $("#preview-dialog");
  const payload = {
    previewId,
    deckName: $("#preview-deck").value,
    duplicateMode: $("#duplicate-mode").value
  };
  dialog.dataset.mode = "";
  resetNormalCardForm();
  closeDialog(dialog).catch((error) => toast(error.message || String(error), true));
  toast("Anki登録を開始しました。完了まで他の操作を続けられます。");
  window.bigcoachApp.registerCard(payload).then((result) => {
    if (result.skipped) toast("重複カードのため登録をスキップしました");
    else if (result.updated) toast(`既存カードを更新しました（ID: ${result.noteId}）`);
    else toast(`Ankiカードを登録しました（ID: ${result.noteId}）`);
  }).catch((error) => {
    toast(error.message || String(error), true);
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
