import "server-only";
import { getOpsSettings } from "./ops";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, schema } from "@daymarkable/db";
import { buildPasswordChangedMail, buildSetPasswordMail, buildSignInMail } from "@daymarkable/mail";
import { defaultSettings } from "@daymarkable/pipeline";
import { DateTime } from "luxon";
import { cookies } from "next/headers";
import { normalizeEmail } from "@/lib/email";
import { publicUrl, sessionCookieDomain } from "@/lib/hosts";
import { getRuntime } from "./runtime";
import { maySignIn } from "./access";
import { clientIp } from "./audit";
import { bearerFrom, bindSession, claimDeviceLogin, isMobileLogin, startDeviceLogin, type ClaimResult } from "./device-login";
import { PASSWORD_LINK_TTL_MS, checkCredentials, mintPasswordToken, passwordTokenEmail, setPasswordWithToken } from "./sign-in";
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

export type MagicLinkResult =
  | {
      ok: true;
      /** Only in development when no email provider is configured. */
      devLink?: string;
      /** Native clients only: what the app polls `auth.claim` with (device-login.ts). */
      pollSecret?: string;
    }
  /**
   * Every way of being wrong is "credentials" — a wrong password, no password yet, no account, an
   * address that may not sign in — because the reply reaches whoever typed the address (rule 15).
   * "locked" is the one other answer, and it gives nothing away either: it follows five wrong tries.
   */
  | { ok: false; reason: "credentials" }
  | { ok: false; reason: "locked"; retryAfterMinutes: number };

export type LoginClient = "web" | "mobile";

/** Where "forgot your password" lives, for the mails that point at it. */
export const resetUrl = () => `${publicUrl()}/login?reset=1`;

/**
 * Sign-in, step one: the password. Only when it is right is a link minted and mailed — the link is
 * step two, and still the only thing that creates a session (/auth/verify).
 */
