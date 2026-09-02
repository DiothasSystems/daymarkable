/**
 * Pure admin-auth primitives (no Next, no DB) so they can be unit-tested:
 *   - credential check against ADMIN_LOGIN_ID + bcrypt ADMIN_PASSWORD_HASH (rule 13)
 *   - short-lived HMAC-signed admin session token, completely separate from user sessions
 *   - rate-limit decision from recent login attempts
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export const ADMIN_SESSION_TTL_MS = 60 * 60_000; // one hour, then log in again
export const ADMIN_MAX_FAILURES_PER_IP = 5;
export const ADMIN_MAX_FAILURES_GLOBAL = 20;
export const ADMIN_WINDOW_MS = 15 * 60_000;

export interface AdminConfig {
  loginId: string;
  passwordHash: string;
  /** Key material for signing sessions (derived from DATA_ENCRYPTION_KEY + the hash). */
  signingKey: string;
}

export function adminConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AdminConfig | null {
  const loginId = env.ADMIN_LOGIN_ID?.trim();
  const passwordHash = env.ADMIN_PASSWORD_HASH?.trim();
  const dek = env.DATA_ENCRYPTION_KEY?.trim();
  if (!loginId || !passwordHash || !dek) return null;
  if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) return null; // must be a bcrypt hash, never plaintext
  return { loginId, passwordHash, signingKey: `${dek}:${passwordHash}` };
}

export async function checkAdminCredentials(cfg: AdminConfig, loginId: string, password: string): Promise<boolean> {
  const idOk = loginId.length === cfg.loginId.length && timingSafeEqual(Buffer.from(loginId), Buffer.from(cfg.loginId));
  const pwOk = await bcrypt.compare(password, cfg.passwordHash);
  return idOk && pwOk;
}

export function hashAdminPassword(password: string, rounds = 12): Promise<string> {
  return bcrypt.hash(password, rounds);
}

function sign(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueAdminToken(cfg: AdminConfig, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + ADMIN_SESSION_TTL_MS, nonce: randomBytes(12).toString("base64url"), id: cfg.loginId })).toString("base64url");
  return `${payload}.${sign(cfg.signingKey, payload)}`;
}

export function verifyAdminToken(cfg: AdminConfig, token: string | undefined, now = Date.now()): { ok: true; expiresAt: number } | { ok: false; reason: string } {
  if (!token) return { ok: false, reason: "missing" };
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return { ok: false, reason: "malformed" };
  const expected = sign(cfg.signingKey, payload);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return { ok: false, reason: "bad signature" };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number; id: string };
    if (data.id !== cfg.loginId) return { ok: false, reason: "wrong login id" };
    if (data.exp <= now) return { ok: false, reason: "expired" };
    return { ok: true, expiresAt: data.exp };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export interface AttemptRow {
  ip: string;
  success: boolean;
  createdAt: Date;
}

/** Lock an IP after 5 failures in 15 minutes, and everyone after 20 (credential stuffing from many IPs). */
export function loginLocked(attempts: readonly AttemptRow[], ip: string, now = Date.now()): { locked: boolean; retryAfterMs: number } {
  const recent = attempts.filter((a) => !a.success && now - a.createdAt.getTime() < ADMIN_WINDOW_MS);
  const mine = recent.filter((a) => a.ip === ip);
  const oldest = (rows: readonly AttemptRow[]) => Math.min(...rows.map((a) => a.createdAt.getTime()));
  if (mine.length >= ADMIN_MAX_FAILURES_PER_IP) return { locked: true, retryAfterMs: ADMIN_WINDOW_MS - (now - oldest(mine)) };
  if (recent.length >= ADMIN_MAX_FAILURES_GLOBAL) return { locked: true, retryAfterMs: ADMIN_WINDOW_MS - (now - oldest(recent)) };
  return { locked: false, retryAfterMs: 0 };
}
