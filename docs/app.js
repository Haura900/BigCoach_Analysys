(function () {
  "use strict";

  const STORAGE_KEY = "bigcoach-luck-analyzer:v1";
  const analyzer = window.LuckAnalyzer;
  let records = loadRecords();
  let selectedId = null;
  let scope = "all";

  const elements = {
    tabs: [...document.querySelectorAll(".tab")],
    panels: [...document.querySelectorAll(".tab-panel")],
    url: document.querySelector("#review-url"),
    fetch: document.querySelector("#fetch-button"),
    paste: document.querySelector("#paste-input"),
    pasteButton: document.querySelector("#paste-button"),
    file: document.querySelector("#file-input"),
    status: document.querySelector("#import-status"),
    bookmarklet: document.querySelector("#bookmarklet"),
    historyBookmarklet: document.querySelector("#history-bookmarklet"),
    demo: document.querySelector("#demo-button"),
    empty: document.querySelector("#empty-state"),
    metrics: document.querySelector("#metrics"),
    history: document.querySelector("#history-list"),
    export: document.querySelector("#export-button"),
    scopeSwitch: document.querySelector("#scope-switch"),
    scopeButtons: [...document.querySelectorAll("#scope-switch button")]
  };

  const DEMO_DATA = {
    engine: "Mortal",
    game_length: "Hanchan",
    player_id: 0,
    review: {
      kyokus: [
        demoRound(0, 0.31, 0.07, false, false, 3900, 0),
        demoRound(1, 0.19, 0.12, true, true, 7600, 12000),
        demoRound(2, 0.43, 0.04, false, false, 5200, 0),
        demoRound(3, 0.27, 0.09, true, false, 8000, 0)
      ]
    }
  };

  function demoRound(kyoku, winP, riskP, riichi, win, expectedPoints, actualPoints) {
    const entries = [{
      junme: 1,
      actual: { type: "dahai", actor: 0, pai: "1z" },
      sl_outcome: [winP * 0.65, winP * 0.35, (1 - winP) * 0.34, (1 - winP) * 0.33, (1 - winP) * 0.33],
      details: [{ action: { type: "dahai", actor: 0, pai: "1z" }, houjuu_rate: riskP, expected_win_points: expectedPoints }]
    }];
    if (riichi) {
      entries.push({
        junme: 9,
        actual: { type: "reach", actor: 0 },
        sl_outcome: [winP * 0.65, winP * 0.35, (1 - winP) * 0.34, (1 - winP) * 0.33, (1 - winP) * 0.33],
        details: [{ action: { type: "reach", actor: 0 }, prob: 0.9 }]
      });
      entries.push({
        junme: 9,
        at_self_riichi: true,
        actual: { type: "dahai", actor: 0, pai: "5p" },
        sl_outcome: [winP * 0.65, winP * 0.35, (1 - winP) * 0.34, (1 - winP) * 0.33, (1 - winP) * 0.33],
        details: [{ action: { type: "dahai", actor: 0, pai: "5p" }, houjuu_rate: riskP, expected_win_points: expectedPoints }]
      });
    }
    return {
      kyoku,
      honba: 0,
      entries,
      end_status: win ? [{ type: "hora", actor: 0, target: 2, deltas: [actualPoints, 0, -actualPoints, 0], ura_markers: ["3p"] }] : [{ type: "ryukyoku", deltas: [0, 0, 0, 0] }]
    };
  }

  function loadRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item?.schemaVersion === analyzer.VERSION) : [];
    } catch {
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function setStatus(message, type = "") {
    elements.status.className = `status${type ? ` is-${type}` : ""}`;
    elements.status.textContent = message;
  }

  function switchTab(name) {
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    elements.panels.forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
  }

  function addPayload(payload, meta = {}) {
    const record = analyzer.analyzePayload(payload, meta);
    const existing = records.findIndex((item) =>
      (record.gameId && item.gameId === record.gameId) || item.id === record.id
    );
    if (existing >= 0) {
      selectedId = records[existing].id;
      scope = "selected";
      setStatus("同じ対局はすでに保存済みのため、重複登録を除外しました。", "success");
    } else {
      records.unshift(record);
      selectedId = record.id;
      scope = "selected";
      setStatus(`${record.rounds.length}局を解析し、この端末に保存しました。`, "success");
    }
    saveRecords();
    render();
    document.querySelector("#dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addBundle(bundle) {
    const incoming = Array.isArray(bundle?.items) ? bundle.items : [];
    if (!incoming.length) throw new Error("一括取得ファイルに解析可能な牌譜がありません。");
    const added = [];
    let duplicates = 0;
    let failed = 0;
    for (const item of incoming) {
      try {
        const record = analyzer.analyzePayload(item.data || item, {
          sourceUrl: item.sourceUrl || "",
          title: item.title || (item.taskId ? `BigCoach ${String(item.taskId).slice(0, 8)}` : "BigCoach解析")
        });
        const exists = [...records, ...added].some((saved) =>
          (record.gameId && saved.gameId === record.gameId) || saved.id === record.id
        );
        if (exists) duplicates += 1;
        else added.push(record);
      } catch {
        failed += 1;
      }
    }
    records.unshift(...added);
    selectedId = null;
    scope = "all";
    saveRecords();
    render();
    const remoteFailures = Number(bundle?.failures?.length || 0);
    setStatus(`一括取込: ${added.length}対局を追加、${duplicates}件の重複を除外、${failed + remoteFailures}件を取得・解析できませんでした。`, added.length ? "success" : "error");
    document.querySelector("#dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function parseReviewUrl(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("有効なレビューURLを入力してください。");
    }
    if (url.protocol !== "https:" || !["gokujan.com", "review.bigcoach.work"].includes(url.hostname)) {
      throw new Error("gokujan.com または review.bigcoach.work のHTTPS URLを入力してください。");
    }
    const match = url.pathname.match(/\/review\/([^/?#]+)/);
    if (!match) throw new Error("/review/ を含むBigCoachレビューURLではありません。");
    return { url, taskId: match[1] };
  }

  async function fetchFromReviewUrl(raw) {
    const { url, taskId } = parseReviewUrl(raw);
    const base = `${url.protocol}//${url.host}`;
    const resultResponse = await fetch(`${base}/api/v2/tasks/${encodeURIComponent(taskId)}/result`, { credentials: "omit" });
    if (!resultResponse.ok) throw new Error(`BigCoachが取得要求を拒否しました（HTTP ${resultResponse.status}）。`);
    const result = await resultResponse.json();
    if (!result?.success || !result?.data?.jsonUrl) throw new Error(result?.message || "解析JSONの場所を取得できませんでした。");
    const dataUrl = new URL(result.data.jsonUrl, base).href;
    const dataResponse = await fetch(dataUrl, { credentials: "omit" });
    if (!dataResponse.ok) throw new Error(`解析JSONを取得できませんでした（HTTP ${dataResponse.status}）。`);
    return dataResponse.json();
  }

  async function handleDirectFetch() {
    elements.fetch.disabled = true;
    setStatus("BigCoachからの直接取得を試しています…", "loading");
    try {
      const raw = elements.url.value.trim();
      const data = await fetchFromReviewUrl(raw);
      addPayload(data, { sourceUrl: raw, title: reviewTitle(raw) });
    } catch (error) {
      const reason = error instanceof TypeError
        ? "BigCoachへの直接接続がブラウザに拒否されました。"
        : error.message;
      setStatus(`${reason} 静的サイトではCORS制限があるため、ブックマークレットまたはJSON貼り付けをお使いください。`, "error");
      switchTab("paste");
    } finally {
      elements.fetch.disabled = false;
    }
  }

  function reviewTitle(url) {
    try {
      const taskId = new URL(url).pathname.match(/\/review\/([^/?#]+)/)?.[1];
      return taskId ? `BigCoach ${taskId.slice(0, 8)}` : "BigCoach解析";
    } catch {
      return "BigCoach解析";
    }
  }

  async function handleText(text, meta = {}) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("内容が空です。");
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      if (parsed?.kind === "bigcoach-luck-bundle") addBundle(parsed);
      else addPayload(parsed, meta);
      return;
    }
    const extracted = analyzer.extractEmbeddedJson(trimmed);
    if (!extracted) throw new Error("HTML内に解析JSONを見つけられませんでした。ブックマークレットでJSONをコピーしてください。");
    if (extracted.dataUrl) {
      throw new Error("HTMLにはJSONのURLだけがありました。CORS制限を避けるため、ブックマークレットを実行してください。");
    }
    addPayload(extracted, meta);
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
  }

  function signed(value, digits = 2) {
    if (!Number.isFinite(Number(value))) return "—";
    const numeric = Number(value);
    return `${numeric >= 0 ? "+" : "−"}${Math.abs(numeric).toFixed(digits)}`;
  }

  function scoreLabel(z, negativeIsGood = false) {
    if (z == null) return "データ不足";
    const adjusted = negativeIsGood ? -z : z;
    if (adjusted >= 2) return "かなり上振れ";
    if (adjusted >= 1) return "やや上振れ";
    if (adjusted <= -2) return "かなり下振れ";
    if (adjusted <= -1) return "やや下振れ";
    return "おおむね想定内";
  }

  function setSigma(prefix, result) {
    document.querySelector(`#${prefix}-z`).textContent = result.z == null ? "—" : signed(result.z, 2).replace("+", "+").replace("−", "−");
    document.querySelector(`#${prefix}-detail`).textContent = result.n
      ? `${scoreLabel(result.z)} · 実績 ${formatNumber(result.observed, 0)} / 期待 ${formatNumber(result.expected, 2)}（n=${result.n}）`
      : "評価できる予測確率がありません";
    const position = result.z == null ? 50 : Math.max(4, Math.min(96, 50 + result.z * 13));
    document.querySelector(`#${prefix}-marker`).style.left = `${position}%`;
  }

  function renderMetrics(summary) {
    const overall = summary.overall;
    document.querySelector("#overall-score").textContent = overall.score == null ? "—" : formatNumber(overall.score, 0);
    document.querySelector("#overall-label").textContent = overall.score == null
      ? "評価できる指標を蓄積中"
      : overall.score >= 90 ? "かなり運が良い"
        : overall.score >= 70 ? "やや運が良い"
          : overall.score <= 10 ? "かなり運が悪い"
            : overall.score <= 30 ? "やや運が悪い" : "おおむね標準的";
    document.querySelector("#overall-detail").textContent = overall.z == null
      ? "総合運に入れられる指標がまだありません。"
      : `${overall.included.length}/${overall.totalComponents}指標を合成 · ${signed(overall.z, 2)}σ相当。プラスほど幸運です。`;
    const overallComponents = document.querySelector("#overall-components");
    overallComponents.replaceChildren(
      ...overall.included.map((component) => overallChip(`${component.label} ${signed(component.z, 2)}σ`, false)),
      ...overall.excluded.map((component) => overallChip(`${component.label}: ${component.reason}`, true))
    );
    document.querySelector("#deal-percentile").textContent = summary.deal.percentile == null ? "—" : formatNumber(summary.deal.percentile, 0);
    document.querySelector("#deal-meter").style.width = `${summary.deal.percentile || 0}%`;
    document.querySelector("#deal-detail").textContent = summary.deal.n
      ? `平均和了確率 ${formatNumber(summary.deal.mean * 100, 1)}% · ${signed(summary.deal.z, 2)}σ相当（${summary.deal.n}局 / 分布${summary.deal.poolN}局）${summary.deal.poolN < overall.dealMinimum ? ` · 総合運への算入は${overall.dealMinimum}局から` : ""}`
      : "初回予測確率を取得できませんでした";
    setSigma("riichi", summary.riichi);
    setSigma("dealin", { ...summary.dealIn, z: summary.dealIn.luckZ });

    document.querySelector("#points-diff").textContent = summary.points.n ? signed(Math.round(summary.points.diff), 0) : "—";
    document.querySelector("#points-support").textContent = summary.points.n ? "期待差" : "未対応";
    document.querySelector("#points-detail").textContent = summary.points.n
      ? `実績 ${Math.round(summary.points.actual).toLocaleString("ja-JP")}点 / 期待 ${Math.round(summary.points.expected).toLocaleString("ja-JP")}点（${summary.points.n}和了）`
      : summary.points.wins ? `和了${summary.points.wins}回。期待打点がJSONになく差分評価は未対応です。` : "和了データがまだありません";
    const features = document.querySelector("#feature-support");
    features.replaceChildren(
      supportChip("期待打点", summary.points.n > 0),
      supportChip(summary.points.uraSupported ? `裏ドラ ${summary.points.uraCount}枚` : "裏ドラ実枚数", summary.points.uraSupported),
      supportChip(summary.points.ippatsuSupported ? `一発 ${summary.points.ippatsuCount}回` : "一発", summary.points.ippatsuSupported)
    );
  }

  function overallChip(label, excluded) {
    const span = document.createElement("span");
    span.className = excluded ? "excluded" : "";
    span.textContent = label;
    return span;
  }

  function supportChip(label, supported) {
    const span = document.createElement("span");
    span.className = supported ? "supported" : "unsupported";
    span.textContent = `${label} ${supported ? "対応" : "未対応"}`;
    return span;
  }

  function renderHistory() {
    elements.history.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "取り込んだ牌譜は、ここに新しい順で保存されます。";
      elements.history.append(empty);
      return;
    }
    records.forEach((record) => {
      const fragment = document.querySelector("#history-template").content.cloneNode(true);
      const item = fragment.querySelector(".history-item");
      item.classList.toggle("is-selected", record.id === selectedId);
      fragment.querySelector(".history-date").textContent = new Date(record.importedAt).toLocaleDateString("ja-JP");
      fragment.querySelector(".history-title").textContent = record.title;
      const summary = analyzer.summarize(records, record.id);
      fragment.querySelector(".history-meta").textContent = `${summary.rounds}局 · 配牌 ${formatNumber(summary.deal.percentile, 0)} percentile · リーチ ${summary.riichi.z == null ? "—" : signed(summary.riichi.z)}σ`;
      fragment.querySelector(".history-main").addEventListener("click", () => {
        selectedId = record.id;
        scope = "selected";
        render();
        document.querySelector("#dashboard").scrollIntoView({ behavior: "smooth" });
      });
      fragment.querySelector(".delete-button").addEventListener("click", () => {
        if (!window.confirm(`「${record.title}」を端末から削除しますか？`)) return;
        records = records.filter((item) => item.id !== record.id);
        if (selectedId === record.id) selectedId = null;
        if (!selectedId) scope = "all";
        saveRecords();
        render();
      });
      elements.history.append(item);
    });
  }

  function render() {
    const allSummary = analyzer.summarize(records);
    const selectedExists = records.some((record) => record.id === selectedId);
    if (!selectedExists) selectedId = null;
    if (!selectedId) scope = "all";
    const summary = analyzer.summarize(records, scope === "selected" ? selectedId : null);
    document.querySelector("#hero-records").textContent = records.length;
    document.querySelector("#hero-rounds").textContent = allSummary.rounds;
    document.querySelector("#hero-pool").textContent = allSummary.deal.poolN;
    elements.empty.hidden = records.length > 0;
    elements.metrics.hidden = records.length === 0;
    elements.export.disabled = records.length === 0;
    elements.scopeSwitch.hidden = !selectedId;
    elements.scopeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.scope === scope));
    document.querySelector("#dashboard-title").textContent = scope === "selected"
      ? records.find((record) => record.id === selectedId)?.title || "牌譜サマリー"
      : "蓄積サマリー";
    if (records.length) renderMetrics(summary);
    renderHistory();
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bigcoach-luck-history-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function buildBookmarklet() {
    const code = `(async()=>{try{const m=location.pathname.match(/\\/review\\/([^/?#]+)/);if(!m)throw Error('BigCoachのレビュー画面で実行してください');const r=await fetch('/api/v2/tasks/'+encodeURIComponent(m[1])+'/result',{credentials:'include'}).then(x=>x.json());if(!r?.success||!r?.data?.jsonUrl)throw Error(r?.message||'JSON URLを取得できません');const d=await fetch(r.data.jsonUrl,{credentials:'include'}).then(x=>x.json());const t=JSON.stringify(d);try{await navigator.clipboard.writeText(t);alert('Luck Analyzer用JSONをコピーしました。解析サイトのJSON / HTML欄へ貼り付けてください。')}catch{const b=new Blob([t],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='bigcoach-'+m[1]+'.json';a.click();alert('JSONをダウンロードしました。解析サイトのファイル欄から選択してください。')}}catch(e){alert('取得できませんでした: '+e.message)}})()`;
    elements.bookmarklet.href = `javascript:${encodeURIComponent(code)}`;
    elements.bookmarklet.addEventListener("click", (event) => {
      if (location.protocol.startsWith("http")) {
        event.preventDefault();
        setStatus("このボタンはクリックではなく、ブックマークバーへドラッグして登録してください。", "loading");
      }
    });

    const historyCode = `(async()=>{let box;try{if(!location.pathname.startsWith('/account/history'))throw Error('BigCoachの履歴画面で実行してください');box=document.createElement('div');Object.assign(box.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:2147483647,padding:'14px 18px',borderRadius:'10px',background:'#10201c',color:'#fff',font:'13px sans-serif',boxShadow:'0 8px 30px #0006'});box.textContent='Luck履歴: 一覧を取得中…';document.body.append(box);let rows=[],offset=0,total=1;while(offset<total){const res=await fetch('/api/v2/membership/history?limit=100&offset='+offset+'&category=real',{credentials:'include'});if(!res.ok)throw Error('履歴API HTTP '+res.status);const raw=await res.json(),page=raw?.success===false?null:(raw?.data||raw);if(!page)throw Error(raw?.error?.message||'履歴を取得できません');const batch=Array.isArray(page.items)?page.items:[];rows.push(...batch);total=Number(page.total??rows.length);if(!batch.length)break;offset+=batch.length;box.textContent='Luck履歴: 一覧 '+Math.min(offset,total)+' / '+total;}const unique=[...new Map(rows.filter(x=>x?.taskId&&x.reviewKind!=='what_cut').map(x=>[x.taskId,x])).values()],items=[],failures=[];for(let i=0;i<unique.length;i+=3){box.textContent='Luck履歴: 解析JSON '+Math.min(i+1,unique.length)+' / '+unique.length;const group=await Promise.all(unique.slice(i,i+3).map(async row=>{try{const response=await fetch('/api/v2/tasks/'+encodeURIComponent(row.taskId)+'/result',{credentials:'include'});if(!response.ok)throw Error('HTTP '+response.status);const result=await response.json();if(!result?.success||!result?.data?.jsonUrl)throw Error(result?.message||'JSON URLなし');const dataResponse=await fetch(result.data.jsonUrl,{credentials:'include'});if(!dataResponse.ok)throw Error('JSON HTTP '+dataResponse.status);const data=await dataResponse.json();return{taskId:row.taskId,sourceUrl:location.origin+'/review/'+row.taskId,title:[row.playerName,row.lastSubmittedAt?new Date(row.lastSubmittedAt).toLocaleDateString('ja-JP'):null].filter(Boolean).join(' · ')||'BigCoach '+row.taskId.slice(0,8),data};}catch(e){failures.push({taskId:row.taskId,error:e.message});return null;}}));items.push(...group.filter(Boolean));}const bundle={kind:'bigcoach-luck-bundle',version:1,exportedAt:new Date().toISOString(),source:location.href,items,failures};const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='bigcoach-luck-history-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);box.remove();alert(items.length+'対局を保存しました。Luck Analyzerの「ファイル」から読み込んでください。'+(failures.length?' 取得不能: '+failures.length+'件':''));}catch(e){box?.remove();alert('一括取得できませんでした: '+e.message)}})()`;
    elements.historyBookmarklet.href = `javascript:${encodeURIComponent(historyCode)}`;
    elements.historyBookmarklet.addEventListener("click", (event) => {
      if (location.protocol.startsWith("http")) {
        event.preventDefault();
        setStatus("「Luck履歴を一括保存」をブックマークバーへドラッグし、BigCoachの履歴一覧で実行してください。", "loading");
      }
    });
  }

  elements.tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  elements.fetch.addEventListener("click", handleDirectFetch);
  elements.url.addEventListener("keydown", (event) => { if (event.key === "Enter") handleDirectFetch(); });
  elements.pasteButton.addEventListener("click", async () => {
    try {
      await handleText(elements.paste.value, { title: "貼り付けJSON" });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  elements.file.addEventListener("change", async () => {
    const file = elements.file.files?.[0];
    if (!file) return;
    try {
      await handleText(await file.text(), { title: file.name.replace(/\.(json|html?)$/i, "") });
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      elements.file.value = "";
    }
  });
  elements.demo.addEventListener("click", () => addPayload(DEMO_DATA, { title: "デモ牌譜" }));
  elements.export.addEventListener("click", downloadJson);
  elements.scopeButtons.forEach((button) => button.addEventListener("click", () => {
    scope = button.dataset.scope;
    render();
  }));

  buildBookmarklet();
  render();
})();
