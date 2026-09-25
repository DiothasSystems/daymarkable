/**
 * Sign-in with a password, then an emailed link — the database half.
 *
 *   1. The customer types an address and a password (`checkCredentials`). Only when both are right
 *      is a sign-in link minted and mailed (auth.ts). The link is what creates a session, exactly as
 *      before; what changed is that a link can no longer be asked for with an address alone.
 *   2. An account has no password until the customer sets one from an emailed link
 *      (`mintPasswordToken`, `setPasswordWithToken`) — the first time, and after forgetting it.
 *
 * THE INVARIANT: a session is created in one place, /auth/verify, from a login link, and a login
 * link is minted in one place, after a correct password. Setting a password does NOT sign anyone
 * in; it sends them back to sign in with it. Set-password links live in their own table
 * (password_tokens), which /auth/verify never reads, so one cannot be spent as a login link however
 * the code around it changes.
 *
 * Every function takes `db` (and whatever else it needs) rather than reaching for the runtime, as
 * device-login.ts does, so the whole flow is tested against PGlite without a request.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, gte, isNull, or, schema, type Db } from "@daymarkable/db";
import {
  MAX_PASSWORD_LINKS_PER_HOUR,
  SIGN_IN_WINDOW_MS,
  dummyHash,
  hashPassword,
  signInLocked,
  validateNewPassword,
  verifyPassword,
} from "./password-core";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** How long a set-password link works. Long enough to find the mail; short enough to be spent. */
export const PASSWORD_LINK_TTL_MS = 30 * 60_000;

export type CredentialResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "credentials" }
  | { ok: false; reason: "locked"; retryAfterMs: number };

/**
 * Is this the right password for this address? Records the attempt either way.
 *
 * One answer covers every way of being wrong — an address that may not sign in, no account, an
 * account with no password yet, the wrong password — because the reply reaches whoever typed the
 * address rather than its owner (rule 15), and must not say which of those it was. They take the
 * same time too: without a real hash to check, it checks against a dummy one.
 */
export async function checkCredentials(
  db: Db,
  email: string,
  password: string,
  ip: string,
  maySignIn: (email: string) => Promise<boolean>,
  now = new Date(),
): Promise<CredentialResult> {
  const since = new Date(now.getTime() - SIGN_IN_WINDOW_MS);
  const recent = await db.query.signInAttempts.findMany({
    where: and(gte(schema.signInAttempts.createdAt, since), or(eq(schema.signInAttempts.email, email), eq(schema.signInAttempts.ip, ip))),
  });
  const lock = signInLocked(recent, email, ip, now.getTime());
  // A locked attempt is not recorded: counting it would let the lock extend itself indefinitely.
  if (lock.locked) return { ok: false, reason: "locked", retryAfterMs: lock.retryAfterMs };

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const allowed = await maySignIn(email);
  const stored = allowed && user?.passwordHash ? user.passwordHash : await dummyHash();
  const matches = await verifyPassword(password, stored);
  const ok = !!(allowed && user?.passwordHash && matches);

  await db.insert(schema.signInAttempts).values({ email, ip, success: ok, createdAt: now });
  return ok ? { ok: true, userId: user!.id } : { ok: false, reason: "credentials" };
}

/**
 * A set-password link for this address, or null when it has had its share this hour.
 *
 * The caller decides whether the address may sign in at all, and answers the same either way; this
 * only mints. The hourly cap is counted from the tokens themselves, so it needs no table of its own.
 */
export async function mintPasswordToken(db: Db, email: string, now = new Date()): Promise<{ token: string; tokenHash: string } | null> {
  const hourAgo = new Date(now.getTime() - 3600_000);
  const sent = await db.query.passwordTokens.findMany({ where: and(eq(schema.passwordTokens.email, email), gte(schema.passwordTokens.createdAt, hourAgo)) });
  if (sent.length >= MAX_PASSWORD_LINKS_PER_HOUR) return null;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  await db.insert(schema.passwordTokens).values({ tokenHash, email, expiresAt: new Date(now.getTime() + PASSWORD_LINK_TTL_MS), createdAt: now });
  return { token, tokenHash };
}

