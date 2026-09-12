import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, schema } from "@daymarkable/db";
import { buildSignInMail } from "@daymarkable/mail";
import { defaultSettings } from "@daymarkable/pipeline";
import { cookies } from "next/headers";
import { normalizeEmail } from "@/lib/email";
import { publicUrl, sessionCookieDomain } from "@/lib/hosts";
import { getRuntime } from "./runtime";
import { isInvited, markJoined } from "./waitlist";

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

/**
 * Registration is not open, so a sign-in is accepted for an address that already has an account,
 * for the operator's own USER_EMAIL, for anyone invited off the waiting list, or for the very
 * first account when none exists. Everyone else gets the same neutral message, which is why the
 * public page offers the waiting list instead of a sign-in form: a registration form that answers
 * differently for a known address tells strangers who has an account.
 */
async function loginAllowed(email: string): Promise<boolean> {
  const rt = await getRuntime();
  const existing = await rt.db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) return true;
  const configured = (process.env.USER_EMAIL || "").trim().toLowerCase();
  if (configured && configured === email) return true;
  if (await isInvited(email)) return true;
  const any = await rt.db.query.users.findFirst();
  return !any;
}

export interface MagicLinkResult {
  ok: true;
  /** Only in development when no email provider is configured. */
  devLink?: string;
}

export async function requestMagicLink(rawEmail: string): Promise<MagicLinkResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: true }; // never reveal validity
  if (!(await loginAllowed(email))) return { ok: true };
  const rt = await getRuntime();
  const token = randomBytes(32).toString("base64url");
  await rt.db.insert(schema.loginTokens).values({ tokenHash: sha256(token), email, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  const link = `${publicUrl()}/auth/verify?token=${token}`;
  const res = await rt.mail.send(buildSignInMail(email, link, sha256(token), LINK_TTL_MS / 60_000));
  if (res.status === "skipped") {
    // No email provider configured. The link goes to the server log so the operator can still
    // sign in (bootstrapping a fresh host); it is only returned to the browser outside production.
    console.log(`[web] magic link for ${email}: ${link}`);
    return process.env.NODE_ENV === "production" ? { ok: true } : { ok: true, devLink: link };
  }
  if (res.status === "failed") console.error(`[web] sign-in email to ${email} failed: ${res.error}`);
  return { ok: true };
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
  await rt.db.insert(schema.sessions).values({ id, userId: user!.id, expiresAt });
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

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const rt = await getRuntime();
  const s = await rt.db.query.sessions.findFirst({ where: and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())) });
  if (!s) return null;
  const u = await rt.db.query.users.findFirst({ where: eq(schema.users.id, s.userId) });
  return u ? toSessionUser(u) : null;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) {
    const rt = await getRuntime();
    await rt.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  }
  jar.set(SESSION_COOKIE, "", { ...cookieScope(), maxAge: 0 });
}

/** Host-only in dev; scoped to daymarkable.com in production so the sign-in carries from the public site to app. */
function cookieScope() {
  const domain = sessionCookieDomain();
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", ...(domain ? { domain } : {}) };
}
