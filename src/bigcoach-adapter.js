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

  function analysisFrame() {
    return document.querySelector(
      "iframe[title='Analysis Result'], iframe[title='Classic Analysis Result']"
    );
  }

  async function ensureClassicFrame(timeoutMs = 12000) {
    if (window.MM?.GS) return null;
    let frame = analysisFrame();
    if (frame?.contentDocument?.defaultView?.MM?.GS) return frame;

    const classicInput = document.querySelector(
      "input[value='classic'], input[type='radio'][value='classic']"
    );
    if (classicInput) {
      classicInput.click();
    } else {
      const classicControl = [...document.querySelectorAll(
        "label,button,.el-radio-button,.el-radio-button__inner"
      )].find((element) => /クラシック|Classic|经典|經典/.test(element.textContent || ""));
      classicControl?.click();
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      frame = analysisFrame();
      if (frame?.contentDocument?.defaultView?.MM?.GS) return frame;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("BigCoachのクラシック解析画面へ切り替えられませんでした");
  }

  function doc() {
    return analysisFrame()?.contentDocument || document;
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

  function closeOverlays() {
    const page = doc();
    for (const dialog of [...page.querySelectorAll("dialog[open]"), ...document.querySelectorAll("dialog[open]")]) {
      try { dialog.close(); } catch { dialog.removeAttribute("open"); }
    }
    for (const element of page.querySelectorAll(".modal[open],.draggable-window:not(.hidden)")) {
      if (element.id === "draggable-analysis") element.classList.add("hidden");
    }
  }

  function opponentRiichiAt(game, handCounter, plyCounter) {
    const reached = new Set();
    for (let index = 0; index <= plyCounter; index += 1) {
      const event = game.ge[handCounter][index];
      if ((event?.type === "reach" || event?.type === "reach_accepted") &&
          Number(event.actor) !== Number(game.heroPidx)) reached.add(Number(event.actor));
    }
    return reached.size > 0;
  }

  function initialHandsForRound(game, handCounter) {
    const starts = (game.fullData?.mjai_log || []).filter((event) => event.type === "start_kyoku");
    return (starts[handCounter]?.tehais || []).map((hand) =>
      hand.map(normalizeTile).filter(Boolean).sort().join(""));
  }

  async function reviewedEntries() {
    await ensureClassicFrame();
    const game = doc().defaultView?.MM?.GS;
    const data = game?.fullData;
    if (!data || !game?.ge) throw new Error("BigCoachの解析データがまだ読み込まれていません");
    const entries = [];
    let mismatchOrdinal = 0;
    for (let kyokuIndex = 0; kyokuIndex < (data.review?.kyokus || []).length; kyokuIndex += 1) {
      const kyoku = data.review.kyokus[kyokuIndex];
      for (let entryIndex = 0; entryIndex < (kyoku.entries || []).length; entryIndex += 1) {
        const entry = kyoku.entries[entryIndex];
        const gameEvent = game.ge[kyokuIndex]?.find((event) => event.mortalEval === entry ||
          (event.mortalEval?.junme === entry.junme &&
           event.mortalEval?.tiles_left === entry.tiles_left &&
           actionEquals(event.mortalEval?.actual, entry.actual)));
        const metrics = entryMetrics(entry);
        entries.push({
          kyokuIndex,
          entryIndex,
          mismatchOrdinal: entry.is_equal ? null : mismatchOrdinal++,
          kyoku: Number(kyoku.kyoku),
          honba: Number(kyoku.honba || 0),
          handCounter: kyokuIndex,
          plyCounter: Math.max(0, game.ge[kyokuIndex]?.indexOf(gameEvent) ?? 0),
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

  function judgmentType(entry) {
    const types = new Set([entry?.actual?.type, entry?.expected?.type,
      ...(entry?.details || []).map((item) => item.action?.type)].filter(Boolean));
    if (types.has("reach")) return "riichi";
    if (["chi", "pon", "daiminkan", "ankan", "kakan"].some((type) => types.has(type))) return "call";
    return "discard";
  }

  async function scrape() {
    await ensureClassicFrame();
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
    const game = page.defaultView?.MM?.GS;
    const handsBySeat = (game?.gs?.hands || []).map((hand) =>
      (hand || []).map(normalizeTile).filter(Boolean));
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
      judgmentType: judgmentType(entry),
      handsBySeat,
      shanten: entry?.shanten ?? null,
      atSelfRiichi: Boolean(entry?.at_self_riichi),
      ownRiichiMoment: entry?.actual?.type === "reach",
      opponentRiichi: current ? opponentRiichiAt(page.defaultView.MM.GS, current.handCounter, current.plyCounter) : false,
      sourcePosition: current ? {
        kyokuIndex: current.kyokuIndex,
        entryIndex: current.entryIndex,
        mismatchOrdinal: current.mismatchOrdinal,
        handCounter: current.handCounter,
        plyCounter: current.plyCounter
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
    closeOverlays();
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
    return (await listDecisions()).filter((item) => item.isBad);
  }

  async function listDecisions() {
    await ensureClassicFrame();
    const game = doc().defaultView?.MM?.GS;
    if (!game?.ge) throw new Error("BigCoachプレイヤーの局面データを取得できませんでした");
    const decisions = [];
    let mismatchOrdinal = 0;
    for (let handCounter = 0; handCounter < game.ge.length; handCounter += 1) {
      const kyoku = game.fullData.review.kyokus[handCounter];
      const initialHands = initialHandsForRound(game, handCounter);
      for (let plyCounter = 0; plyCounter < game.ge[handCounter].length; plyCounter += 1) {
        const entry = game.ge[handCounter][plyCounter].mortalEval;
        if (!entry) continue;
        const type = judgmentType(entry);
        if (!["discard", "riichi", "call"].includes(type)) continue;
        const metrics = entryMetrics(entry);
        const isBad = !entry.is_equal;
        decisions.push({
          kyokuIndex: handCounter,
          entryIndex: kyoku.entries.findIndex((item) =>
            item.junme === entry.junme &&
            item.tiles_left === entry.tiles_left &&
            actionEquals(item.actual, entry.actual)),
          handCounter,
          plyCounter,
          mismatchOrdinal: isBad ? mismatchOrdinal++ : null,
          roundText: roundLabel(Number(kyoku.kyoku), Number(kyoku.honba || 0)),
          turn: Number(entry.junme || 0),
          actual: actionLabel(entry.actual),
          recommended: actionLabel(entry.expected),
          actualProbability: metrics.actualProbability,
          qGap: metrics.qGap,
          handTiles: (entry.state?.tehai || []).map(normalizeTile).filter(Boolean),
          judgmentType: type,
          shanten: Number(entry.shanten),
          atSelfRiichi: Boolean(entry.at_self_riichi),
          ownRiichiMoment: entry.actual?.type === "reach",
          opponentRiichi: opponentRiichiAt(game, handCounter, plyCounter),
          isBad,
          initialHands
        });
      }
    }
    return decisions;
  }

  async function goToPosition(handCounter, plyCounter) {
    closeOverlays();
    await ensureClassicFrame();
    const page = doc();
    const game = page.defaultView?.MM?.GS;
    const hand = Number(handCounter);
    const ply = Number(plyCounter);
    if (!game?.ge?.[hand]?.[ply]) {
      return { ok: false, reason: "指定された局面がBigCoachの解析結果にありません" };
    }
    game.hand_counter = hand;
    game.ply_counter = ply;

    // BigCoach自身の表示更新処理を「手牌表示の往復」で呼び出す。
    // iframeを再読込しないため、局面移動ごとの解析JSON再取得は発生しない。
    const toggleHands = page.querySelector("#toggle-hands");
    if (!toggleHands) return { ok: false, reason: "BigCoachの表示更新ボタンを取得できませんでした" };
    toggleHands.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    toggleHands.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { ok: true };
  }

  async function goToMismatch(ordinal) {
    const mistakes = await listMistakes();
    const target = mistakes[Number(ordinal)];
    if (!target) return { ok: false, reason: `ミス #${Number(ordinal) + 1} が見つかりませんでした` };
    return goToPosition(target.handCounter, target.plyCounter);
  }

  function captureVisualState() {
    const page = doc();
    const discardSvg = page.querySelector(".discard-bars-svg");
    const discardBarRectCount = discardSvg?.querySelectorAll("rect").length || 0;
    const callBarRectCount = page.querySelectorAll(".killer-call-bars rect").length;
    const barRectCount = discardBarRectCount + callBarRectCount;
    const spoilerVisible = [...(discardSvg?.querySelectorAll("text") || [])]
      .some((element) => /何切模式|何切モード|spoiler/i.test(element.textContent || ""));
    const candidateTable = page.querySelector(".opt-info > table:first-of-type");
    const candidateDetailRows = Math.max(0, (candidateTable?.querySelectorAll("tr").length || 0) - 1);
    const opponentHands = [1, 2, 3].map((seat) => {
      const images = [...page.querySelectorAll(`.hand-closed-p${seat} img`)]
        .filter((image) => {
          const style = page.defaultView.getComputedStyle(image);
          const rect = image.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
        });
      const backs = images.filter((image) => /\/(?:back|Blank)\.(?:svg|png)/i.test(image.currentSrc || image.src)).length;
      return {
        seat,
        total: images.length,
        backs,
        faces: images.length - backs
      };
    });
    const totalOpponentTiles = opponentHands.reduce((sum, hand) => sum + hand.total, 0);
    const opponentFaceTiles = opponentHands.reduce((sum, hand) => sum + hand.faces, 0);
    const opponentBackTiles = opponentHands.reduce((sum, hand) => sum + hand.backs, 0);
    const everyOpponentHasFaces = opponentHands
      .filter((hand) => hand.total > 0)
      .every((hand) => hand.faces > 0);
    return {
      barRectCount,
      discardBarRectCount,
      callBarRectCount,
      candidateDetailRows,
      spoilerVisible,
      aiBarsVisible: barRectCount > 0 && !spoilerVisible,
      aiAdviceVisible: candidateDetailRows > 0,
      opponentHands,
      totalOpponentTiles,
      opponentFaceTiles,
      opponentBackTiles,
      opponentsRevealed: totalOpponentTiles > 0 && everyOpponentHasFaces &&
        opponentFaceTiles > opponentBackTiles,
      opponentsHidden: totalOpponentTiles > 0 && opponentFaceTiles === 0 && opponentBackTiles > 0
    };
  }

  function visualStateMatches(mode, state) {
    return mode === "front"
      ? !state.aiBarsVisible && !state.aiAdviceVisible && state.opponentsHidden
      : state.aiBarsVisible && state.aiAdviceVisible && state.opponentsRevealed;
  }

  function displayStateMatches(expected, state) {
    const mortalMatches = expected.showMortal
      ? state.aiBarsVisible && state.aiAdviceVisible
      : !state.aiBarsVisible && !state.aiAdviceVisible;
    const handsMatch = expected.showHands
      ? state.opponentsRevealed
      : state.opponentsHidden;
    return mortalMatches && handsMatch;
  }

  async function waitForVisualPaint(frameCount = 4) {
    const view = doc().defaultView;
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
    }
    await new Promise((resolve) => view.setTimeout(resolve, 150));
    return captureVisualState();
  }

  function renderCaptureMode(mode) {
    const page = doc();
    const game = page.defaultView?.MM?.GS;
    if (!game?.ui) {
      return { ok: false, reason: "BigCoachの描画機能を取得できませんでした" };
    }
    page.defaultView.setTimeout(() => {
      game.showMortal = mode === "back";
      game.showHands = mode === "back";
      game.ui.updateHandInfo();
      game.ui.clearDiscardBars();
      game.ui.updateDiscardBars();
      game.ui.clearCallBars();
      game.ui.updateCallBars();
      game.ui.updateOptInfo();
      const event = game.ge?.[game.hand_counter]?.[game.ply_counter];
      game.ui.updateLogo(event?.mortalEval);
    }, 0);
    return { ok: true };
  }

  function captureDisplayState() {
    const page = doc();
    const game = page.defaultView?.MM?.GS;
    if (!game) throw new Error("BigCoachの表示状態を取得できませんでした");
    return {
      showMortal: Boolean(game.showMortal),
      showHands: Boolean(game.showHands),
      visualState: captureVisualState()
    };
  }

  async function ensureCaptureVisualState(mode) {
    const state = captureVisualState();
    if (visualStateMatches(mode, state)) return state;
    throw new Error(
      `${mode === "front" ? "問題面" : "解答面"}の表示状態を確認できませんでした。` +
      ` AI棒グラフ=${state.aiBarsVisible ? "表示" : "非表示"}、` +
      `AI候補表=${state.aiAdviceVisible ? "表示" : "非表示"}、` +
      `相手手牌=${state.opponentsRevealed ? "表向き" : state.opponentsHidden ? "裏向き" : "判定不能"}`
    );
  }

  async function prepareCapture(mode) {
    closeOverlays();
    await ensureClassicFrame();
    const hiddenOuter = [];
    if (window.top === window) {
      for (const element of document.querySelectorAll("body > div:not(#app)")) {
        hiddenOuter.push({ element, display: element.style.display });
        element.style.setProperty("display", "none", "important");
      }
    }
    const page = doc();
    const game = page.defaultView?.MM?.GS;
    if (!game) throw new Error("BigCoachの表示状態を取得できませんでした");
    const verifiedState = await ensureCaptureVisualState(mode);
    const frame = analysisFrame();
    const frameRect = frame?.getBoundingClientRect() || { x: 0, y: 0 };
    const gameRect = page.querySelector(".grid-main")?.getBoundingClientRect();
    const bodyText = String(page.body?.innerText || "");
    const probability = (label) => {
      const match = bodyText.match(new RegExp(`${label}\\s*([0-9.]+)%`));
      return match ? Number(match[1]) : null;
    };
    return {
      hiddenOuterCount: hiddenOuter.length,
      relativeToFrame: !frame,
      displayState: {
        showMortal: Boolean(game.showMortal),
        showHands: Boolean(game.showHands),
        hasAiAnalysis: /AI Analysis/.test(bodyText),
        hasNanikiruNotice: /何切模式|何切モード/.test(bodyText),
        ...verifiedState
      },
      outcomes: mode === "back" ? {
        draw: probability("流局確率"),
        movement: probability("横移動確率"),
        dealIn: probability("放銃確率"),
        win: probability("和了確率")
      } : null,
      rect: mode === "front" && gameRect ? {
        x: Math.max(0, Math.floor(frameRect.x + gameRect.x)),
        y: Math.max(0, Math.floor(frameRect.y + gameRect.y)),
        width: Math.ceil(gameRect.width),
        height: Math.ceil(gameRect.height)
      } : null
    };
  }

  async function restoreCapture(previous) {
    const page = doc();
    const game = page.defaultView?.MM?.GS;
    if (!game || !previous) return null;
    const current = captureDisplayState();
    if (current.showMortal === Boolean(previous.showMortal) &&
        current.showHands === Boolean(previous.showHands) &&
        displayStateMatches(previous, current.visualState)) {
      closeOverlays();
      return current;
    }
    game.showMortal = Boolean(previous.showMortal);
    game.showHands = Boolean(previous.showHands);
    game.ui.updateHandInfo();
    game.ui.clearDiscardBars();
    game.ui.updateDiscardBars();
    game.ui.clearCallBars();
    game.ui.updateCallBars();
    game.ui.updateOptInfo();
    if (window.top === window) {
      for (const element of document.querySelectorAll("body > div:not(#app)")) {
        element.style.removeProperty("display");
      }
    }
    closeOverlays();
    await waitForVisualPaint(5);
    return captureDisplayState();
  }

  window.__bigcoachDesktop = {
    scrape,
    navigate,
    listMistakes,
    listDecisions,
    goToMismatch,
    goToPosition,
    captureVisualState,
    captureDisplayState,
    waitForVisualPaint,
    renderCaptureMode,
    prepareCapture,
    restoreCapture,
    closeOverlays
  };
  return { ready: true };
})();