/**
 * The address a set-password link is for, or null if the link is spent or expired — so the page can
 * say so before anyone types, and name the account so a password manager files the new password
 * under the right username. Tells the holder nothing new: they have the mail, so they have the
 * mailbox.
 */
export async function passwordTokenEmail(db: Db, token: string, now = new Date()): Promise<string | null> {
  const row = await db.query.passwordTokens.findFirst({
    where: and(eq(schema.passwordTokens.tokenHash, sha256(token)), isNull(schema.passwordTokens.usedAt), gt(schema.passwordTokens.expiresAt, now)),
  });
  return row?.email ?? null;
}

export type SetPasswordResult =
  | { ok: true; email: string; userId: string; replaced: boolean; created: boolean }
  | { ok: false; message: string; spent: boolean };

const EXPIRED = "This link has expired or has already been used. Ask for a new one from the sign-in page.";

/**
 * Set a password from an emailed link.
 *
 * A rejected password does NOT spend the link — the customer should be able to fix a too-short
 * password without waiting for another mail. Everything that does succeed spends it, atomically, so
 * the same link cannot be used twice even by two tabs at once.
 *
 * Replacing a password signs the account out everywhere: whoever reset it may be doing so because
 * someone else had it. Setting the FIRST one does not — every existing session was made by a login
 * link to this mailbox, which is the same proof the link here rests on. Either way, every other
 * outstanding link for the address is spent, so nothing minted before the change outlives it.
 */
export async function setPasswordWithToken(
  db: Db,
  token: string,
  password: string,
  deps: { maySignIn: (email: string) => Promise<boolean>; createAccount: (email: string) => Promise<{ id: string; passwordHash: string | null }> },
  now = new Date(),
): Promise<SetPasswordResult> {
  const tokenHash = sha256(token);
  const row = await db.query.passwordTokens.findFirst({
    where: and(eq(schema.passwordTokens.tokenHash, tokenHash), isNull(schema.passwordTokens.usedAt), gt(schema.passwordTokens.expiresAt, now)),
  });
  if (!row) return { ok: false, message: EXPIRED, spent: true };

  const check = validateNewPassword(password, row.email);
  if (!check.ok) return { ok: false, message: check.message, spent: false };

  // Access can be withdrawn between the mail and the click (an invitation revoked, say).
  if (!(await deps.maySignIn(row.email))) {
    await db.update(schema.passwordTokens).set({ usedAt: now }).where(eq(schema.passwordTokens.tokenHash, tokenHash));
    return { ok: false, message: EXPIRED, spent: true };
  }

  const hash = await hashPassword(password);
  // Spend it first, conditionally: of two simultaneous submissions exactly one gets a row back.
  const spent = await db
    .update(schema.passwordTokens)
    .set({ usedAt: now })
    .where(and(eq(schema.passwordTokens.tokenHash, tokenHash), isNull(schema.passwordTokens.usedAt)))
    .returning();
  if (spent.length === 0) return { ok: false, message: EXPIRED, spent: true };

  let user = await db.query.users.findFirst({ where: eq(schema.users.email, row.email) });
  let created = false;
  if (!user) {
    // An invited address setting its first password: this is where its account now begins, since
    // a password has to live on an account before it can be checked.
    await deps.createAccount(row.email);
    user = await db.query.users.findFirst({ where: eq(schema.users.email, row.email) });
    created = true;
  }
  const replaced = !!user!.passwordHash;
  await db.update(schema.users).set({ passwordHash: hash, passwordSetAt: now, updatedAt: now }).where(eq(schema.users.id, user!.id));

  await db
    .update(schema.passwordTokens)
    .set({ usedAt: now })
    .where(and(eq(schema.passwordTokens.email, row.email), isNull(schema.passwordTokens.usedAt)));
  await db
    .update(schema.loginTokens)
    .set({ usedAt: now })
    .where(and(eq(schema.loginTokens.email, row.email), isNull(schema.loginTokens.usedAt)));
  if (replaced) await db.delete(schema.sessions).where(eq(schema.sessions.userId, user!.id));

  return { ok: true, email: row.email, userId: user!.id, replaced, created };
}
