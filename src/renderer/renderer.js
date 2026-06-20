"use strict";

const state = { settings: null, scene: null, simulation: null, activeTab: "wall" };
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

function tile(code) {
  return code ? `<span class="tile">${escapeHtml(code)}</span>` : "—";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderScene(scene) {
  state.scene = scene;
  $("#scene-title").textContent = `${scene.roundText || "局情報不明"} / ${scene.currentTurn || "?"}巡目 / ${scene.actorText || "手番不明"}`;
  const chips = [
    `手牌 ${scene.handMpsz || "取得なし"}`,
    `ドラ ${scene.doraTiles.join(" ") || "取得なし"}`,
    `実打 ${scene.actualDiscard || "取得なし"}`,
    `推奨 ${scene.recommendedDiscard || "取得なし"}`
  ];
  if (scene.shinMistake?.enabled) chips.push(scene.shinMistake.isShin ? "シン悪手" : "非シン悪手");
  $("#scene-chips").innerHTML = chips.map((text, index) =>
    `<span class="chip ${index === chips.length - 1 && scene.shinMistake?.isShin ? "shin" : ""}">${escapeHtml(text)}</span>`).join("");
  const missing = $("#missing-info");
  missing.classList.toggle("hidden", !scene.missing.length);
  missing.textContent = scene.missing.length
    ? `取得できなかった情報: ${scene.missing.join("、")}\nBigCoach側の表示状態またはUI変更を確認してください。`
    : "";
  $("#shin-status").textContent = `シン悪手: ${scene.shinMistake?.enabled ?
    `${scene.shinMistake.isShin ? "該当" : "非該当"} — ${scene.shinMistake.reason}` :
    `判定不可 — ${scene.shinMistake?.reason || "評価なし"}`}。定義: BigCoach推奨と実打の評価差が設定基準以上。`;
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
      <td title="${escapeHtml(candidate.ukeire.map((item) => `${item.tile}×${item.count}`).join(" "))}">${candidate.ukeireTotal}</td>
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

async function initialLoad() {
  const initial = await window.bigcoachApp.getState();
  Object.assign(state, initial);
  document.documentElement.style.setProperty("--panel-width", `${state.settings.panelWidth}px`);
  window.bigcoachApp.setPanelWidth(state.settings.panelWidth);
  if (state.scene) renderScene(state.scene);
  if (state.simulation) { renderResults(); renderComparison(); }
  populateSettings();
  action("起動診断中...", () => window.bigcoachApp.diagnose()).then(renderDiagnostics).catch(() => {});
}

$("#refresh-scene").addEventListener("click", () => action("局面を取得中...", async () => {
  renderScene(await window.bigcoachApp.refreshScene());
  toast("局面を取得しました");
}));

$$("[data-nav]").forEach((button) => button.addEventListener("click", () =>
  action(`${button.textContent}へ移動中...`, async () => {
    renderScene(await window.bigcoachApp.navigate(button.dataset.nav));
    toast(`${button.textContent}へ移動しました`);
  })));

$("#run-simulation").addEventListener("click", () => action("何切るシミュレーター実行中...", async () => {
  if (!state.scene) renderScene(await window.bigcoachApp.refreshScene());
  const result = await window.bigcoachApp.runSimulation();
  state.simulation = result.simulation;
  renderComparison(result.comparison);
  renderResults();
  toast("シミュレーターが完了しました");
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
  $("#settings-dialog").showModal();
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
  for (const name of ["shinMistakeThreshold", "shinSearchLimit", "simulatorTimeoutSec"]) data[name] = Number(data[name]);
  state.settings = await action("設定を保存中...", () => window.bigcoachApp.saveSettings(data));
  $("#settings-dialog").close();
  toast("設定を保存しました。表示言語の変更はBigCoach再読込後に反映されます。");
});

$("#preview-card").addEventListener("click", () => action("カードを作成中...", async () => {
  const preview = await window.bigcoachApp.previewCard($("#memo").value);
  $("#front-preview").innerHTML = preview.front;
  $("#back-preview").innerHTML = preview.back;
  const warning = $("#duplicate-warning");
  warning.classList.toggle("hidden", !preview.duplicates.length);
  warning.textContent = preview.duplicates.length ? `同じ局面IDのカードが ${preview.duplicates.length} 件あります。登録方法を選択してください。` : "";
  $("#preview-dialog").showModal();
}));

$("#preview-close").addEventListener("click", () => $("#preview-dialog").close());
$("#register-card").addEventListener("click", () => action("Ankiへ登録中...", async () => {
  const result = await window.bigcoachApp.registerCard({
    memo: $("#memo").value,
    duplicateMode: $("#duplicate-mode").value
  });
  $("#preview-dialog").close();
  if (result.skipped) toast("重複カードのため登録をスキップしました");
  else if (result.updated) toast(`既存カードを更新しました（ID: ${result.noteId}）`);
  else toast(`Ankiカードを登録しました（ID: ${result.noteId}）`);
}));

$("#open-logs").addEventListener("click", () => window.bigcoachApp.openLogs());
window.bigcoachApp.onBigCoachStatus((status) => {
  $("#browser-status").textContent = status.ok ? "BigCoach表示: 接続済み" : `BigCoach表示: ${status.message || "エラー"}`;
  $("#browser-status").className = status.ok ? "muted diagnostic-ok" : "muted diagnostic-ng";
});

window.addEventListener("resize", () => {
  const width = $("#panel").getBoundingClientRect().width;
  window.bigcoachApp.setPanelWidth(width);
});

initialLoad().catch((error) => toast(error.message || String(error), true));
