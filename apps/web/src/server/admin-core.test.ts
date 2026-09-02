import { describe, expect, it } from "vitest";
import { ADMIN_SESSION_TTL_MS, adminConfigFromEnv, checkAdminCredentials, hashAdminPassword, issueAdminToken, loginLocked, verifyAdminToken } from "./admin-core.js";

describe("admin config", () => {
  it("requires login id, a bcrypt hash (never plaintext), and the data key", async () => {
    const hash = await hashAdminPassword("correct horse", 4);
    expect(adminConfigFromEnv({ ADMIN_LOGIN_ID: "ops", ADMIN_PASSWORD_HASH: "plaintext!", DATA_ENCRYPTION_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(adminConfigFromEnv({ ADMIN_LOGIN_ID: "ops", ADMIN_PASSWORD_HASH: hash } as unknown as NodeJS.ProcessEnv)).toBeNull();
    const cfg = adminConfigFromEnv({ ADMIN_LOGIN_ID: "ops", ADMIN_PASSWORD_HASH: hash, DATA_ENCRYPTION_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    expect(cfg).not.toBeNull();
    expect(await checkAdminCredentials(cfg!, "ops", "correct horse")).toBe(true);
    expect(await checkAdminCredentials(cfg!, "ops", "wrong")).toBe(false);
    expect(await checkAdminCredentials(cfg!, "root", "correct horse")).toBe(false);
  });
});

describe("admin session token", () => {
  const cfg = { loginId: "ops", passwordHash: "$2b$04$x", signingKey: "secret" };
  it("round-trips, expires, and rejects tampering or another key", () => {
    const t = issueAdminToken(cfg, 1_000_000);
    expect(verifyAdminToken(cfg, t, 1_000_001).ok).toBe(true);
    expect(verifyAdminToken(cfg, t, 1_000_000 + ADMIN_SESSION_TTL_MS + 1)).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyAdminToken(cfg, `${t}x`).ok).toBe(false);
    expect(verifyAdminToken({ ...cfg, signingKey: "other" }, t).ok).toBe(false);
    expect(verifyAdminToken(cfg, undefined).ok).toBe(false);
  });
});

describe("rate limiting", () => {
  const at = (ip: string, success: boolean, minutesAgo: number, now: number) => ({ ip, success, createdAt: new Date(now - minutesAgo * 60_000) });
  it("locks an IP after five recent failures and forgets old ones", () => {
    const now = Date.now();
    const rows = [1, 2, 3, 4, 5].map((m) => at("1.1.1.1", false, m, now));
    expect(loginLocked(rows, "1.1.1.1", now).locked).toBe(true);
    expect(loginLocked(rows, "2.2.2.2", now).locked).toBe(false);
    expect(loginLocked(rows.map((r) => ({ ...r, createdAt: new Date(now - 20 * 60_000) })), "1.1.1.1", now).locked).toBe(false);
    expect(loginLocked([...rows.slice(0, 4), at("1.1.1.1", true, 0, now)], "1.1.1.1", now).locked).toBe(false);
  });
  it("locks everyone after twenty failures across IPs", () => {
    const now = Date.now();
    const rows = Array.from({ length: 20 }, (_, i) => at(`10.0.0.${i}`, false, 1, now));
    expect(loginLocked(rows, "9.9.9.9", now).locked).toBe(true);
  });
});
