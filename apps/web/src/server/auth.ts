import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, schema } from "@daymarkable/db";
import { defaultSettings } from "@daymarkable/pipeline";
import { cookies } from "next/headers";
import { appUrl, getRuntime } from "./runtime";

export const SESSION_COOKIE = "dm_session";
const LINK_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 3600_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface SessionUser {
  id: string;
  email: string;
  timezone: string;
  onboardedAt: Date | null;
  settings: typeof schema.users.$inferSelect.settings;
}

/**
 * Phase 0 is single-tenant: a login is accepted for an existing account, for USER_EMAIL, or
 * for the very first account when none exists. Everyone else gets the same neutral message.
 */
async function loginAllowed(email: string): Promise<boolean> {
  const rt = await getRuntime();
  const existing = await rt.db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) return true;
  const configured = (process.env.USER_EMAIL || "").trim().toLowerCase();
  if (configured && configured === email) return true;
  const any = await rt.db.query.users.findFirst();
  return !any;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
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
  const link = `${appUrl()}/auth/verify?token=${token}`;
  const res = await rt.mail.send({
    to: email,
    subject: "Your dayMarkable sign-in link",
    text: `Sign in to dayMarkable:\n\n${link}\n\nThis link works once and expires in 15 minutes. If you did not request it, ignore this email.`,
    html: `<p style="font-family:Public Sans,Helvetica,Arial,sans-serif">Sign in to <strong>dayMarkable</strong>:</p><p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#CE4B18;color:#fff;border-radius:6px;text-decoration:none;font-family:Public Sans,Helvetica,Arial,sans-serif">Sign in</a></p><p style="font-family:Public Sans,Helvetica,Arial,sans-serif;color:#6b6760;font-size:13px">This link works once and expires in 15 minutes. If you did not request it, ignore this email.</p>`,
    idempotencyKey: `login:${sha256(token)}`,
  });
  if (res.status === "skipped" && process.env.NODE_ENV !== "production") {
    console.log(`[web] magic link for ${email}: ${link}`);
    return { ok: true, devLink: link };
  }
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
  }
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await rt.db.insert(schema.sessions).values({ id, userId: user!.id, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
  return toSessionUser(user!);
}

function toSessionUser(u: typeof schema.users.$inferSelect): SessionUser {
  return { id: u.id, email: u.email, timezone: u.timezone, onboardedAt: u.onboardedAt, settings: u.settings };
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
  jar.delete(SESSION_COOKIE);
}
