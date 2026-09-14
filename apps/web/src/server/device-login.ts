/**
 * Sign-in for a native client, without deep links.
 *
 * The web's magic link puts a cookie in the browser that opened it. A phone has no cookie jar we
 * can reach, and the link is very often opened on a different device from the one signing in, so
 * a `daymarkable://` callback would fail in the ordinary case rather than the exotic one. What
 * works everywhere is for the app to hold a secret and wait:
 *
 *   1. the app asks for a link and keeps a `pollSecret` (this module mints it),
 *   2. the user taps the link wherever their mail is — /auth/verify is unchanged, and binds the
 *      session it created to the waiting row,
 *   3. the app trades its secret for that session id, once, and stores it in the keychain.
 *
 * The link itself is untouched and carries no new authority: forwarding it grants exactly what
 * forwarding it granted before. The secret never leaves the device that asked for it.
 *
 * Every function here takes `db` rather than reaching for the runtime, so the flow is testable
 * against PGlite without a request context.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, type Db, schema } from "@daymarkable/db";

/** Matches the login token's own lifetime — the two die together by design. */
export const DEVICE_LOGIN_TTL_MS = 15 * 60_000;
/**
 * A 2s poll over a 15 minute window is ~450 tries. The cap is well clear of that and exists only
 * so a client that never stops cannot keep a dead row warm.
 */
export const MAX_POLLS = 900;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type ClaimResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "ready"; sessionId: string };

/**
 * Start an attempt. The caller passes the hash of the login token it just minted.
 *
 * Returns the plaintext secret; only its hash is stored.
 */
export async function startDeviceLogin(db: Db, tokenHash: string, now = new Date()): Promise<string> {
  const secret = randomBytes(32).toString("base64url");
  await db.insert(schema.deviceLogins).values({
    secretHash: sha256(secret),
    tokenHash,
    expiresAt: new Date(now.getTime() + DEVICE_LOGIN_TTL_MS),
  });
  return secret;
}

/**
 * A secret for an attempt that was never recorded.
 *
 * `requestLink` answers the same for an address that may sign in and one that may not (rule 15),
 * and that has to hold for the app too — so when no token was minted the app still gets a secret,
 * one that simply never becomes ready. Without this the mobile endpoint would be a perfectly good
 * oracle for who has an account.
 */
export function decoyPollSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The link was tapped: hand the session to whichever attempt was waiting on this token.
 *
 * Silent when nothing is waiting, which is the normal case — every web sign-in lands here too.
 * Returns whether a mobile attempt was in fact waiting, which is also how the caller knows to
 * record the session as a mobile one.
 */
export async function bindSession(db: Db, tokenHash: string, sessionId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(schema.deviceLogins)
    .set({ sessionId })
    .where(and(eq(schema.deviceLogins.tokenHash, tokenHash), isNull(schema.deviceLogins.sessionId), isNull(schema.deviceLogins.claimedAt)))
    .returning();
  return rows.some((r) => r.expiresAt > now);
}

/**
 * Trade the secret for the session, once.
 *
 * An unknown secret answers "pending" rather than "expired": the app holds its own deadline, and
 * a distinguishing answer here would say whether an attempt existed — which is to say, whether
 * the address may sign in.
 */
export async function claimDeviceLogin(db: Db, pollSecret: string, now = new Date()): Promise<ClaimResult> {
  const secretHash = sha256(pollSecret);
  const row = await db.query.deviceLogins.findFirst({ where: eq(schema.deviceLogins.secretHash, secretHash) });
  if (!row) return { status: "pending" };
  if (row.claimedAt || row.expiresAt <= now || row.attempts >= MAX_POLLS) return { status: "expired" };
  if (!row.sessionId) {
    await db.update(schema.deviceLogins).set({ attempts: row.attempts + 1 }).where(eq(schema.deviceLogins.secretHash, secretHash));
    return { status: "pending" };
  }
  // Single use: the claim is what spends the row, so a replay of the same secret gets nothing.
  const claimed = await db
    .update(schema.deviceLogins)
    .set({ claimedAt: now })
    .where(and(eq(schema.deviceLogins.secretHash, secretHash), isNull(schema.deviceLogins.claimedAt)))
    .returning();
  const sessionId = claimed[0]?.sessionId;
  return sessionId ? { status: "ready", sessionId } : { status: "expired" };
}

/** Was this sign-in started by a native client? Decides how the session is labelled. */
export async function isMobileLogin(db: Db, tokenHash: string): Promise<boolean> {
  const row = await db.query.deviceLogins.findFirst({ where: eq(schema.deviceLogins.tokenHash, tokenHash) });
  return !!row;
}

/**
 * `Authorization: Bearer <session id>` — how a native client carries what a browser keeps in a
 * cookie. Lives here rather than in auth.ts so it can be tested without a request context; auth.ts
 * re-exports it as the one name callers use.
 *
 * The scheme name is case-insensitive per RFC 7235, the credential is not.
 */
export function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1]! : null;
}

/** Exported for the test, and for anything that needs to speak in hashes. */
export const hashSecret = sha256;
