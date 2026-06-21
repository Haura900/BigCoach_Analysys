"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isBigCoachCookie(cookie) {
  const domain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase();
  return domain === "bigcoach.work" || domain.endsWith(".bigcoach.work");
}

function cookieSetDetails(cookie) {
  const hostname = String(cookie.domain || "").replace(/^\./, "");
  const details = {
    url: `https://${hostname}${cookie.path || "/"}`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly)
  };
  if (String(cookie.domain || "").startsWith(".")) details.domain = cookie.domain;
  if (Number.isFinite(cookie.expirationDate)) details.expirationDate = cookie.expirationDate;
  if (["unspecified", "no_restriction", "lax", "strict"].includes(cookie.sameSite)) {
    details.sameSite = cookie.sameSite;
  }
  return details;
}

class AuthSessionStore {
  constructor({ electronSession, safeStorage, filePath, log = () => {} }) {
    this.session = electronSession;
    this.safeStorage = safeStorage;
    this.filePath = filePath;
    this.log = log;
    this.timer = null;
    this.listener = null;
  }

  async restore() {
    if (!fs.existsSync(this.filePath) || !this.safeStorage.isEncryptionAvailable()) return 0;
    try {
      const encrypted = fs.readFileSync(this.filePath);
      const cookies = JSON.parse(this.safeStorage.decryptString(encrypted));
      let restored = 0;
      for (const cookie of cookies) {
        if (!isBigCoachCookie(cookie)) continue;
        await this.session.cookies.set(cookieSetDetails(cookie));
        restored += 1;
      }
      await this.session.cookies.flushStore();
      this.log(`restored ${restored} encrypted BigCoach cookies`);
      return restored;
    } catch (error) {
      this.log(`failed to restore BigCoach login session: ${error.stack || error}`);
      return 0;
    }
  }

  async save() {
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.log("Windows secure storage is unavailable; BigCoach session backup was skipped");
      return 0;
    }
    try {
      const cookies = (await this.session.cookies.get({})).filter(isBigCoachCookie);
      const encrypted = this.safeStorage.encryptString(JSON.stringify(cookies));
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, encrypted);
      fs.renameSync(temporary, this.filePath);
      await this.session.cookies.flushStore();
      return cookies.length;
    } catch (error) {
      this.log(`failed to save BigCoach login session: ${error.stack || error}`);
      return 0;
    }
  }

  start() {
    if (this.listener) return;
    this.listener = (_event, cookie) => {
      if (!isBigCoachCookie(cookie)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.save().catch((error) => this.log(error.stack || error));
      }, 200);
    };
    this.session.cookies.on("changed", this.listener);
  }

  async flush() {
    clearTimeout(this.timer);
    await this.save();
  }
}

module.exports = { AuthSessionStore, isBigCoachCookie, cookieSetDetails };
