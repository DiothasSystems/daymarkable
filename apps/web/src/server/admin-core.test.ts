import { describe, expect, it } from "vitest";
import { ADMIN_SESSION_TTL_MS, TUNING_MAX, TUNING_MIN, adminConfigFromEnv, checkAdminCredentials, hashAdminPassword, issueAdminToken, loginLocked, matchesUserQuery, validateTuning, verifyAdminToken } from "./admin-core.js";

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

describe("validateTuning", () => {
  const retired = (m: string) => m === "claude-haiku-4-5";
  const ok = { confidenceThreshold: 0.7, decodeModel: null, escalationModel: null };

  it("accepts a threshold inside the range and no overrides", () => {
    expect(validateTuning(ok, retired, "claude-sonnet-5")).toEqual({ ok: true });
    expect(validateTuning({ ...ok, confidenceThreshold: TUNING_MIN }, retired, "claude-sonnet-5").ok).toBe(true);
    expect(validateTuning({ ...ok, confidenceThreshold: TUNING_MAX }, retired, "claude-sonnet-5").ok).toBe(true);
  });

  it("refuses a threshold outside the range, and a missing one", () => {
    // An empty form field arrives as Number("") === 0, so the range check is what catches it.
    for (const t of [0.29, 0.96, -1, 2, Number("")]) {
      const r = validateTuning({ ...ok, confidenceThreshold: t }, retired, "claude-sonnet-5");
      expect(r.ok).toBe(false);
    }
    // A field with junk in it arrives as NaN, which slips through every comparison silently.
    const nan = validateTuning({ ...ok, confidenceThreshold: Number("high") }, retired, "claude-sonnet-5");
    expect(nan).toEqual({ ok: false, message: "Confidence threshold must be a number" });
  });

  it("refuses a retired model in either slot rather than quietly substituting", () => {
    const a = validateTuning({ ...ok, decodeModel: "claude-haiku-4-5" }, retired, "claude-sonnet-5");
    const b = validateTuning({ ...ok, escalationModel: "claude-haiku-4-5" }, retired, "claude-sonnet-5");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.message).toContain("retired");
  });

  it("allows a model that is not retired", () => {
    expect(validateTuning({ ...ok, decodeModel: "claude-opus-5", escalationModel: "claude-opus-5" }, retired, "claude-sonnet-5").ok).toBe(true);
  });
});

describe("matchesUserQuery", () => {
  const u = { email: "jane@example.com", status: "active", plan: "annual", role: "Student", industry: "university — mechanical engineering" };

  it("matches any field, case-insensitively", () => {
    for (const q of ["jane", "EXAMPLE.COM", "active", "annual", "student", "mechanical"]) {
      expect(matchesUserQuery(u, q)).toBe(true);
    }
  });

  it("requires every term, so a second word narrows rather than widens", () => {
    expect(matchesUserQuery(u, "student annual")).toBe(true);
    expect(matchesUserQuery(u, "student monthly")).toBe(false);
  });

  it("matches everything on an empty or whitespace query", () => {
    expect(matchesUserQuery(u, "")).toBe(true);
    expect(matchesUserQuery(u, "   ")).toBe(true);
  });

  it("does not trip over an account with no role or plan recorded", () => {
    const bare = { email: "a@b.co", status: "trial", plan: null, role: null, industry: null };
    expect(matchesUserQuery(bare, "trial")).toBe(true);
    expect(matchesUserQuery(bare, "student")).toBe(false);
  });
});
