/**
 * Password sign-in against a real (in-process) Postgres.
 *
 * Written from the attacker's side. Every way of being wrong must look the same; guessing must
 * stop; a set-password link must be single-use and must never be a way in by itself; and a reset
 * must leave nothing minted before it alive.
 */
import { eq, openDb, schema, type DbHandle } from "@daymarkable/db";
import { defaultSettings } from "@daymarkable/pipeline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_FAILURES_PER_EMAIL, MAX_PASSWORD_LINKS_PER_HOUR, hashPassword } from "./password-core";
import { PASSWORD_LINK_TTL_MS, checkCredentials, mintPasswordToken, passwordTokenEmail, setPasswordWithToken } from "./sign-in";

let handle: DbHandle;
let n = 0;
const PASSWORD = "a long enough passphrase";

/** Who may sign in: anyone with an account, plus one invited address with none yet. */
const INVITED = "invited@example.com";
const maySignIn = async (email: string) => email === INVITED || !!(await handle.db.query.users.findFirst({ where: eq(schema.users.email, email) }));
const createAccount = async (email: string) => {
  const [u] = await handle.db.insert(schema.users).values({ email, timezone: "UTC", settings: defaultSettings() }).returning();
  return u!;
};
const deps = { maySignIn, createAccount };

async function account(opts: { password?: string } = {}) {
  const email = `user${++n}@example.com`;
  const [u] = await handle.db
    .insert(schema.users)
    .values({ email, timezone: "UTC", settings: defaultSettings(), passwordHash: opts.password ? await hashPassword(opts.password) : null })
    .returning();
  return u!;
}

beforeAll(async () => {
  handle = await openDb("pglite://memory");
  await handle.migrate();
});
afterAll(() => handle.close());

describe("checking a password at sign-in", () => {
  it("lets the right password through", async () => {
    const u = await account({ password: PASSWORD });
    expect(await checkCredentials(handle.db, u.email, PASSWORD, "1.1.1.1", maySignIn)).toEqual({ ok: true, userId: u.id });
  });

  /**
   * The reply reaches whoever typed the address. Wrong password, no password yet, no account, not
   * allowed in at all — all four must be the same answer, or the form says who has an account.
   */
  it("gives one answer for every way of being wrong", async () => {
    const withPw = await account({ password: PASSWORD });
    const noPw = await account();
    const same = { ok: false, reason: "credentials" };
    expect(await checkCredentials(handle.db, withPw.email, "wrong password!", "2.2.2.2", maySignIn)).toEqual(same);
    expect(await checkCredentials(handle.db, noPw.email, PASSWORD, "2.2.2.2", maySignIn)).toEqual(same);
    expect(await checkCredentials(handle.db, "nobody@example.com", PASSWORD, "2.2.2.2", maySignIn)).toEqual(same);
    expect(await checkCredentials(handle.db, INVITED, PASSWORD, "2.2.2.2", maySignIn)).toEqual(same);
  });

  it("records every attempt, right or wrong, without the password", async () => {
    const u = await account({ password: PASSWORD });
    await checkCredentials(handle.db, u.email, "nope nope nope", "3.3.3.3", maySignIn);
    await checkCredentials(handle.db, u.email, PASSWORD, "3.3.3.3", maySignIn);
    const rows = await handle.db.query.signInAttempts.findMany({ where: eq(schema.signInAttempts.email, u.email) });
    expect(rows.map((r) => r.success)).toEqual([false, true]);
    expect(JSON.stringify(rows)).not.toContain("nope");
  });

  /** Even the RIGHT password is refused while an address is locked — otherwise guessing just continues. */
  it("stops listening to an address after its share of wrong guesses", async () => {
    const u = await account({ password: PASSWORD });
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) await checkCredentials(handle.db, u.email, `guess ${i} guess`, `9.9.9.${i}`, maySignIn);
    const r = await checkCredentials(handle.db, u.email, PASSWORD, "4.4.4.4", maySignIn);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("locked");
    // And lets it back in once the window has passed.
    const later = new Date(Date.now() + 16 * 60_000);
    expect((await checkCredentials(handle.db, u.email, PASSWORD, "4.4.4.4", maySignIn, later)).ok).toBe(true);
  });
});

