(() => {
  const TILE_PATTERN = /\/Regular_shortnames\/([^/"']+)\.svg/i;
  const HONORS = { E: "1z", S: "2z", W: "3z", N: "4z", P: "5z", F: "6z", C: "7z" };
  const TENHOU_TILES = {
    11: "1m", 12: "2m", 13: "3m", 14: "4m", 15: "5m", 16: "6m", 17: "7m", 18: "8m", 19: "9m",
    21: "1p", 22: "2p", 23: "3p", 24: "4p", 25: "5p", 26: "6p", 27: "7p", 28: "8p", 29: "9p",
    31: "1s", 32: "2s", 33: "3s", 34: "4s", 35: "5s", 36: "6s", 37: "7s", 38: "8s", 39: "9s",
    41: "1z", 42: "2z", 43: "3z", 44: "4z", 45: "5z", 46: "6z", 47: "7z",
    51: "0m", 52: "0p", 53: "0s"
  };
  let analysisDataPromise = null;

  function doc() {
    return document.querySelector("iframe[title='Analysis Result']")?.contentDocument || document;
  }

  function normalizeTile(raw) {
    if (typeof raw === "number" && TENHOU_TILES[raw]) return TENHOU_TILES[raw];
    const value = String(raw || "");
    if (/^\d+$/.test(value) && TENHOU_TILES[Number(value)]) return TENHOU_TILES[Number(value)];
    if (HONORS[value]) return HONORS[value];
    const red = value.match(/^5([mps])r$/);
    if (red) return `0${red[1]}`;
    return /^[0-9][mpsz]$/.test(value) ? value : null;
  }

  function tileFromImage(image) {
    const match = String(image.currentSrc || image.src || "").match(TILE_PATTERN);
    const code = match?.[1] || "";
    if (["back", "Blank"].includes(code)) return null;
    return normalizeTile(code);
  }

  function imagesWithin(element) {
    return [...(element?.querySelectorAll?.("img") || [])].map(tileFromImage).filter(Boolean);
  }

  function text(selector) {
    return String(doc().querySelector(selector)?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function seatsFor(classPrefix) {
    return [0, 1, 2, 3].map((seat) => imagesWithin(doc().querySelector(`.${classPrefix}${seat}`)));
  }

  function actionEquals(left, right) {
    if (!left || !right) return false;
    return left.type === right.type &&
      normalizeTile(left.pai) === normalizeTile(right.pai) &&
      Number(left.actor ?? -1) === Number(right.actor ?? -1);
  }

  function actionLabel(action) {
    if (!action) return null;
    return normalizeTile(action.pai) || action.type || null;
  }

  function roundLabel(kyoku, honba) {
    const wind = kyoku < 4 ? "東" : kyoku < 8 ? "南" : kyoku < 12 ? "西" : "北";
    const number = (kyoku % 4) + 1;
    return `${wind}${number}局${honba ? ` ${honba}本場` : ""}`;
  }

  function parseRoundIndex(roundText) {
    const source = String(roundText || "").replace(/\s+/g, "");
    const windMatch = source.match(/[東东南西北]/);
    const numberMatch = source.match(/[1-4一二三四]/);
    if (!windMatch || !numberMatch) return null;
    const windBase = { 東: 0, 东: 0, 南: 4, 西: 8, 北: 12 }[windMatch[0]];
    const number = { 一: 1, 二: 2, 三: 3, 四: 4 }[numberMatch[0]] || Number(numberMatch[0]);
    const honbaMatch = source.match(/-(\d+)$/) || source.match(/(\d+)本場/);
    return { kyoku: windBase + number - 1, honba: honbaMatch ? Number(honbaMatch[1]) : 0 };
  }

  async function loadAnalysisData() {
    if (!analysisDataPromise) {
      const frame = document.querySelector("iframe[title='Analysis Result']");
      const dataPath = new URL(frame?.src || location.href).searchParams.get("data");
      if (!dataPath) throw new Error("解析結果JSONの場所を取得できませんでした");
      analysisDataPromise = fetch(dataPath).then((response) => {
        if (!response.ok) throw new Error(`解析結果JSONの取得に失敗しました: HTTP ${response.status}`);
        return response.json();
      });
    }
    return analysisDataPromise;
  }

  function entryMetrics(entry) {
    const best = entry.details?.find((item) => actionEquals(item.action, entry.expected)) || entry.details?.[0];
    const actual = entry.details?.find((item) => actionEquals(item.action, entry.actual));
    return {
      best,
      actual,
      qGap: best && actual ? Number(best.q_value) - Number(actual.q_value) : null,
      actualProbability: actual?.prob == null ? null : Number(actual.prob)
    };
  }

  async function reviewedEntries() {
    const data = await loadAnalysisData();
    const entries = [];
    let mismatchOrdinal = 0;
    for (let kyokuIndex = 0; kyokuIndex < (data.review?.kyokus || []).length; kyokuIndex += 1) {
      const kyoku = data.review.kyokus[kyokuIndex];
      for (let entryIndex = 0; entryIndex < (kyoku.entries || []).length; entryIndex += 1) {
        const entry = kyoku.entries[entryIndex];
        const metrics = entryMetrics(entry);
        entries.push({
          kyokuIndex,
          entryIndex,
          mismatchOrdinal: entry.is_equal ? null : mismatchOrdinal++,
          kyoku: Number(kyoku.kyoku),
          honba: Number(kyoku.honba || 0),
          entry,
          metrics
        });
      }
    }
    return entries;
  }

  function currentEntry(entries) {
    const game = doc().defaultView?.MM?.GS;
    const event = game?.ge?.[game.hand_counter]?.[game.ply_counter];
    if (event?.mortalEval) {
      const kyoku = game.fullData?.review?.kyokus?.[game.hand_counter];
      const entryIndex = kyoku?.entries?.findIndex((entry) =>
        entry === event.mortalEval ||
        (entry.junme === event.mortalEval.junme &&
          entry.tiles_left === event.mortalEval.tiles_left &&
          actionEquals(entry.actual, event.mortalEval.actual)));
      let mismatchOrdinal = null;
      if (!event.mortalEval.is_equal) {
        mismatchOrdinal = 0;
        outer: for (let hand = 0; hand < game.ge.length; hand += 1) {
          for (let ply = 0; ply < game.ge[hand].length; ply += 1) {
            if (hand === game.hand_counter && ply === game.ply_counter) break outer;
            if (game.ge[hand][ply].mortalEval && !game.ge[hand][ply].mortalEval.is_equal) mismatchOrdinal += 1;
          }
        }
      }
      return {
        kyokuIndex: game.hand_counter,
        entryIndex: Math.max(0, entryIndex),
        mismatchOrdinal,
        kyoku: Number(kyoku?.kyoku || 0),
        honba: Number(kyoku?.honba || 0),
        handCounter: game.hand_counter,
        plyCounter: game.ply_counter,
        entry: event.mortalEval,
        metrics: entryMetrics(event.mortalEval)
      };
    }
    const currentRound = parseRoundIndex(text(".info-round"));
    const tilesLeft = Number((text(".info-tiles-left").match(/\d+/) || [])[0]);
    const hand = imagesWithin(doc().querySelector(".grid-hand-p0")).sort().join(",");
    const candidates = entries.filter(({ kyoku, honba }) =>
      !currentRound || (kyoku === currentRound.kyoku && honba === currentRound.honba));
    return candidates.find(({ entry }) => {
      const entryHand = (entry.state?.tehai || []).map(normalizeTile).filter(Boolean).sort().join(",");
      return Number(entry.tiles_left) === tilesLeft && entryHand === hand;
    }) || candidates.find(({ entry }) => Number(entry.tiles_left) === tilesLeft) || candidates[0] || null;
  }

  function meldTiles(entry) {
    return (entry?.state?.fuuros || []).flatMap((meld) =>
      [meld.pai, ...(meld.consumed || [])].map(normalizeTile).filter(Boolean));
  }

  function candidateRows(entry) {
    return (entry?.details || []).map((item) => ({
      tile: actionLabel(item.action),
      value: item.prob == null ? null : Number(item.prob),
      qValue: item.q_value == null ? null : Number(item.q_value),
      label: `${actionLabel(item.action) || item.action?.type || "操作"} / P ${Number(item.prob || 0).toFixed(6)} / Q ${Number(item.q_value || 0).toFixed(4)}`,
      raw: JSON.stringify(item)
    })).filter((item) => item.tile);
  }

  async function scrape() {
    const page = doc();
    const entries = await reviewedEntries();
    const current = currentEntry(entries);
    const entry = current?.entry;
    const handTiles = (entry?.state?.tehai || imagesWithin(page.querySelector(".grid-hand-p0")))
      .map(normalizeTile).filter(Boolean);
    const callsBySeat = seatsFor("hand-calls-p");
    if (entry) callsBySeat[0] = meldTiles(entry);
    const claimedBySeat = [0, 1, 2, 3].map((seat) => {
      const root = page.querySelector(`.hand-calls-p${seat}`);
      return [...(root?.querySelectorAll?.("img.rotate,.rotate img") || [])].map(tileFromImage).filter(Boolean);
    });
    const scoreTexts = [0, 1, 2, 3].map((seat) => text(`.gi-p${seat}`)).filter(Boolean);
    const roundText = current ? roundLabel(current.kyoku, current.honba) : text(".info-round");
    return {
      title: page.title,
      handTiles,
      drawTile: handTiles.length % 3 === 2 ? handTiles.at(-1) : null,
      discardsBySeat: seatsFor("grid-discard-p"),
      callsBySeat,
      claimedBySeat,
      doraTiles: imagesWithin(page.querySelector(".info-doras")),
      tilesLeftText: text(".info-tiles-left"),
      roundText,
      honba: current?.honba ?? null,
      seatText: scoreTexts[0] || "",
      actorText: scoreTexts[0] || "",
      turn: entry?.junme || null,
      scores: scoreTexts,
      actualDiscard: actionLabel(entry?.actual),
      recommendedDiscard: actionLabel(entry?.expected),
      candidates: candidateRows(entry),
      aiSummary: entry?.is_equal ? "実打とAI推奨が一致" : "実打とAI推奨が不一致",
      sourcePosition: current ? {
        kyokuIndex: current.kyokuIndex,
        entryIndex: current.entryIndex,
        mismatchOrdinal: current.mismatchOrdinal
      } : null,
      diagnostics: {
        frame: page !== document,
        currentEntryFound: Boolean(current),
        reviewedEntryCount: entries.length,
        mismatchCount: entries.filter((item) => item.mismatchOrdinal != null).length
      }
    };
  }

  async function clickControl(id) {
    const control = doc().querySelector(id);
    if (!control) return { ok: false, reason: `BigCoach操作ボタン ${id} が見つかりませんでした` };
    control.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { ok: true, text: String(control.textContent || "") };
  }

  async function navigate(kind) {
    const controls = { previousMistake: "#prev-mismatch", nextMistake: "#next-mismatch" };
    if (kind === "previous" || kind === "next") {
      const entries = await reviewedEntries();
      const before = currentEntry(entries);
      const selector = kind === "previous" ? "#ply-dec2" : "#ply-inc2";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = await clickControl(selector);
        if (!result.ok) return result;
        const after = currentEntry(entries);
        if (after?.entry?.actual?.type === "dahai" && (!before ||
          after.kyokuIndex !== before.kyokuIndex ||
          after.entryIndex !== before.entryIndex)) return result;
      }
      return { ok: false, reason: "次の解析対象局面を見つけられませんでした" };
    }
    const selector = controls[kind];
    if (!selector) return { ok: false, reason: `未対応の移動操作です: ${kind}` };
    return clickControl(selector);
  }

  async function listMistakes() {
    const game = doc().defaultView?.MM?.GS;
    if (!game?.ge) throw new Error("BigCoachプレイヤーの局面データを取得できませんでした");
    const mistakes = [];
    for (let handCounter = 0; handCounter < game.ge.length; handCounter += 1) {
      const kyoku = game.fullData.review.kyokus[handCounter];
      for (let plyCounter = 0; plyCounter < game.ge[handCounter].length; plyCounter += 1) {
        const entry = game.ge[handCounter][plyCounter].mortalEval;
        if (!entry || entry.is_equal) continue;
        const metrics = entryMetrics(entry);
        mistakes.push({
          kyokuIndex: handCounter,
          entryIndex: kyoku.entries.findIndex((item) =>
            item.junme === entry.junme &&
            item.tiles_left === entry.tiles_left &&
            actionEquals(item.actual, entry.actual)),
          handCounter,
          plyCounter,
          mismatchOrdinal: mistakes.length,
          roundText: roundLabel(Number(kyoku.kyoku), Number(kyoku.honba || 0)),
          turn: Number(entry.junme || 0),
          actual: actionLabel(entry.actual),
          recommended: actionLabel(entry.expected),
          actualProbability: metrics.actualProbability,
          qGap: metrics.qGap,
          handTiles: (entry.state?.tehai || []).map(normalizeTile).filter(Boolean)
        });
      }
    }
    return mistakes;
  }

  async function goToMismatch(ordinal) {
    const mistakes = await listMistakes();
    const target = mistakes[Number(ordinal)];
    if (!target) return { ok: false, reason: `大悪手 #${Number(ordinal) + 1} が見つかりませんでした` };
    const frame = document.querySelector("iframe[title='Analysis Result']");
    const targetUrl = new URL(frame.src);
    targetUrl.searchParams.set("hand", String(target.handCounter));
    targetUrl.searchParams.set("ply", String(target.plyCounter));
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ ok: false, reason: "移動先局面の読込がタイムアウトしました" }), 10000);
      frame.addEventListener("load", () => {
        clearTimeout(timeout);
        setTimeout(() => resolve({ ok: true }), 100);
      }, { once: true });
      frame.src = targetUrl.href;
    });
  }

  window.__bigcoachDesktop = { scrape, navigate, listMistakes, goToMismatch };
  return { ready: true };
})();
