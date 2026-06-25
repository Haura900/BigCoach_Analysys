"use strict";

const state = { settings: null, scene: null, simulation: null, activeTab: "wall" };
state.majorMistakes = [];
state.history = [];
state.tileImages = {};
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

async function waitForSceneReady(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await window.bigcoachApp.refreshScene();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error("BigCoachの解析結果を読み込めませんでした");
}

function tile(code) {
  return code && state.tileImages[code]
    ? `<img class="tile-image" src="${state.tileImages[code]}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}">`
    : (code ? `<span class="tile">${escapeHtml(code)}</span>` : "—");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderScene(scene) {
  state.scene = scene;
  $("#copy-hand-mpsz").disabled = !scene?.handMpsz;
  $("#scene-title").textContent = `${scene.roundText || "局情報不明"} / ${scene.currentTurn || "?"}巡目 / ${scene.actorText || "手番不明"}`;
  const chips = [
    `手牌 ${scene.handMpsz || "取得なし"}`,
    `ドラ ${scene.doraTiles.join(" ") || "取得なし"}`,
    `実打 ${scene.actualDiscard || "取得なし"}`,
    `推奨 ${scene.recommendedDiscard || "取得なし"}`
  ];
  if (scene.shinMistake?.eligible) chips.push(scene.shinMistake.isShin ? "シン悪手" : "非シン悪手");
  if (scene.majorMistake?.isMajor) chips.push("大悪手");
  if (scene.nanikiruMistake?.isNanikiruMistake) chips.push("何切る悪手");
  $("#scene-chips").innerHTML = chips.map((text, index) =>
    `<span class="chip ${text === "大悪手" || text === "シン悪手" ? "shin" : ""}">${escapeHtml(text)}</span>`).join("");
  const missing = $("#missing-info");
  missing.classList.toggle("hidden", !scene.missing.length);
  missing.textContent = scene.missing.length
    ? `取得できなかった情報: ${scene.missing.join("、")}\nBigCoach側の表示状態またはUI変更を確認してください。`
    : "";
  $("#shin-status").textContent = `シン悪手: ${
    scene.shinMistake?.isShin ? "該当" : "非該当"
  } — ${scene.shinMistake?.reason || "評価なし"}。大悪手: ${
      scene.majorMistake?.isMajor ? "該当" : "非該当"
    } — ${scene.majorMistake?.reason || "評価なし"}。`;
  renderNanikiruMistake(scene.nanikiruMistake);
  renderResults();
}

function renderNanikiruMistake(result) {
  const element = $("#nanikiru-mistake-status");
  if (!result) {
    element.textContent = "何切る悪手: 未判定";
    return;
  }
  element.textContent = `何切る悪手: ${result.isNanikiruMistake ? "該当" :
    result.eligible ? "シミュレーター判定待ち" : "非該当"} — ${result.reason}`;
  element.classList.toggle("diagnostic-ng", Boolean(result.isNanikiruMistake));
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
  const items = $$(".comparison-item");
  if (comparison.bigCoach && comparison.simulator) {
    items[1].classList.add(comparison.bigCoachMatchesSimulator ? "match" : "mismatch");
    items[2].classList.add(comparison.bigCoachMatchesSimulator ? "match" : "mismatch");
  }
}

function analysisTable(analysis) {
  if (!analysis?.candidates?.length) return "<div class='empty'>候補なし</div>";
  return `<table><thead><tr><th>打牌</th><th>期待値</th><th>和了</th><th>聴牌</th><th>受入</th></tr></thead><tbody>${
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

function renderDiagnostics(diagnostics) {
  const labels = { bigCoach: "BigCoach表示", scene: "局面取得", simulator: "何切る", anki: "Anki連携" };
  $("#diagnostics").innerHTML = Object.entries(diagnostics).map(([key, value]) =>
    `<div class="${value.ok ? "diagnostic-ok" : "diagnostic-ng"}">${value.ok ? "●" : "●"} ${labels[key]}: ${escapeHtml(value.message)}</div>`).join("");
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

function renderHistory(history) {
  state.history = history || [];
  const select = $("#review-history");
  select.innerHTML = `<option value="">履歴を選択</option>${state.history.map((item) =>
    `<option value="${escapeHtml(item.url)}">${escapeHtml(item.url.replace("https://review.bigcoach.work/review/", ""))}</option>`
  ).join("")}`;
}

function renderStats(result) {
  const formatRate = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;
  $("#current-shin-rate").textContent = formatRate(result.current.rate);
  $("#current-shin-count").textContent = `${result.current.count} / ${result.current.denominator}`;
  $("#total-shin-rate").textContent = formatRate(result.cumulative.rate);
  $("#total-shin-count").textContent = `${result.cumulative.count} / ${result.cumulative.denominator}`;
  $("#stats-note").textContent = `今回 ${result.currentRounds}局 / 通算 ${result.uniqueRounds}局（4人全員の配牌で重複除外）`;
  renderTrendChart(result.trend || []);
}

function renderTrendChart(trend) {
  const root = $("#shin-trend-chart");
  if (!trend.length) {
    root.innerHTML = `<div class="trend-empty">推移データがありません。</div>`;
    return;
  }
  const points = trend.slice(-30);
  const width = 440;
  const height = 190;
  const margin = { left: 38, right: 12, top: 12, bottom: 34 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const values = points.flatMap((item) => [item.current.rate, item.cumulative.rate]);
  const maxRate = Math.max(0.05, ...values);
  const ceiling = Math.min(1, Math.ceil(maxRate * 10) / 10);
  const x = (index) => margin.left + (points.length === 1 ? innerWidth / 2 : index * innerWidth / (points.length - 1));
  const y = (rate) => margin.top + innerHeight * (1 - Number(rate || 0) / ceiling);
  const path = (selector) => points.map((item, index) =>
    `${index ? "L" : "M"}${x(index).toFixed(1)},${y(selector(item)).toFixed(1)}`).join(" ");
  const percent = (value) => `${(Number(value || 0) * 100).toFixed(2)}%`;
  const dateLabel = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "不明" : `${date.getMonth() + 1}/${date.getDate()}`;
  };
  const yTicks = [0, ceiling / 2, ceiling];
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="シン悪手率の推移">
    ${yTicks.map((rate) => `
      <line class="trend-grid" x1="${margin.left}" y1="${y(rate)}" x2="${width - margin.right}" y2="${y(rate)}"></line>
      <text class="trend-axis-label" x="${margin.left - 5}" y="${y(rate) + 4}" text-anchor="end">${(rate * 100).toFixed(0)}%</text>
    `).join("")}
    <path class="trend-line cumulative" d="${path((item) => item.cumulative.rate)}"></path>
    <path class="trend-line current" d="${path((item) => item.current.rate)}"></path>
    ${points.map((item, index) => `
      <circle class="trend-point cumulative" cx="${x(index)}" cy="${y(item.cumulative.rate)}" r="3">
        <title>${dateLabel(item.recordedAt)} 通算 ${percent(item.cumulative.rate)} (${item.cumulative.count}/${item.cumulative.denominator})</title>
      </circle>
      <circle class="trend-point current" cx="${x(index)}" cy="${y(item.current.rate)}" r="3.5">
        <title>${dateLabel(item.recordedAt)} 各解析 ${percent(item.current.rate)} (${item.current.count}/${item.current.denominator}) ${item.rounds}局</title>
      </circle>
    `).join("")}
    ${labelIndexes.map((index) => `<text class="trend-axis-label" x="${x(index)}" y="${height - 8}" text-anchor="middle">${dateLabel(points[index].recordedAt)}</text>`).join("")}
  </svg>
  <div class="trend-latest">最新: 各解析 ${percent(points.at(-1).current.rate)} ／ 通算 ${percent(points.at(-1).cumulative.rate)}　全${trend.length}解析</div>`;
}

async function syncBigCoachVisibility() {
  const overlayOpen = $$("dialog").some((dialog) => dialog.open);
  return window.bigcoachApp.setOverlayOpen(overlayOpen);
}

async function openDialog(dialog) {
  dialog.showModal();
  await syncBigCoachVisibility();
}

async function closeDialog(dialog) {
  dialog.close();
  await syncBigCoachVisibility();
}

async function initialLoad() {
  const initial = await window.bigcoachApp.getState();
  Object.assign(state, initial);
  document.documentElement.style.setProperty("--panel-width", `${state.settings.panelWidth}px`);
  window.bigcoachApp.setPanelWidth(state.settings.panelWidth);
  if (state.scene) renderScene(state.scene);
  if (state.simulation) { renderResults(); renderComparison(); }
  populateSettings();
  renderHistory(initial.history);
  action("起動診断中...", () => window.bigcoachApp.diagnose()).then(renderDiagnostics).catch(() => {});
}

$("#open-review-url").addEventListener("click", () => action("解析結果を開いています...", async () => {
  const result = await window.bigcoachApp.openReviewUrl($("#review-url").value);
  renderHistory(result.history);
  if (result.stats) renderStats(result.stats);
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
  renderStats(await window.bigcoachApp.refreshStats());
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

$$("[data-nav]").forEach((button) => button.addEventListener("click", () =>
  action(`${button.textContent}へ移動中...`, async () => {
    renderScene(await window.bigcoachApp.navigate(button.dataset.nav));
    toast(`${button.textContent}へ移動しました`);
  })));

$("#run-simulation").addEventListener("click", () => action("何切るシミュレーター実行中...", async () => {
  if (!state.scene) renderScene(await window.bigcoachApp.refreshScene());
  const result = await window.bigcoachApp.runSimulation();
  state.simulation = result.simulation;
  if (state.scene) state.scene.nanikiruMistake = result.nanikiruMistake;
  renderComparison(result.comparison);
  renderNanikiruMistake(result.nanikiruMistake);
  renderResults();
  toast("シミュレーターが完了しました");
}));

function renderMajorMistakes(result) {
  state.majorMistakes = result.items;
  $("#major-mistakes-definition").textContent = `大悪手の定義: ${result.definition}`;
  $("#major-mistakes-list").innerHTML = result.items.length
    ? result.items.map((item, index) => `<button class="major-mistake" data-mismatch="${item.mismatchOrdinal}">
        <span class="round">${escapeHtml(item.roundText)}</span>
        <span>${item.turn}巡目</span>
        <span class="choice">${escapeHtml(item.actual || "—")} → ${escapeHtml(item.recommended || "—")}</span>
        <span class="metric">#${index + 1} ${escapeHtml(item.reason)}</span>
      </button>`).join("")
    : "<div class='definition'>現在の基準に該当する大悪手はありません。</div>";
  $$(".major-mistake").forEach((button) => button.addEventListener("click", () =>
    action("大悪手局面へ移動中...", async () => {
      renderScene(await window.bigcoachApp.goToMajorMistake(Number(button.dataset.mismatch)));
      toast("大悪手局面へ移動しました");
    })));
}

$("#major-mistakes-toggle").addEventListener("click", () => action("大悪手を抽出中...", async () => {
  const panel = $("#major-mistakes-panel");
  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    $("#major-mistakes-toggle").textContent = "大悪手一覧を表示";
    return;
  }
  renderMajorMistakes(await window.bigcoachApp.listMajorMistakes());
  panel.classList.remove("hidden");
  $("#major-mistakes-toggle").textContent = `大悪手一覧を隠す（${state.majorMistakes.length}件）`;
}));

$$(".tab").forEach((button) => button.addEventListener("click", () => {
  state.activeTab = button.dataset.tab;
  $$(".tab").forEach((item) => item.classList.toggle("active", item === button));
  renderResults();
}));

$("#diagnose").addEventListener("click", () => action("診断中...", async () => {
  const result = await window.bigcoachApp.diagnose();
  renderDiagnostics(result);
  toast("診断が完了しました");
}));

$("#settings-open").addEventListener("click", () => {
  populateSettings();
  openDialog($("#settings-dialog")).catch((error) => toast(error.message || String(error), true));
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
  for (const name of ["shinMistakeThreshold", "simulatorTimeoutSec"]) data[name] = Number(data[name]);
  state.settings = await action("設定を保存中...", () => window.bigcoachApp.saveSettings(data));
  await closeDialog($("#settings-dialog"));
  toast("設定を保存しました。表示言語の変更はBigCoach再読込後に反映されます。");
});

$("#preview-card").addEventListener("click", async () => {
  try {
    await action("何切る実行・カード画像作成中...", async () => {
      const preview = await window.bigcoachApp.previewCard($("#memo").value);
      state.simulation = preview.simulation;
      if (state.scene) state.scene.nanikiruMistake = preview.nanikiruMistake;
      renderComparison(preview.comparison);
      renderNanikiruMistake(preview.nanikiruMistake);
      renderResults();
      $("#front-preview").innerHTML = preview.front;
      $("#back-preview").innerHTML = preview.back;
      const nanikiruPreview = $("#nanikiru-mistake-preview");
      nanikiruPreview.classList.toggle("hidden", !preview.nanikiruMistakeCard);
      $("#nanikiru-front-preview").innerHTML = preview.nanikiruMistakeCard?.front || "";
      $("#nanikiru-back-preview").innerHTML = preview.nanikiruMistakeCard?.back || "";
      const warning = $("#duplicate-warning");
      warning.classList.toggle("hidden", !preview.duplicates.length);
      warning.textContent = preview.duplicates.length ? `同じ局面IDのカードが ${preview.duplicates.length} 件あります。登録方法を選択してください。` : "";
      // WebContentsView を非表示にすると BigCoach iframe の requestAnimationFrame も停止する。
      // 撮影と描画検証がすべて完了してから、プレビューダイアログのために非表示にする。
      $("#preview-dialog").showModal();
      await syncBigCoachVisibility();
    });
  } catch {
    await syncBigCoachVisibility();
  }
});

$("#preview-close").addEventListener("click", () => {
  closeDialog($("#preview-dialog")).catch((error) => toast(error.message || String(error), true));
});
$("#register-card").addEventListener("click", () => action("Ankiへ登録中...", async () => {
  const result = await window.bigcoachApp.registerCard({
    memo: $("#memo").value,
    duplicateMode: $("#duplicate-mode").value
  });
  await closeDialog($("#preview-dialog"));
  const extra = result.nanikiruMistake?.qualified
    ? `何切る悪手デッキ「${result.nanikiruMistake.deckName}」にのみ登録`
    : "";
  if (result.skipped) toast(extra || "重複カードのため登録をスキップしました");
  else if (result.updated) toast(extra
    ? `${extra}し、既存カードを更新しました（ID: ${result.noteId}）`
    : `既存カードを更新しました（ID: ${result.noteId}）`);
  else toast(extra
    ? `${extra}しました（ID: ${result.noteId}）`
    : `Ankiカードを登録しました（ID: ${result.noteId}）`);
}));

$("#bulk-register-nanikiru").addEventListener("click", () =>
  action("何切る悪手を抽出・登録中...", async () => {
    const result = await window.bigcoachApp.bulkRegisterNanikiru();
    const message = `候補${result.candidates}件／該当${result.qualified}件／追加${result.added}件／` +
      `重複スキップ${result.skipped}件／失敗${result.failed.length}件`;
    $("#nanikiru-bulk-status").textContent = message;
    toast(message, result.failed.length > 0);
  }));

$("#open-logs").addEventListener("click", () => window.bigcoachApp.openLogs());
$("#refresh-stats").addEventListener("click", () => action("シン悪手率を計算中...", async () => {
  renderStats(await window.bigcoachApp.refreshStats());
  toast("シン悪手率を更新しました");
}));

for (const dialog of $$("dialog")) {
  dialog.addEventListener("close", () => {
    syncBigCoachVisibility().catch((error) => toast(error.message || String(error), true));
  });
}
window.bigcoachApp.onBigCoachStatus((status) => {
  $("#browser-status").textContent = status.ok ? "BigCoach表示: 接続済み" : `BigCoach表示: ${status.message || "エラー"}`;
  $("#browser-status").className = status.ok ? "muted diagnostic-ok" : "muted diagnostic-ng";
  if (status.history) renderHistory(status.history);
});
window.bigcoachApp.onStatsUpdated((result) => renderStats(result));
window.bigcoachApp.onNanikiruBulkProgress((progress) => {
  $("#nanikiru-bulk-status").textContent = progress.complete
    ? `完了: 追加${progress.added}件／重複${progress.skipped}件／失敗${progress.failed.length}件`
    : `${progress.current} / ${progress.total}　${progress.roundText || ""} ${progress.turn || ""}巡目`;
});

window.addEventListener("resize", () => {
  const width = $("#panel").getBoundingClientRect().width;
  window.bigcoachApp.setPanelWidth(width);
});

initialLoad().catch((error) => toast(error.message || String(error), true));
