"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const REVIEW_URL = process.argv[2] || "https://gokujan.com/review/49cd51c090524b84";
const DEBUG_PORT = Number(process.env.BIGCOACH_E2E_PORT || 9339);
const ROOT = path.resolve(__dirname, "..");
const USE_STARTUP_URL = process.env.BIGCOACH_E2E_STARTUP_URL !== "0";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error(`timeout: ${url}`));
    });
  });
}

async function waitForTargets() {
  const deadline = Date.now() + 30000;
  let lastError;
  let lastTargets = [];
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (Array.isArray(targets)) {
        lastTargets = targets;
        if (targets.some((item) =>
          item.type === "page" && /renderer\/index\.html|BigCoach Anki Studio/.test(`${item.url} ${item.title}`))) {
          return targets;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  if (lastTargets.length) {
    throw new Error(`app target was not exposed: ${lastTargets.map((item) => `${item.type}:${item.title}:${item.url}`).join(" | ")}`);
  }
  throw lastError || new Error("remote debugging targets were not exposed");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 10000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(event.error || new Error("CDP websocket error"));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    this.socket.send(payload);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 120000);
    });
  }

  async eval(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

async function elementCenter(cdp, selector) {
  return cdp.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
}

async function click(cdp, selector) {
  const point = await elementCenter(cdp, selector);
  if (!point || point.width <= 0 || point.height <= 0) throw new Error(`click target not found: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function clickHandler(cdp, selector) {
  await cdp.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("click target not found");
    setTimeout(() => element.click(), 0);
    return true;
  })()`, false);
}

async function setInput(cdp, selector, value) {
  await cdp.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("input not found");
    setTimeout(() => {
      element.focus();
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, 0);
    return true;
  })()`, false);
}

async function waitFor(cdp, label, predicateSource, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await cdp.eval(`(${predicateSource})()`);
    if (last?.ok) return last;
    if (last?.error) throw new Error(`${label}: ${last.error}`);
    await sleep(500);
  }
  throw new Error(`${label} timed out. last=${JSON.stringify(last)}`);
}

async function dumpBigCoachDiagnostics() {
  const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const target = targets.find((item) =>
    item.type === "page" && /^https:\/\/(?:gokujan\.com|review\.bigcoach\.work)\/review\//.test(item.url));
  if (!target) return;
  const page = new Cdp(target.webSocketDebuggerUrl);
  try {
    await page.connect();
    await page.send("Runtime.enable");
    const diagnostics = await page.eval(`(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
      };
      const text = (element) => String(element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
      return {
        url: location.href,
        bodyStart: text(document.body).slice(0, 1200),
        checkboxes: [...document.querySelectorAll('input[type="checkbox"]')].map((input) => ({
          checked: input.checked,
          aria: input.getAttribute("aria-label") || "",
          text: text(input.closest("label") || input.parentElement)
        })),
        buttons: [...document.querySelectorAll("button, [role='button']")].filter(visible).map((button) => text(button)).slice(0, 40),
        tableTexts: [...document.querySelectorAll("table, [role='table'], [class*='analysis'], [class*='eval'], [class*='result'], [class*='candidate'], div")]
          .filter(visible)
          .map((element) => text(element))
          .filter((value) => value && /(AI|操作|P|Lance|Mortal|切|候補|Discard|Candidate)/i.test(value))
          .slice(0, 30)
      };
    })()`);
    console.error("BigCoach diagnostics:", JSON.stringify(diagnostics, null, 2));
  } finally {
    page.close();
  }
}

async function main() {
  const electron = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  const e2eUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bigcoach-e2e-"));
  const env = {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: "1",
    BIGCOACH_E2E_USER_DATA_DIR: e2eUserDataDir
  };
  if (USE_STARTUP_URL) env.BIGCOACH_E2E_REVIEW_URL = REVIEW_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [".", `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    windowsHide: false
  });
  let stderr = "";
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  let cdp;
  try {
    console.error("waiting for CDP targets");
    const targets = await waitForTargets();
    const target = targets.find((item) =>
      item.type === "page" && /renderer\/index\.html|BigCoach Anki Studio/.test(`${item.url} ${item.title}`));
    if (!target) {
      throw new Error(`app target not found: ${targets.map((item) => `${item.type}:${item.title}:${item.url}`).join(" | ")}`);
    }
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.bringToFront");

    console.error("waiting for app ready");
    await waitFor(cdp, "app ready", `() => ({
      ok: Boolean(document.querySelector("#review-url") && window.bigcoachApp),
      href: location.href
    })`, 30000);

    if (!USE_STARTUP_URL) {
      console.error("opening review URL from UI");
      await setInput(cdp, "#review-url", REVIEW_URL);
      await clickHandler(cdp, "#open-review-url");
      await sleep(500);
      const firstOpenBusy = await cdp.eval(`!document.querySelector("#busy")?.classList.contains("hidden")`);
      if (!firstOpenBusy) await clickHandler(cdp, "#open-review-url");
      const openStarted = await cdp.eval(`(() => {
        const busy = !document.querySelector("#busy")?.classList.contains("hidden");
        const title = document.querySelector("#scene-title")?.textContent || "";
        return { busy, title };
      })()`);
      if (!openStarted.busy && /解析済み局面/.test(openStarted.title)) {
        await clickHandler(cdp, "#open-review-url");
      }
    } else {
      console.error("refreshing startup review URL from UI");
      await clickHandler(cdp, "#refresh-scene");
      await sleep(500);
      const refreshStarted = await cdp.eval(`(() => ({
        busy: !document.querySelector("#busy")?.classList.contains("hidden")
      }))()`);
      if (!refreshStarted.busy) await clickHandler(cdp, "#refresh-scene");
    }

    console.error("waiting for scene loaded");
    let scene;
    try {
      scene = await waitFor(cdp, "scene loaded", `() => {
      const toast = document.querySelector("#toast");
      const title = document.querySelector("#scene-title")?.textContent || "";
      const chips = document.querySelector("#scene-chips")?.textContent || "";
      const busy = !document.querySelector("#busy")?.classList.contains("hidden");
      const error = toast && !toast.classList.contains("hidden") && toast.classList.contains("error")
        ? toast.textContent
        : "";
      return { ok: !busy && /手牌|mpsz|[0-9]+m|[0-9]+p|[0-9]+s/.test(chips), title, chips, error };
      }`, 180000);
    } catch (error) {
      await dumpBigCoachDiagnostics().catch((diagnosticError) =>
        console.error("BigCoach diagnostics failed:", diagnosticError.stack || diagnosticError));
      throw error;
    }

    console.error("clicking preview card");
    await clickHandler(cdp, "#preview-card");
    await sleep(500);
    const previewStarted = await cdp.eval(`(() => ({
      busy: !document.querySelector("#busy")?.classList.contains("hidden"),
      open: Boolean(document.querySelector("#preview-dialog")?.open)
    }))()`);
    if (!previewStarted.busy && !previewStarted.open) {
      await clickHandler(cdp, "#preview-card");
    }
    console.error("waiting for preview dialog");
    let preview;
    try {
      preview = await waitFor(cdp, "preview opened", `() => {
      const dialog = document.querySelector("#preview-dialog");
      const toast = document.querySelector("#toast");
      const busy = !document.querySelector("#busy")?.classList.contains("hidden");
      const error = toast && !toast.classList.contains("hidden") && toast.classList.contains("error")
        ? toast.textContent
        : "";
      if (error) return { ok: false, error };
      return {
        ok: Boolean(dialog?.open),
        busy,
        frontText: document.querySelector("#front-preview")?.textContent || "",
        backText: document.querySelector("#back-preview")?.textContent || "",
        deckCount: document.querySelector("#preview-deck")?.options?.length || 0
      };
    }`, 180000);
    } catch (error) {
      await dumpBigCoachDiagnostics().catch((diagnosticError) =>
        console.error("BigCoach diagnostics failed:", diagnosticError.stack || diagnosticError));
      throw error;
    }

    console.log(JSON.stringify({
      ok: true,
      reviewUrl: REVIEW_URL,
      sceneTitle: scene.title,
      sceneChips: scene.chips,
      frontText: preview.frontText.trim().slice(0, 120),
      backText: preview.backText.trim().slice(0, 240),
      deckCount: preview.deckCount
    }, null, 2));

    if (process.env.VERIFY_ANKI_REGISTER === "1") {
      console.error("clicking register card");
      await clickHandler(cdp, "#register-card");
      const registered = await waitFor(cdp, "registered", `() => {
        const dialog = document.querySelector("#preview-dialog");
        const toast = document.querySelector("#toast");
        const busy = !document.querySelector("#busy")?.classList.contains("hidden");
        const toastText = toast?.textContent || "";
        const error = toast && !toast.classList.contains("hidden") && toast.classList.contains("error")
          ? toastText
          : "";
        if (error) return { ok: false, error };
        return {
          ok: !busy && !dialog?.open && /Ankiカードを登録しました|既存カードを更新しました|重複カード/.test(toastText),
          toastText
        };
      }`, 120000);
      console.log(JSON.stringify({ registered: true, toastText: registered.toastText }, null, 2));
    }
  } finally {
    try {
      const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      console.error("CDP targets:", targets.map((item) => `${item.type}:${item.title}:${item.url}`).join(" | "));
    } catch {}
    cdp?.close();
    child.kill();
    await sleep(1000);
    if (child.exitCode === null) child.kill("SIGKILL");
    if (stderr.trim()) console.error(stderr.trim().slice(-2000));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