export async function requestMagicLink(rawEmail: string, password: string, client: LoginClient = "web"): Promise<MagicLinkResult> {
  const mobile = client === "mobile";
  const email = normalizeEmail(rawEmail);
  if (!email || !password) return { ok: false, reason: "credentials" };
  const rt = await getRuntime();
  const check = await checkCredentials(rt.db, email, password, await clientIp(), maySignIn);
  if (!check.ok) {
    // The SERVER log is a different audience from the person at the form: the operator may know
    // why, the typist may not. Never the password, only the address and the outcome.
    console.log(`[web] sign-in refused for ${email}: ${check.reason}`);
    return check.reason === "locked" ? { ok: false, reason: "locked", retryAfterMinutes: Math.max(1, Math.ceil(check.retryAfterMs / 60_000)) } : { ok: false, reason: "credentials" };
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  await rt.db.insert(schema.loginTokens).values({ tokenHash, email, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  const pollSecret = mobile ? await startDeviceLogin(rt.db, tokenHash) : undefined;
  const link = `${publicUrl()}/auth/verify?token=${token}`;
  const res = await rt.mail.send(buildSignInMail(email, link, tokenHash, LINK_TTL_MS / 60_000, resetUrl()));
  if (res.status === "skipped") {
    // No email provider configured. The link goes to the server log so the operator can still
    // sign in (bootstrapping a fresh host); it is only returned to the browser outside production.
    console.log(`[web] magic link for ${email}: ${link}`);
    return process.env.NODE_ENV === "production" ? { ok: true, pollSecret } : { ok: true, devLink: link, pollSecret };
  }
  // The provider's own words, kept whole: a Resend 403 naming an unverified domain is the
  // difference between "our mail is broken" and "EMAIL_FROM is on a domain we never verified".
  if (res.status === "failed") console.error(`[web] sign-in email to ${email} failed: ${res.error}`);
  if (res.status === "sent") console.log(`[web] sign-in link mailed to ${email} via ${rt.mail.name} (${res.providerId ?? "no id"})`);
  return { ok: true, pollSecret };
}

export async function verifyMagicLink(token: string): Promise<SessionUser | null> {
  const rt = await getRuntime();
  const row = await rt.db.query.loginTokens.findFirst({ where: and(eq(schema.loginTokens.tokenHash, sha256(token)), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date())) });
  if (!row) return null;
  await rt.db.update(schema.loginTokens).set({ usedAt: new Date() }).where(eq(schema.loginTokens.tokenHash, row.tokenHash));
  // A login link is only ever minted after a correct password, and a password lives on an account,
  // so the account exists. Accounts now begin when their first password is set (createAccount).
  const user = await rt.db.query.users.findFirst({ where: eq(schema.users.email, row.email) });
  if (!user) return null;
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

/**
 * Open the account for an invited address. Called when its first password is set, because a
 * password has to live on an account before it can be checked — this used to happen on the first
 * sign-in link, which a password now stands in front of.
 */
export async function createAccount(email: string): Promise<{ id: string; passwordHash: string | null }> {
  const rt = await getRuntime();
  const tz = process.env.USER_TIMEZONE || "America/New_York";
  // The operator kill switches apply here, at creation, and only here: an account that already
  // exists keeps whatever is in its own settings whatever the switches now say.
  const ops = await getOpsSettings();
  const settings = defaultSettings();
  if (!ops.newsForNewUsers) settings.dailyUpdate = { ...settings.dailyUpdate, enabled: false };
  if (!ops.puzzleForNewUsers) settings.dailyPuzzle = { ...settings.dailyPuzzle, enabled: false };
  const [user] = await rt.db.insert(schema.users).values({ email, timezone: tz, settings }).returning();
  // They were invited and have now turned up, so the waiting list row stops being a promise.
  await markJoined(email);
  return user!;
}

/**
 * "Set or reset your password": mail a link to choose one. Says the same thing whatever happens —
 * whether the address may sign in, whether it has had its three links this hour — for the same
 * reason the sign-in form does (rule 15).
 */
export async function requestPasswordLink(rawEmail: string): Promise<{ ok: true; devLink?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: true };
  if (!(await maySignIn(email))) {
    console.log(`[web] no password link for ${email}: that address may not sign in (invite it at /admin/waitlist)`);
    return { ok: true };
  }
  const rt = await getRuntime();
  const minted = await mintPasswordToken(rt.db, email);
  if (!minted) {
    console.log(`[web] no password link for ${email}: its hourly limit is used`);
    return { ok: true };
  }
  const link = `${publicUrl()}/auth/set-password?token=${minted.token}`;
  const res = await rt.mail.send(buildSetPasswordMail(email, link, minted.tokenHash, PASSWORD_LINK_TTL_MS / 60_000));
  if (res.status === "skipped") {
    console.log(`[web] password link for ${email}: ${link}`);
    return process.env.NODE_ENV === "production" ? { ok: true } : { ok: true, devLink: link };
  }
  if (res.status === "failed") console.error(`[web] password email to ${email} failed: ${res.error}`);
  if (res.status === "sent") console.log(`[web] password link mailed to ${email} via ${rt.mail.name}`);
  return { ok: true };
}

/** The address a set-password link is for, or null once it is spent or expired (sign-in.ts). */
export async function passwordLinkEmail(token: string): Promise<string | null> {
  const rt = await getRuntime();
  return passwordTokenEmail(rt.db, token);
}

/**
 * Choose a password from the emailed link. Signs nobody in — the caller sends them to sign in with
 * it — and tells the owner it happened, every time.
 */
export async function setPassword(token: string, password: string): Promise<{ ok: true; replaced: boolean } | { ok: false; message: string }> {
  const rt = await getRuntime();
  const r = await setPasswordWithToken(rt.db, token, password, { maySignIn, createAccount });
  if (!r.ok) return { ok: false, message: r.message };
  const user = await rt.db.query.users.findFirst({ where: eq(schema.users.id, r.userId) });
  const when = DateTime.now().setZone(user?.timezone || "UTC").toFormat("d LLL yyyy, HH:mm ZZZZ");
  const res = await rt.mail.send(buildPasswordChangedMail(r.email, { replaced: r.replaced, when, resetUrl: resetUrl(), signedOutEverywhere: r.replaced }));
  if (res.status === "failed") console.error(`[web] password-changed notice to ${r.email} failed: ${res.error}`);
  console.log(`[web] password ${r.replaced ? "changed" : "set"} for ${r.email}${r.created ? " (account opened)" : ""}${r.replaced ? "; every session signed out" : ""}`);
  return { ok: true, replaced: r.replaced };
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
 * Host-only in dev; scoped to scriptumiq.com in production so the sign-in carries from the public
 * site to app — and so a WebView handed a session on one host keeps it on the other.
 */
export function sessionCookieOptions() {
  return { ...cookieScope(), expires: new Date(Date.now() + SESSION_TTL_MS) };
}

function cookieScope() {
  const domain = sessionCookieDomain();
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", ...(domain ? { domain } : {}) };
}
