import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, schema } from "@daymarkable/db";
import { buildSignInMail } from "@daymarkable/mail";
import { defaultSettings } from "@daymarkable/pipeline";
import { cookies } from "next/headers";
import { normalizeEmail } from "@/lib/email";
import { publicUrl, sessionCookieDomain } from "@/lib/hosts";
import { getRuntime } from "./runtime";
import { maySignIn } from "./access";
import { bearerFrom, bindSession, claimDeviceLogin, decoyPollSecret, isMobileLogin, startDeviceLogin, type ClaimResult } from "./device-login";
import { createHandoff, type Pane } from "./handoff";
import { markJoined } from "./waitlist";

export const SESSION_COOKIE = "dm_session";
const LINK_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 3600_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface SessionUser {
  id: string;
  email: string;
  timezone: string;
  status: "trial" | "active" | "past_due" | "canceled" | "deleted";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  trialUsedAt: Date | null;
  trialEndsAt: Date | null;
  onboardedAt: Date | null;
  settings: typeof schema.users.$inferSelect.settings;
}

export interface MagicLinkResult {
  ok: true;
  /** Only in development when no email provider is configured. */
  devLink?: string;
  /**
   * Native clients only: what the app polls `auth.claim` with (device-login.ts). Always present
   * for a mobile request, even when no link was sent — see `decoyPollSecret`.
   */
  pollSecret?: string;
}

export type LoginClient = "web" | "mobile";

export async function requestMagicLink(rawEmail: string, client: LoginClient = "web"): Promise<MagicLinkResult> {
  const mobile = client === "mobile";
  const email = normalizeEmail(rawEmail);
  // The reply must not vary with whether an address may sign in — for the app either, which is
  // why a mobile caller always leaves with a secret, even one that will never become ready.
  const silent = (): MagicLinkResult => (mobile ? { ok: true, pollSecret: decoyPollSecret() } : { ok: true });
  if (!email) return silent();
  // Who may sign in is decided in one place; this one only obeys it, and says nothing either
  // way, because the reply here reaches whoever typed the address rather than its owner.
  if (!(await maySignIn(email))) return silent();
  const rt = await getRuntime();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  await rt.db.insert(schema.loginTokens).values({ tokenHash, email, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  const pollSecret = mobile ? await startDeviceLogin(rt.db, tokenHash) : undefined;
  const link = `${publicUrl()}/auth/verify?token=${token}`;
  const res = await rt.mail.send(buildSignInMail(email, link, tokenHash, LINK_TTL_MS / 60_000));
  if (res.status === "skipped") {
    // No email provider configured. The link goes to the server log so the operator can still
    // sign in (bootstrapping a fresh host); it is only returned to the browser outside production.
    console.log(`[web] magic link for ${email}: ${link}`);
    return process.env.NODE_ENV === "production" ? { ok: true, pollSecret } : { ok: true, devLink: link, pollSecret };
  }
  if (res.status === "failed") console.error(`[web] sign-in email to ${email} failed: ${res.error}`);
  return { ok: true, pollSecret };
}

export async function verifyMagicLink(token: string): Promise<SessionUser | null> {
  const rt = await getRuntime();
  const row = await rt.db.query.loginTokens.findFirst({ where: and(eq(schema.loginTokens.tokenHash, sha256(token)), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date())) });
  if (!row) return null;
  await rt.db.update(schema.loginTokens).set({ usedAt: new Date() }).where(eq(schema.loginTokens.tokenHash, row.tokenHash));
  let user = await rt.db.query.users.findFirst({ where: eq(schema.users.email, row.email) });
  if (!user) {
    const tz = process.env.USER_TIMEZONE || "America/New_York";
    [user] = await rt.db.insert(schema.users).values({ email: row.email, timezone: tz, settings: defaultSettings() }).returning();
    // They were invited and have now turned up, so the waiting list row stops being a promise.
    await markJoined(row.email);
  }
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  // A phone was waiting on this link, or it was not. Either way the browser that opened it gets
  // its cookie as before — the link is single-use, so nothing is spent twice. The session must
  // exist before it can be handed over: device_logins.session_id references it.
  const mobile = await isMobileLogin(rt.db, row.tokenHash);
  await rt.db.insert(schema.sessions).values({ id, userId: user!.id, expiresAt, client: mobile ? "mobile" : "web" });
  await bindSession(rt.db, row.tokenHash, id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, { ...cookieScope(), expires: expiresAt });
  return toSessionUser(user!);
}

function toSessionUser(u: typeof schema.users.$inferSelect): SessionUser {
  return {
    id: u.id,
    email: u.email,
    timezone: u.timezone,
    status: u.status,
    stripeCustomerId: u.stripeCustomerId,
    stripeSubscriptionId: u.stripeSubscriptionId,
    trialUsedAt: u.trialUsedAt,
    trialEndsAt: u.trialEndsAt,
    onboardedAt: u.onboardedAt,
    settings: u.settings,
  };
}

/**
 * The app's half of the sign-in: trade the secret it kept for the session the link created.
 *
 * Deliberately says nothing about the address — an unknown secret is "pending", the same answer a
 * genuine attempt gives before the link is tapped.
 */
export async function claimMobileSession(pollSecret: string): Promise<ClaimResult> {
  const rt = await getRuntime();
  return claimDeviceLogin(rt.db, pollSecret);
}

/** A one-time URL that opens a web page already signed in as this session (handoff.ts). */
export async function handoffUrl(sessionId: string, pane: Pane): Promise<string> {
  const rt = await getRuntime();
  return createHandoff(rt.db, sessionId, pane);
}

export { bearerFrom } from "./device-login";

/**
 * Resolve the signed-in user.
 *
 * With a `req` the bearer header is considered first, then the cookie; without one only the
 * cookie exists. Only the two API routes pass a request — a page render has no business reading
 * the header, so a bearer can never stand in for a cookie on a rendered page.
 */
export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  const id = (req ? bearerFrom(req) : null) ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const rt = await getRuntime();
  const s = await rt.db.query.sessions.findFirst({ where: and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())) });
  if (!s) return null;
  const u = await rt.db.query.users.findFirst({ where: eq(schema.users.id, s.userId) });
  return u ? toSessionUser(u) : null;
}

/**
 * End a session. `sessionId` is the bearer a native client signed in with; without it the cookie
 * is the session, and clearing it is most of the job.
 */
export async function logout(sessionId?: string | null): Promise<void> {
  if (sessionId) {
    const rt = await getRuntime();
    await rt.db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    return;
  }
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) {
    const rt = await getRuntime();
    await rt.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  }
  jar.set(SESSION_COOKIE, "", { ...cookieScope(), maxAge: 0 });
}

/**
 * Host-only in dev; scoped to daymarkable.com in production so the sign-in carries from the public
 * site to app — and so a WebView handed a session on one host keeps it on the other.
 */
export function sessionCookieOptions() {
  return { ...cookieScope(), expires: new Date(Date.now() + SESSION_TTL_MS) };
}

function cookieScope() {
  const domain = sessionCookieDomain();
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", ...(domain ? { domain } : {}) };
}
