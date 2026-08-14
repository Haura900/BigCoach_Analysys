(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LuckAnalyzer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;

  function clampProbability(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalized = numeric > 1 ? numeric / 100 : numeric;
    return Math.min(1, Math.max(0, normalized));
  }

  function parseGameInfo(entry) {
    if (!entry || typeof entry.game_info !== "string") return entry?.game_info || {};
    try {
      return JSON.parse(entry.game_info);
    } catch {
      return {};
    }
  }

  function actionEquals(left, right) {
    if (!left || !right) return false;
    return ["type", "actor", "target", "pai"].every((key) => {
      if (left[key] == null && right[key] == null) return true;
      return String(left[key]) === String(right[key]);
    });
  }

  function actualDetail(entry) {
    return (entry?.details || []).find((item) => actionEquals(item.action, entry.actual)) || null;
  }

  function winProbability(entry) {
    if (Array.isArray(entry?.sl_outcome) && entry.sl_outcome.length >= 2) {
      const value = Number(entry.sl_outcome[0]) + Number(entry.sl_outcome[1]);
      return clampProbability(value);
    }
    const candidates = [
      entry?.win_prob,
      entry?.winProbability,
      entry?.agari_prob,
      entry?.agariProbability,
      entry?.hora_prob,
      entry?.horaProbability
    ];
    for (const value of candidates) {
      const normalized = clampProbability(value);
      if (normalized != null) return normalized;
    }
    return null;
  }

  function dealInProbability(entry) {
    const detail = actualDetail(entry);
    const candidates = [detail?.houjuu_rate, detail?.deal_in_rate, detail?.dealInRate];
    for (const value of candidates) {
      const normalized = clampProbability(value);
      if (normalized != null) return normalized;
    }
    return null;
  }

  function expectedWinPoints(entry) {
    const detail = actualDetail(entry);
    const candidates = [detail?.expected_win_points, detail?.expectedWinPoints];
    for (const value of candidates) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    }
    return null;
  }

  function findNumberByKey(source, patterns, depth = 0, seen = new Set()) {
    if (!source || typeof source !== "object" || depth > 5 || seen.has(source)) return null;
    seen.add(source);
    for (const [key, value] of Object.entries(source)) {
      if (patterns.some((pattern) => pattern.test(key)) && Number.isFinite(Number(value))) {
        return Number(value);
      }
    }
    for (const value of Object.values(source)) {
      const found = findNumberByKey(value, patterns, depth + 1, seen);
      if (found != null) return found;
    }
    return null;
  }

  function findFlagByText(source, pattern, depth = 0, seen = new Set()) {
    if (source == null || depth > 5) return null;
    if (typeof source === "string") return pattern.test(source) ? true : null;
    if (typeof source !== "object" || seen.has(source)) return null;
    seen.add(source);
    for (const [key, value] of Object.entries(source)) {
      if (pattern.test(key) && (value === true || Number(value) > 0)) return true;
      const found = findFlagByText(value, pattern, depth + 1, seen);
      if (found) return true;
    }
    return null;
  }

  function roundLabel(kyoku, index) {
    const value = Number(kyoku?.kyoku);
    if (!Number.isFinite(value)) return `第${index + 1}局`;
    const winds = ["東", "南", "西", "北"];
    const wind = winds[Math.floor(value / 4)] || "?";
    const number = (value % 4) + 1;
    const honba = Number(kyoku?.honba || 0);
    return `${wind}${number}局${honba ? ` ${honba}本場` : ""}`;
  }

  function heroWins(endStatus, hero) {
    return (endStatus || []).filter((item) => item?.type === "hora" && Number(item.actor) === hero);
  }

  function heroDealsIn(endStatus, hero) {
    return (endStatus || []).some((item) =>
      item?.type === "hora" && Number(item.target) === hero && Number(item.actor) !== hero
    );
  }

  function preferredPointEntry(entries) {
    const riichiIndex = entries.findIndex((entry) =>
      entry?.actual?.type === "reach" && Number(entry.actual.actor ?? 0) === 0
    );
    if (riichiIndex >= 0) {
      const afterRiichi = entries.slice(riichiIndex + 1).find((entry) => expectedWinPoints(entry) != null);
      if (afterRiichi) return afterRiichi;
    }
    return entries.find((entry) => expectedWinPoints(entry) != null) || null;
  }

  function unwrapPayload(payload) {
    if (typeof payload === "string") payload = JSON.parse(payload);
    if (payload?.review?.kyokus) return payload;
    if (payload?.data?.review?.kyokus) return payload.data;
    if (payload?.result?.review?.kyokus) return payload.result;
    throw new Error("BigCoachの解析JSONを認識できません。review.kyokus を含むJSONを貼り付けてください。");
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function analyzePayload(payload, meta = {}) {
    const data = unwrapPayload(payload);
    const kyokus = Array.isArray(data.review?.kyokus) ? data.review.kyokus : [];
    if (!kyokus.length) throw new Error("解析できる局データがありません。");
    const hero = Number.isFinite(Number(data.player_id)) ? Number(data.player_id) : 0;
    const rounds = [];

    kyokus.forEach((kyoku, index) => {
      const entries = Array.isArray(kyoku.entries) ? kyoku.entries : [];
      const endStatus = Array.isArray(kyoku.end_status) ? kyoku.end_status : [];
      const wins = heroWins(endStatus, hero);
      const didWin = wins.length > 0;
      const didDealIn = heroDealsIn(endStatus, hero);
      const firstEntry = entries.find((entry) => winProbability(entry) != null) || null;
      const dealP = firstEntry ? winProbability(firstEntry) : null;

      const riichiEntry = entries.find((entry) =>
        entry?.actual?.type === "reach" && Number(entry.actual.actor ?? hero) === hero
      );
      const riichiP = riichiEntry ? winProbability(riichiEntry) : null;

      const riskEntries = entries
        .map((entry, entryIndex) => ({ entry, entryIndex, p: dealInProbability(entry) }))
        .filter((item) => item.p != null && ["dahai", "reach"].includes(item.entry?.actual?.type));
      const finalRiskIndex = riskEntries.length ? riskEntries[riskEntries.length - 1].entryIndex : -1;
      const risks = riskEntries.map((item) => ({
        p: item.p,
        y: didDealIn && item.entryIndex === finalRiskIndex ? 1 : 0,
        turn: Number(item.entry?.junme || 0)
      }));

      const pointEntry = preferredPointEntry(entries);
      const expectedPoints = pointEntry ? expectedWinPoints(pointEntry) : null;
      const actualPoints = didWin
        ? wins.reduce((sum, win) => sum + Number(win?.deltas?.[hero] || 0), 0)
        : null;
      const uraCount = didWin
        ? findNumberByKey(wins, [/^ura_?dora$/i, /^uradora$/i, /^裏ドラ$/])
        : null;
      const ippatsu = didWin ? findFlagByText(wins, /ippatsu|一発/i) : null;
      const uraIndicators = didWin
        ? wins.reduce((sum, win) => sum + (Array.isArray(win?.ura_markers) ? win.ura_markers.length : 0), 0)
        : 0;

      rounds.push({
        label: roundLabel(kyoku, index),
        deal: dealP == null ? null : { p: dealP, y: didWin ? 1 : 0 },
        riichi: riichiEntry ? { p: riichiP, y: didWin ? 1 : 0 } : null,
        risks,
        points: didWin ? {
          expected: expectedPoints,
          actual: actualPoints,
          diff: expectedPoints == null ? null : actualPoints - expectedPoints,
          uraCount,
          uraIndicators,
          ippatsu
        } : null,
        result: didWin ? "win" : didDealIn ? "deal-in" : "other"
      });
    });

    const signature = JSON.stringify(rounds);
    return {
      schemaVersion: VERSION,
      id: `bc-${hashText(signature)}`,
      sourceUrl: meta.sourceUrl || "",
      title: meta.title || `BigCoach解析 ${kyokus.length}局`,
      importedAt: meta.importedAt || new Date().toISOString(),
      engine: String(data.engine || "BigCoach"),
      gameLength: String(data.game_length || ""),
      rounds
    };
  }

  function sigma(events) {
    const valid = (events || []).filter((event) =>
      event && event.p != null && Number.isFinite(Number(event.y))
    );
    const observedMinusExpected = valid.reduce((sum, event) => sum + Number(event.y) - Number(event.p), 0);
    const variance = valid.reduce((sum, event) => sum + Number(event.p) * (1 - Number(event.p)), 0);
    return {
      n: valid.length,
      observed: valid.reduce((sum, event) => sum + Number(event.y), 0),
      expected: valid.reduce((sum, event) => sum + Number(event.p), 0),
      variance,
      z: variance > 0 ? observedMinusExpected / Math.sqrt(variance) : null
    };
  }

  function empiricalPercentile(value, pool) {
    const valid = (pool || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!Number.isFinite(Number(value)) || !valid.length) return null;
    const lower = valid.filter((item) => item < value).length;
    const equal = valid.filter((item) => item === value).length;
    return ((lower + equal * 0.5) / valid.length) * 100;
  }

  function inverseNormal(probability) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, Number(probability)));
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const low = 0.02425;
    const high = 1 - low;
    if (p < low) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > high) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function summarize(records, selectedId = null) {
    const allRecords = Array.isArray(records) ? records : [];
    const selected = selectedId ? allRecords.filter((record) => record.id === selectedId) : allRecords;
    const subjectRounds = selected.flatMap((record) => record.rounds || []);
    const poolDeals = allRecords.flatMap((record) => record.rounds || [])
      .map((round) => round.deal?.p)
      .filter((value) => value != null);
    const dealValues = subjectRounds.map((round) => round.deal?.p).filter((value) => value != null);
    const dealMean = dealValues.length
      ? dealValues.reduce((sum, value) => sum + value, 0) / dealValues.length
      : null;
    const percentile = empiricalPercentile(dealMean, poolDeals);
    const percentileZ = percentile == null ? null : inverseNormal(Math.min(0.995, Math.max(0.005, percentile / 100)));

    const riichiEvents = subjectRounds.map((round) => round.riichi).filter((event) => event?.p != null);
    const riskEvents = subjectRounds.flatMap((round) => round.risks || []);
    const pointEvents = subjectRounds.map((round) => round.points).filter((event) => event?.diff != null);
    const wins = subjectRounds.map((round) => round.points).filter(Boolean);
    const pointDiff = pointEvents.reduce((sum, event) => sum + event.diff, 0);

    return {
      records: selected.length,
      rounds: subjectRounds.length,
      deal: { n: dealValues.length, mean: dealMean, percentile, z: percentileZ, poolN: poolDeals.length },
      riichi: sigma(riichiEvents),
      dealIn: sigma(riskEvents),
      points: {
        n: pointEvents.length,
        wins: wins.length,
        expected: pointEvents.reduce((sum, event) => sum + event.expected, 0),
        actual: pointEvents.reduce((sum, event) => sum + event.actual, 0),
        diff: pointDiff,
        meanDiff: pointEvents.length ? pointDiff / pointEvents.length : null,
        uraSupported: wins.some((event) => event.uraCount != null),
        uraCount: wins.reduce((sum, event) => sum + Number(event.uraCount || 0), 0),
        uraIndicators: wins.reduce((sum, event) => sum + Number(event.uraIndicators || 0), 0),
        ippatsuSupported: wins.some((event) => event.ippatsu != null),
        ippatsuCount: wins.filter((event) => event.ippatsu === true).length
      }
    };
  }

  function extractEmbeddedJson(html) {
    const document = new DOMParser().parseFromString(String(html || ""), "text/html");
    const scripts = [...document.querySelectorAll("script")];
    for (const script of scripts) {
      const text = script.textContent?.trim();
      if (!text || (!text.startsWith("{") && !text.startsWith("["))) continue;
      try {
        const parsed = JSON.parse(text);
        const candidates = [parsed, parsed?.props?.pageProps, parsed?.data, parsed?.result];
        for (const candidate of candidates) {
          try {
            return unwrapPayload(candidate);
          } catch {
            // Continue looking through embedded script data.
          }
        }
      } catch {
        // Not a JSON script.
      }
    }
    const match = String(html || "").match(/\/api\/v2\/tasks\/[^"'\\s<]+\/data\?token=[^"'\\s<]+/);
    return match ? { dataUrl: match[0].replace(/&amp;/g, "&") } : null;
  }

  return {
    VERSION,
    analyzePayload,
    summarize,
    sigma,
    empiricalPercentile,
    inverseNormal,
    unwrapPayload,
    extractEmbeddedJson
  };
});