describe("setting a password from an emailed link", () => {
  it("sets the first password and keeps existing sessions — they were made by this mailbox too", async () => {
    const u = await account();
    await handle.db.insert(schema.sessions).values({ id: `s-${++n}`, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) });
    const t = (await mintPasswordToken(handle.db, u.email))!;
    const r = await setPasswordWithToken(handle.db, t.token, PASSWORD, deps);
    expect(r).toMatchObject({ ok: true, replaced: false, created: false });
    expect((await checkCredentials(handle.db, u.email, PASSWORD, "5.5.5.5", maySignIn)).ok).toBe(true);
    expect(await handle.db.query.sessions.findMany({ where: eq(schema.sessions.userId, u.id) })).toHaveLength(1);
  });

  /** A reset may be because someone else had the password. Every session they might hold goes. */
  it("signs the account out everywhere when a password is replaced", async () => {
    const u = await account({ password: PASSWORD });
    await handle.db.insert(schema.sessions).values([
      { id: `s-${++n}`, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) },
      { id: `s-${++n}`, userId: u.id, expiresAt: new Date(Date.now() + 3600_000), client: "mobile" },
    ]);
    const t = (await mintPasswordToken(handle.db, u.email))!;
    expect(await setPasswordWithToken(handle.db, t.token, "a brand new passphrase", deps)).toMatchObject({ ok: true, replaced: true });
    expect(await handle.db.query.sessions.findMany({ where: eq(schema.sessions.userId, u.id) })).toHaveLength(0);
    expect((await checkCredentials(handle.db, u.email, PASSWORD, "6.6.6.6", maySignIn)).ok).toBe(false);
  });

  it("works once", async () => {
    const u = await account();
    const t = (await mintPasswordToken(handle.db, u.email))!;
    expect((await setPasswordWithToken(handle.db, t.token, PASSWORD, deps)).ok).toBe(true);
    const again = await setPasswordWithToken(handle.db, t.token, "someone else's choice", deps);
    expect(again).toMatchObject({ ok: false, spent: true });
    expect(await passwordTokenEmail(handle.db, t.token)).toBeNull();
  });

  /** A password that is too short should be fixable in place, not cost another trip to the mailbox. */
  it("keeps the link alive when the password itself is refused", async () => {
    const u = await account();
    const t = (await mintPasswordToken(handle.db, u.email))!;
    expect(await setPasswordWithToken(handle.db, t.token, "short", deps)).toMatchObject({ ok: false, spent: false });
    expect(await passwordTokenEmail(handle.db, t.token)).toBe(u.email);
    expect((await setPasswordWithToken(handle.db, t.token, PASSWORD, deps)).ok).toBe(true);
  });

  it("refuses an expired link", async () => {
    const u = await account();
    const t = (await mintPasswordToken(handle.db, u.email))!;
    const late = new Date(Date.now() + PASSWORD_LINK_TTL_MS + 1000);
    expect(await setPasswordWithToken(handle.db, t.token, PASSWORD, deps, late)).toMatchObject({ ok: false, spent: true });
  });

  /** Nothing minted under the old password — another reset link, a pending sign-in link — survives the change. */
  it("spends every other outstanding link for the address", async () => {
    const u = await account({ password: PASSWORD });
    const first = (await mintPasswordToken(handle.db, u.email))!;
    const second = (await mintPasswordToken(handle.db, u.email))!;
    await handle.db.insert(schema.loginTokens).values({ tokenHash: `login-${++n}`, email: u.email, expiresAt: new Date(Date.now() + 600_000) });
    expect((await setPasswordWithToken(handle.db, first.token, "a fresh passphrase here", deps)).ok).toBe(true);
    expect(await passwordTokenEmail(handle.db, second.token)).toBeNull();
    const logins = await handle.db.query.loginTokens.findMany({ where: eq(schema.loginTokens.email, u.email) });
    expect(logins.every((l) => l.usedAt !== null)).toBe(true);
  });

  /** An invited address has no account until now; the account begins when its first password is set. */
  it("opens the account of an invited address", async () => {
    const t = (await mintPasswordToken(handle.db, INVITED))!;
    expect(await setPasswordWithToken(handle.db, t.token, PASSWORD, deps)).toMatchObject({ ok: true, created: true, replaced: false });
    expect((await checkCredentials(handle.db, INVITED, PASSWORD, "7.7.7.7", maySignIn)).ok).toBe(true);
  });

  /** The invariant: a set-password link is not a login link, in any table /auth/verify reads. */
  it("never creates a session, and never lands in login_tokens", async () => {
    const u = await account();
    const t = (await mintPasswordToken(handle.db, u.email))!;
    await setPasswordWithToken(handle.db, t.token, PASSWORD, deps);
    expect(await handle.db.query.sessions.findMany({ where: eq(schema.sessions.userId, u.id) })).toHaveLength(0);
    expect(await handle.db.query.loginTokens.findFirst({ where: eq(schema.loginTokens.tokenHash, t.tokenHash) })).toBeUndefined();
  });

  it("stops minting links for an address after a few in an hour", async () => {
    const u = await account();
    for (let i = 0; i < MAX_PASSWORD_LINKS_PER_HOUR; i++) expect(await mintPasswordToken(handle.db, u.email)).not.toBeNull();
    expect(await mintPasswordToken(handle.db, u.email)).toBeNull();
    expect(await mintPasswordToken(handle.db, u.email, new Date(Date.now() + 3600_000 + 1000))).not.toBeNull();
  });
});
