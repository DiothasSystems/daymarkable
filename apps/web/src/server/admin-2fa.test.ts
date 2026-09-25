/**
 * The admin portal's second factor, from the attacker's side.
 *
 * The properties that matter: a code works once, for its own challenge only, within its ten
 * minutes; guessing stops after five; the pointer the browser holds cannot be forged, and cannot be
 * mistaken for a session — nor a session for it.
 */
import { eq, openDb, schema, type DbHandle } from "@daymarkable/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerChallenge, createChallenge } from "./admin-2fa";
import {
  ADMIN_CODE_MAX_TRIES,
  ADMIN_CODE_TTL_MS,
  admin2faEmailFromEnv,
  adminCodeDigest,
  issueAdminToken,
  issuePendingToken,
  newAdminCode,
  verifyAdminToken,
  verifyPendingToken,
} from "./admin-core";

const cfg = { loginId: "ops", passwordHash: "$2b$04$x", signingKey: "secret" };
const env = (v?: string) => ({ ADMIN_2FA_EMAIL: v }) as unknown as NodeJS.ProcessEnv;

describe("configuration", () => {
  it("reads the address, and treats unset, empty or malformed as OFF — the break-glass", () => {
    expect(admin2faEmailFromEnv(env("DiothasSystems@Gmail.com "))).toBe("diothassystems@gmail.com");
    expect(admin2faEmailFromEnv(env(undefined))).toBeNull();
    expect(admin2faEmailFromEnv(env(""))).toBeNull();
    expect(admin2faEmailFromEnv(env("not an address"))).toBeNull();
  });
});

describe("codes and the pointer to them", () => {
  it("makes six-digit codes, zero-padded", () => {
    for (let i = 0; i < 200; i++) expect(newAdminCode()).toMatch(/^\d{6}$/);
  });

  /** Keyed and bound to its challenge: a stored digest is no help against any other challenge. */
  it("digests a code differently per challenge and per key", () => {
    expect(adminCodeDigest(cfg, "a", "123456")).not.toBe(adminCodeDigest(cfg, "b", "123456"));
    expect(adminCodeDigest(cfg, "a", "123456")).not.toBe(adminCodeDigest({ ...cfg, signingKey: "other" }, "a", "123456"));
  });

  it("round-trips the pointer, expires it, and refuses tampering", () => {
    const t = issuePendingToken(cfg, "chal-1", 1_000_000);
    expect(verifyPendingToken(cfg, t, 1_000_001)).toEqual({ ok: true, challengeId: "chal-1" });
    expect(verifyPendingToken(cfg, t, 1_000_000 + ADMIN_CODE_TTL_MS + 1)).toMatchObject({ ok: false, reason: "expired" });
    expect(verifyPendingToken(cfg, `${t}x`).ok).toBe(false);
    expect(verifyPendingToken({ ...cfg, signingKey: "other" }, t).ok).toBe(false);
  });

  /**
   * The one that would be a real hole: if the half-way pointer passed as a session, the password
   * alone would open the portal and the code would be decoration.
   */
  it("never lets the pointer pass as a session, or a session as the pointer", () => {
    const pending = issuePendingToken(cfg, "chal-1");
    expect(verifyAdminToken(cfg, pending).ok).toBe(false);
    expect(verifyPendingToken(cfg, issueAdminToken(cfg)).ok).toBe(false);
  });
});

describe("answering a challenge", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await openDb("pglite://memory");
    await handle.migrate();
  });
  afterAll(() => handle.close());

  const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

  it("accepts the right code once", async () => {
    const c = await createChallenge(handle.db, cfg, "1.1.1.1");
    expect(await answerChallenge(handle.db, cfg, c.id, c.code)).toEqual({ ok: true });
    expect(await answerChallenge(handle.db, cfg, c.id, c.code)).toEqual({ ok: false, reason: "restart" });
  });

  it("stores a digest, never the code", async () => {
    const c = await createChallenge(handle.db, cfg, "1.1.1.1");
    const row = await handle.db.query.adminLoginChallenges.findFirst({ where: eq(schema.adminLoginChallenges.id, c.id) });
    expect(row!.codeDigest).not.toContain(c.code);
    expect(row!.codeDigest).toBe(adminCodeDigest(cfg, c.id, c.code));
  });

  it("counts wrong codes down, then spends the challenge — even for the right code after", async () => {
    const c = await createChallenge(handle.db, cfg, "2.2.2.2");
    for (let i = 1; i < ADMIN_CODE_MAX_TRIES; i++) {
      expect(await answerChallenge(handle.db, cfg, c.id, wrong(c.code))).toEqual({ ok: false, reason: "wrong", triesLeft: ADMIN_CODE_MAX_TRIES - i });
    }
    expect(await answerChallenge(handle.db, cfg, c.id, wrong(c.code))).toEqual({ ok: false, reason: "restart" });
    expect(await answerChallenge(handle.db, cfg, c.id, c.code)).toEqual({ ok: false, reason: "restart" });
  });

  it("refuses a code after its ten minutes", async () => {
    const c = await createChallenge(handle.db, cfg, "3.3.3.3");
    const late = new Date(Date.now() + ADMIN_CODE_TTL_MS + 1000);
    expect(await answerChallenge(handle.db, cfg, c.id, c.code, late)).toEqual({ ok: false, reason: "restart" });
  });

  /** A code mailed for one sign-in is no key to another. */
  it("does not accept one challenge's code for another", async () => {
    const a = await createChallenge(handle.db, cfg, "4.4.4.4");
    const b = await createChallenge(handle.db, cfg, "4.4.4.4");
    if (a.code !== b.code) expect((await answerChallenge(handle.db, cfg, b.id, a.code)).ok).toBe(false);
    expect(await answerChallenge(handle.db, cfg, b.id, b.code)).toEqual({ ok: true });
  });

  it("answers a made-up or malformed challenge id the same as a spent one", async () => {
    expect(await answerChallenge(handle.db, cfg, "00000000-0000-0000-0000-000000000000", "123456")).toEqual({ ok: false, reason: "restart" });
    expect(await answerChallenge(handle.db, cfg, "'; drop table users; --", "123456")).toEqual({ ok: false, reason: "restart" });
  });

  it("does not take non-digits, or a code with extra digits, as a guess worth checking", async () => {
    const c = await createChallenge(handle.db, cfg, "5.5.5.5");
    expect((await answerChallenge(handle.db, cfg, c.id, `${c.code}0`)).ok).toBe(false);
    expect((await answerChallenge(handle.db, cfg, c.id, " " + c.code + " ")).ok).toBe(true);
  });
});
