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
  throw lastError || new Error("BigCoach縺ｮ隗｣譫千ｵ先棡繧定ｪｭ縺ｿ霎ｼ繧√∪縺帙ｓ縺ｧ縺励◆");
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

function renderPreviewDecks(preview) {
  const select = $("#preview-deck");
  if (!select) return;
  const decks = preview?.decks?.length
    ? preview.decks
    : [preview?.deckName || state.settings?.deckName || "BigCoach"];
  const selected = preview?.deckName || decks[0] || "";
  select.innerHTML = decks.map((deck) =>
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
  if (scene.shinMistake?.eligible) chips.push(scene.shinMistake.isShin ? "シン悪手" : "非シン悪手");
  if (scene.majorMistake?.isMajor) chips.push("大悪手");
  if (scene.dealInRisk?.opponents?.length) chips.push("放銃危険度取得済み");
  $("#scene-chips").innerHTML = chips.map((text) =>
    `<span class="chip ${text === "大悪手" || text === "シン悪手" ? "shin" : ""}">${escapeHtml(text)}</span>`).join("");
  const missing = $("#missing-info");
  missing.classList.toggle("hidden", !scene.missing.length);
  missing.textContent = scene.missing.length
    ? `取得できなかった情報: ${scene.missing.join("、")}\nBigCoach側の表示状態またはUI変更を確認してください。`
    : "";
  $("#shin-status").textContent = `シン悪手: ${scene.shinMistake?.isShin ? "該当" : "非該当"} — ${scene.shinMistake?.reason || "評価なし"}。大悪手: ${scene.majorMistake?.isMajor ? "該当" : "非該当"} — ${scene.majorMistake?.reason || "評価なし"}`;
  renderRiskReadingStatus();
  renderResults();
}

function riskOpponent(scene, target) {
  return (scene?.dealInRisk?.opponents || []).find((item) => item.key === target) || null;
}

function renderRiskReadingStatus() {
  const element = $("#risk-reading-status");
  if (!element) return;
  const target = $("#risk-reading-target")?.value || "kamicha";
  const opponent = riskOpponent(state.scene, target);
  if (!state.scene) {
    element.textContent = "放銃危険度: 局面取得後に確認します";
    element.classList.remove("diagnostic-ng");
    return;
  }
  if (!opponent) {
    element.textContent = "謾ｾ驫・些髯ｺ蠎ｦ: 縺薙・螻髱｢縺九ｉ蜿門ｾ励〒縺阪∪縺帙ｓ";
    element.classList.add("diagnostic-ng");
    return;
  }
  const maxRate = Math.max(0, ...(opponent.rates || []).map((item) => Number(item.rate || 0)));
  element.textContent = `謾ｾ驫・些髯ｺ蠎ｦ: ${opponent.label} 34迚悟叙蠕玲ｸ医∩ / 譛螟ｧ ${(maxRate * 100).toFixed(2)}%`;
  element.classList.remove("diagnostic-ng");
}

function renderComparison(comparison) {
  if (!comparison) {
    $("#comparison").innerHTML = "";
    return;
  }
  $("#comparison").innerHTML = [
    ["螳滓遠", comparison.actual],
    ["BigCoach", comparison.bigCoach],
    ["繧ｷ繝溘Η繝ｬ繝ｼ繧ｿ繝ｼ", comparison.simulator]
  ].map(([label, value]) => `<div class="comparison-item"><span>${label}</span><strong>${escapeHtml(value || "—")}</strong></div>`).join("");
  const items = $$(".comparison-item");
  if (comparison.bigCoach && comparison.simulator) {
    items[1].classList.add(comparison.bigCoachMatchesSimulator ? "match" : "mismatch");
    items[2].classList.add(comparison.bigCoachMatchesSimulator ? "match" : "mismatch");
  }
}

function analysisTable(analysis) {
  if (!analysis?.candidates?.length) return "<div class='empty'>蛟呵｣懊↑縺・/div>";
  return `<table><thead><tr><th>謇鍋煙</th><th>譛溷ｾ・､</th><th>蜥御ｺ・/th><th>閨ｴ迚・/th><th>蜿怜・</th></tr></thead><tbody>${
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
  if (!scene?.candidates?.length) return "<div class='empty'>BigCoach蛟呵｣懆ｩ穂ｾ｡繧貞叙蠕励〒縺阪∪縺帙ｓ縺ｧ縺励◆縲・/div>";
  return `<table><thead><tr><th>謇鍋煙</th><th>隧穂ｾ｡</th><th>陦ｨ遉ｺ蜀・ｮｹ</th></tr></thead><tbody>${
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
  select.innerHTML = `<option value="">螻･豁ｴ繧帝∈謚・/option>${state.history.map((item) =>
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
    return Number.isNaN(date.getTime()) ? "荳肴・" : `${date.getMonth() + 1}/${date.getDate()}`;
  };
  const yTicks = [0, ceiling / 2, ceiling];
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="繧ｷ繝ｳ謔ｪ謇狗紫縺ｮ謗ｨ遘ｻ">
    ${yTicks.map((rate) => `
      <line class="trend-grid" x1="${margin.left}" y1="${y(rate)}" x2="${width - margin.right}" y2="${y(rate)}"></line>
      <text class="trend-axis-label" x="${margin.left - 5}" y="${y(rate) + 4}" text-anchor="end">${(rate * 100).toFixed(0)}%</text>
    `).join("")}
    <path class="trend-line cumulative" d="${path((item) => item.cumulative.rate)}"></path>
    <path class="trend-line current" d="${path((item) => item.current.rate)}"></path>
    ${points.map((item, index) => `
      <circle class="trend-point cumulative" cx="${x(index)}" cy="${y(item.cumulative.rate)}" r="3">
        <title>${dateLabel(item.recordedAt)} 騾夂ｮ・${percent(item.cumulative.rate)} (${item.cumulative.count}/${item.cumulative.denominator})</title>
      </circle>
      <circle class="trend-point current" cx="${x(index)}" cy="${y(item.current.rate)}" r="3.5">
        <title>${dateLabel(item.recordedAt)} 蜷・ｧ｣譫・${percent(item.current.rate)} (${item.current.count}/${item.current.denominator}) ${item.rounds}螻</title>
      </circle>
    `).join("")}
    ${labelIndexes.map((index) => `<text class="trend-axis-label" x="${x(index)}" y="${height - 8}" text-anchor="middle">${dateLabel(points[index].recordedAt)}</text>`).join("")}
  </svg>
  <div class="trend-latest">譛譁ｰ: 蜷・ｧ｣譫・${percent(points.at(-1).current.rate)} ・・騾夂ｮ・${percent(points.at(-1).cumulative.rate)}縲蜈ｨ${trend.length}隗｣譫・/div>`;
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
  $("#risk-reading-note").value = state.settings.riskReadingNote || "";
  renderHistory(initial.history);
  action("襍ｷ蜍戊ｨｺ譁ｭ荳ｭ...", () => window.bigcoachApp.diagnose()).then(renderDiagnostics).catch(() => {});
}

$("#open-review-url").addEventListener("click", () => action("隗｣譫千ｵ先棡繧帝幕縺・※縺・∪縺・..", async () => {
  const result = await window.bigcoachApp.openReviewUrl($("#review-url").value);
  renderHistory(result.history);
  if (result.stats) renderStats(result.stats);
  renderScene(await waitForSceneReady());
  toast("隗｣譫千ｵ先棡URL繧帝幕縺阪∪縺励◆");
}));

$("#review-history").addEventListener("change", (event) => {
  if (!event.target.value) return;
  $("#review-url").value = event.target.value;
  $("#open-review-url").click();
});

$("#refresh-scene").addEventListener("click", () => action("螻髱｢繧貞叙蠕嶺ｸｭ...", async () => {
  renderScene(await window.bigcoachApp.refreshScene());
  renderStats(await window.bigcoachApp.refreshStats());
  toast("螻髱｢繧貞叙蠕励＠縺ｾ縺励◆");
}));

$("#copy-hand-mpsz").addEventListener("click", async () => {
  const handMpsz = state.scene?.handMpsz;
  if (!handMpsz) {
    toast("謇狗煙mpsz繧貞叙蠕励〒縺阪ｋ螻髱｢繧貞・縺ｫ隱ｭ縺ｿ霎ｼ繧薙〒縺上□縺輔＞", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(handMpsz);
    toast(`謇狗煙mpsz繧偵さ繝斐・縺励∪縺励◆: ${handMpsz}`);
  } catch (error) {
    toast(error.message || "繧ｯ繝ｪ繝・・繝懊・繝峨∈繧ｳ繝斐・縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆", true);
  }
});

$$("[data-nav]").forEach((button) => button.addEventListener("click", () =>
  action(`${button.textContent}縺ｸ遘ｻ蜍穂ｸｭ...`, async () => {
    renderScene(await window.bigcoachApp.navigate(button.dataset.nav));
    toast(`${button.textContent}縺ｸ遘ｻ蜍輔＠縺ｾ縺励◆`);
  })));

$("#run-simulation").addEventListener("click", () => action("菴募・繧九す繝溘Η繝ｬ繝ｼ繧ｿ繝ｼ螳溯｡御ｸｭ...", async () => {
  if (!state.scene) renderScene(await window.bigcoachApp.refreshScene());
  const result = await window.bigcoachApp.runSimulation();
  if (result.scene) renderScene(result.scene);
  state.simulation = result.simulation;
  renderComparison(result.comparison);
  renderResults();
  toast("繧ｷ繝溘Η繝ｬ繝ｼ繧ｿ繝ｼ縺悟ｮ御ｺ・＠縺ｾ縺励◆");
}));

function renderMajorMistakes(result) {
  state.majorMistakes = result.items;
  $("#major-mistakes-definition").textContent = `螟ｧ謔ｪ謇九・螳夂ｾｩ: ${result.definition}`;
  $("#major-mistakes-list").innerHTML = result.items.length
    ? result.items.map((item, index) => `<button class="major-mistake" data-mismatch="${item.mismatchOrdinal}">
        <span class="round">${escapeHtml(item.roundText)}</span>
        <span>${item.turn}蟾｡逶ｮ</span>
        <span class="choice">${escapeHtml(item.actual || "—")} → ${escapeHtml(item.recommended || "—")}</span>
        <span class="metric">#${index + 1} ${escapeHtml(item.reason)}</span>
      </button>`).join("")
    : "<div class='definition'>迴ｾ蝨ｨ縺ｮ蝓ｺ貅悶↓隧ｲ蠖薙☆繧句､ｧ謔ｪ謇九・縺ゅｊ縺ｾ縺帙ｓ縲・/div>";
  $$(".major-mistake").forEach((button) => button.addEventListener("click", () =>
    action("螟ｧ謔ｪ謇句ｱ髱｢縺ｸ遘ｻ蜍穂ｸｭ...", async () => {
      renderScene(await window.bigcoachApp.goToMajorMistake(Number(button.dataset.mismatch)));
      toast("螟ｧ謔ｪ謇句ｱ髱｢縺ｸ遘ｻ蜍輔＠縺ｾ縺励◆");
    })));
}

$("#major-mistakes-toggle").addEventListener("click", () => action("螟ｧ謔ｪ謇九ｒ謚ｽ蜃ｺ荳ｭ...", async () => {
  const panel = $("#major-mistakes-panel");
  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    $("#major-mistakes-toggle").textContent = "螟ｧ謔ｪ謇倶ｸ隕ｧ繧定｡ｨ遉ｺ";
    return;
  }
  renderMajorMistakes(await window.bigcoachApp.listMajorMistakes());
  panel.classList.remove("hidden");
  $("#major-mistakes-toggle").textContent = `大悪手一覧を閉じる（${state.majorMistakes.length}件）`;
}));

$$(".tab").forEach((button) => button.addEventListener("click", () => {
  state.activeTab = button.dataset.tab;
  $$(".tab").forEach((item) => item.classList.toggle("active", item === button));
  renderResults();
}));

$("#diagnose").addEventListener("click", () => action("險ｺ譁ｭ荳ｭ...", async () => {
  const result = await window.bigcoachApp.diagnose();
  renderDiagnostics(result);
  toast("險ｺ譁ｭ縺悟ｮ御ｺ・＠縺ｾ縺励◆");
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
  for (const name of ["shinMistakeThreshold", "simulatorTimeoutSec", "riskReadingDeviationThreshold"]) data[name] = Number(data[name]);
  state.settings = await action("險ｭ螳壹ｒ菫晏ｭ倅ｸｭ...", () => window.bigcoachApp.saveSettings(data));
  $("#risk-reading-note").value = state.settings.riskReadingNote || "";
  await closeDialog($("#settings-dialog"));
  toast("設定を保存しました。表示言語の変更はBigCoach再読み込み後に反映されます。");
});

$("#preview-card").addEventListener("click", async () => {
  try {
    await action("何切る実行とカード画像作成中...", async () => {
      const preview = await window.bigcoachApp.previewCard($("#memo").value);
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
        ? "同じ局面IDのカードが " + preview.duplicates.length + " 件あります。登録方法を選択してください。"
        : "";
      // WebContentsView 繧帝撼陦ｨ遉ｺ縺ｫ縺吶ｋ縺ｨ BigCoach iframe 縺ｮ requestAnimationFrame 繧ょ●豁｢縺吶ｋ縲・
      // 謦ｮ蠖ｱ縺ｨ謠冗判讀懆ｨｼ縺後☆縺ｹ縺ｦ螳御ｺ・＠縺ｦ縺九ｉ縲√・繝ｬ繝薙Η繝ｼ繝繧､繧｢繝ｭ繧ｰ縺ｮ縺溘ａ縺ｫ髱櫁｡ｨ遉ｺ縺ｫ縺吶ｋ縲・
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
$("#register-card").addEventListener("click", () => action("Ankiへ登録中...", async () => {
  const dialog = $("#preview-dialog");
  if (dialog.dataset.mode === "risk-reading") {
    const result = await window.bigcoachApp.registerRiskReadingCard({
      target: $("#risk-reading-target").value,
      memo: $("#risk-reading-note").value,
      deckName: $("#preview-deck").value,
      duplicateMode: $("#duplicate-mode").value
    });
    dialog.dataset.mode = "";
    await closeDialog(dialog);
    toast(result.skipped
      ? "危険度読みカードは重複のためスキップしました（" + result.opponent.label + " / " + result.deckName + "）"
      : "危険度読みカードを登録しました（" + result.opponent.label + " / " + result.deckName + " / ID: " + result.noteId + "）");
    return;
  }
  const result = await window.bigcoachApp.registerCard({
    memo: $("#memo").value,
    deckName: $("#preview-deck").value,
    duplicateMode: $("#duplicate-mode").value
  });
  dialog.dataset.mode = "";
  await closeDialog(dialog);
  if (result.skipped) toast("重複カードのため登録をスキップしました");
  else if (result.updated) toast("既存カードを更新しました（ID: " + result.noteId + "）");
  else toast("Ankiカードを登録しました（ID: " + result.noteId + "）");
}));

$("#risk-reading-target").addEventListener("change", renderRiskReadingStatus);

$("#register-risk-reading").addEventListener("click", () =>
  action("危険度読みカードをプレビュー作成中...", async () => {
    if (!state.scene) renderScene(await window.bigcoachApp.refreshScene());
    const preview = await window.bigcoachApp.previewRiskReadingCard({
      target: $("#risk-reading-target").value,
      memo: $("#risk-reading-note").value
    });
    if (preview.scene) renderScene(preview.scene);
    renderPreviewDecks(preview);
    $("#front-preview").innerHTML = preview.front;
    $("#back-preview").innerHTML = preview.back;
    const warning = $("#duplicate-warning");
    warning.classList.toggle("hidden", !preview.duplicates.length);
    warning.textContent = preview.duplicates.length
      ? "同じ危険度読みカードが " + preview.duplicates.length + " 件あります。登録方法を選択してください。"
      : "";
    const dialog = $("#preview-dialog");
    dialog.dataset.mode = "risk-reading";
    dialog.showModal();
    await syncBigCoachVisibility();
  }));

$("#open-logs").addEventListener("click", () => window.bigcoachApp.openLogs());
$("#refresh-stats").addEventListener("click", () => action("シン悪手率を再計算中...", async () => {
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

window.addEventListener("resize", () => {
  const width = $("#panel").getBoundingClientRect().width;
  window.bigcoachApp.setPanelWidth(width);
});

initialLoad().catch((error) => toast(error.message || String(error), true));
