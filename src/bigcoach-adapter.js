(() => {
  const TILE_PATTERN = /\/Regular_shortnames\/([^/"']+)\.svg/i;
  const VALID_TILE = /^(?:[0-9])[mpsz]$/;

  function tileFromImage(image) {
    const match = String(image.currentSrc || image.src || "").match(TILE_PATTERN);
    const code = match?.[1] || "";
    return VALID_TILE.test(code) && !["back", "Blank"].includes(code) ? code : null;
  }

  function imagesWithin(element) {
    return [...(element?.querySelectorAll?.("img") || [])].map(tileFromImage).filter(Boolean);
  }

  function firstElement(selectors) {
    for (const selector of selectors) {
      const result = document.querySelector(selector);
      if (result) return result;
    }
    return null;
  }

  function textOf(selectors) {
    return String(firstElement(selectors)?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function seatsFor(classPrefix) {
    return [0, 1, 2, 3].map((seat) => imagesWithin(document.querySelector(`.${classPrefix}${seat}`)));
  }

  function parseTileFromText(text) {
    const direct = String(text).match(/(?:打|切|discard|推奨|recommend)[^\d0-9mpsz]*([0-9][mpsz])/i);
    if (direct) return direct[1];
    const compact = String(text).match(/\b([0-9][mpsz])\b/i);
    return compact?.[1] || null;
  }

  function candidateRows() {
    const selectors = [
      "[class*='candidate']", "[class*='choice']", "[class*='action-prob']",
      "[class*='recommend']", "[class*='prediction']", "table tr"
    ];
    const seen = new Set();
    const candidates = [];
    for (const element of document.querySelectorAll(selectors.join(","))) {
      const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 500) continue;
      const tile = imagesWithin(element)[0] || parseTileFromText(text);
      if (!tile) continue;
      const numbers = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%?/g)].map((match) => Number(match[1]));
      const percent = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
      let value = percent ? Number(percent[1]) / 100 : numbers.find((number) => Math.abs(number) <= 1) ?? null;
      const key = `${tile}:${value}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ tile, value, label: text.slice(0, 160), raw: text });
    }
    return candidates.slice(0, 30);
  }

  function scoreTexts() {
    const selectors = [
      "[class*='score']", "[class*='point']", ".gi-p0", ".gi-p1", ".gi-p2", ".gi-p3"
    ];
    const texts = [...document.querySelectorAll(selectors.join(","))]
      .map((element) => String(element.textContent || "").replace(/\s+/g, " ").trim())
      .filter((text) => /\d{3,}/.test(text));
    return [...new Set(texts)].slice(0, 8);
  }

  function metadataText() {
    const body = String(document.body?.innerText || "").replace(/\s+/g, " ");
    const round = body.match(/(?:東|南|西|北|东)\s*[1-4一二三四]\s*局(?:\s*\d+\s*本場)?/);
    const honba = round?.[0]?.match(/(\d+)\s*本場/);
    const turn = body.match(/(\d+)\s*巡目/);
    return { body, roundText: round?.[0] || "", honba: honba ? Number(honba[1]) : null, turn: turn ? Number(turn[1]) : null };
  }

  function scrape() {
    const meta = metadataText();
    const handRoot = firstElement([".grid-hand-p0", "[class*='grid-hand-p0']", "[class*='hand-p0']"]);
    let handTiles = imagesWithin(handRoot);
    if (!handTiles.length) {
      const hands = [0, 1, 2, 3].map((seat) => imagesWithin(document.querySelector(`.grid-hand-p${seat}`)));
      handTiles = hands.sort((a, b) => b.length - a.length)[0] || [];
    }
    const candidates = candidateRows();
    const actualText = textOf(["[class*='actual']", "[class*='selected-action']", "[class*='player-action']"]);
    const recommendedText = textOf(["[class*='recommend']", "[class*='best-action']", "[class*='ai-action']"]);
    const seatText = textOf([".gi-p0", "[class*='player-info-p0']", "[class*='seat-p0']"]);
    const tilesLeftText = textOf([".info-tiles-left", "[class*='tiles-left']", "[class*='remaining']"]);
    const doraRoot = firstElement([".info-doras", "[class*='info-dora']", "[class*='dora-indicator']"]);
    const diagnostics = {
      handSelector: handRoot?.className || null,
      buttonTexts: [...document.querySelectorAll("button,[role=button],a")]
        .map((element) => String(element.textContent || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
        .filter(Boolean).slice(0, 80),
      pageTextSample: meta.body.slice(0, 1200)
    };
    return {
      title: document.title,
      handTiles,
      drawTile: handTiles.length % 3 === 2 ? handTiles.at(-1) : null,
      discardsBySeat: seatsFor("grid-discard-p"),
      callsBySeat: seatsFor("hand-calls-p"),
      claimedBySeat: [0, 1, 2, 3].map((seat) => {
        const root = document.querySelector(`.hand-calls-p${seat}`);
        return [...(root?.querySelectorAll?.("img.rotate,[class~='rotate'] img") || [])].map(tileFromImage).filter(Boolean);
      }),
      doraTiles: imagesWithin(doraRoot),
      tilesLeftText,
      roundText: textOf([".info-round", "[class*='info-round']"]) || meta.roundText,
      honba: meta.honba,
      seatText,
      actorText: textOf(["[class*='current-player']", "[class*='active-player']"]) || seatText,
      turn: meta.turn,
      scores: scoreTexts(),
      actualDiscard: parseTileFromText(actualText) || parseTileFromText(meta.body.match(/実打.{0,80}/)?.[0] || ""),
      recommendedDiscard: parseTileFromText(recommendedText) || candidates[0]?.tile || null,
      candidates,
      aiSummary: recommendedText,
      diagnostics
    };
  }

  function findControl(labels) {
    const controls = [...document.querySelectorAll("button,[role=button],a,input[type=button]")];
    for (const label of labels) {
      const exact = controls.find((element) => {
        const text = String(element.textContent || element.value || element.getAttribute("aria-label") || element.title || "")
          .replace(/\s+/g, "").toLowerCase();
        return text === label.replace(/\s+/g, "").toLowerCase();
      });
      if (exact) return exact;
    }
    for (const label of labels) {
      const partial = controls.find((element) => {
        const text = String(element.textContent || element.value || element.getAttribute("aria-label") || element.title || "")
          .replace(/\s+/g, "").toLowerCase();
        return text.includes(label.replace(/\s+/g, "").toLowerCase());
      });
      if (partial) return partial;
    }
    return null;
  }

  function navigate(kind) {
    const labels = {
      previous: ["前", "上一局", "前の局面", "Previous"],
      next: ["次", "下一局", "次の局面", "Next"],
      previousMistake: ["上一錯誤", "前のミス", "前違", "Previous Error"],
      nextMistake: ["下一錯誤", "次のミス", "次違", "Next Error"]
    };
    const control = findControl(labels[kind] || []);
    if (!control) return { ok: false, reason: "対応するBigCoach操作ボタンを見つけられませんでした", available: scrape().diagnostics.buttonTexts };
    control.scrollIntoView({ block: "center", inline: "center" });
    control.click();
    return { ok: true, text: String(control.textContent || control.getAttribute("aria-label") || "") };
  }

  window.__bigcoachDesktop = { scrape, navigate };
  return { ready: true };
})();
