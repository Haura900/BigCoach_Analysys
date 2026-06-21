const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  AuthSessionStore,
  isBigCoachCookie,
  cookieSetDetails
} = require("../src/lib/auth-session");

test("BigCoachのAPI・画面Cookieだけを保存対象にする", () => {
  assert.equal(isBigCoachCookie({ domain: "api.bigcoach.work" }), true);
  assert.equal(isBigCoachCookie({ domain: ".bigcoach.work" }), true);
  assert.equal(isBigCoachCookie({ domain: "review.bigcoach.work" }), true);
  assert.equal(isBigCoachCookie({ domain: "example.com" }), false);
});

test("期限なしCookieを復元時もセッションCookieとして設定する", () => {
  const details = cookieSetDetails({
    domain: "api.bigcoach.work",
    path: "/",
    name: "session",
    value: "secret",
    secure: true,
    httpOnly: true,
    sameSite: "no_restriction"
  });
  assert.equal(details.url, "https://api.bigcoach.work/");
  assert.equal(details.expirationDate, undefined);
  assert.equal(details.httpOnly, true);
});

test("暗号化した認証Cookieを次回起動用に保存・復元する", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bigcoach-auth-"));
  const filePath = path.join(directory, "session.bin");
  let currentCookies = [{
    domain: "api.bigcoach.work",
    path: "/",
    name: "session",
    value: "encrypted-token",
    secure: true,
    httpOnly: true,
    session: true,
    sameSite: "no_restriction"
  }];
  const restored = [];
  const electronSession = {
    cookies: {
      get: async () => currentCookies,
      set: async (details) => restored.push(details),
      flushStore: async () => {},
      on: () => {}
    }
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8"),
    decryptString: (value) => value.toString("utf8")
  };
  const store = new AuthSessionStore({ electronSession, safeStorage, filePath });
  assert.equal(await store.save(), 1);
  currentCookies = [];
  assert.equal(await store.restore(), 1);
  assert.equal(restored[0].name, "session");
  assert.equal(restored[0].value, "encrypted-token");
  fs.rmSync(directory, { recursive: true, force: true });
});
