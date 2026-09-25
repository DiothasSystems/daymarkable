/**
 * Pure admin-auth primitives (no Next, no DB) so they can be unit-tested:
 *   - credential check against ADMIN_LOGIN_ID + bcrypt ADMIN_PASSWORD_HASH (rule 13)
 *   - short-lived HMAC-signed admin session token, completely separate from user sessions
 *   - rate-limit decision from recent login attempts
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { ESCALATION_THRESHOLD_MAX, ESCALATION_THRESHOLD_MIN } from "@daymarkable/decode";

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

// ---------------------------------------------------------------- decode tuning (operator only)
/**
 * The confidence threshold and the two model overrides are operator controls, not customer
 * settings: the threshold decides how much of someone's handwriting is diverted to the Inbox
 * rather than trusted onto the Action List, and the overrides decide what their pages cost to
 * read. The decision lives here, pure and tested; `updateDecodeTuning` does the writing and the
 * auditing (rule 13).
 */
export const TUNING_MIN = 0.3;
export const TUNING_MAX = 0.95;

export interface TuningPatch {
  confidenceThreshold: number;
  /** Null clears the override, so the account follows the operator default again. */
  escalationThreshold: number | null;
  decodeModel: string | null;
  escalationModel: string | null;
}

export function validateTuning(patch: TuningPatch, isRetired: (model: string) => boolean, baseline: string): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(patch.confidenceThreshold)) return { ok: false, message: "Confidence threshold must be a number" };
  if (patch.confidenceThreshold < TUNING_MIN || patch.confidenceThreshold > TUNING_MAX) {
    return { ok: false, message: `Confidence threshold must be between ${TUNING_MIN} and ${TUNING_MAX}` };
  }
  if (patch.escalationThreshold !== null) {
    if (!Number.isFinite(patch.escalationThreshold)) return { ok: false, message: "Escalation threshold must be a number" };
    if (patch.escalationThreshold < ESCALATION_THRESHOLD_MIN || patch.escalationThreshold > ESCALATION_THRESHOLD_MAX) {
      return { ok: false, message: `Escalation threshold must be between ${ESCALATION_THRESHOLD_MIN} and ${ESCALATION_THRESHOLD_MAX}` };
    }
  }
  // Say so rather than accepting a retired model and quietly substituting a good one, so the
  // stored value always means what it says.
  for (const m of [patch.decodeModel, patch.escalationModel]) {
    if (m && isRetired(m)) return { ok: false, message: `${m} is retired — it read handwriting materially worse than ${baseline}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- user search

/** The fields an operator searches an account by. Anything typed is matched against all of them. */
export interface SearchableUser {
  email: string;
  status: string;
  plan: string | null;
  role: string | null;
  industry: string | null;
}

/**
 * Match an account against a search box.
 *
 * Every whitespace-separated term must match somewhere (AND, not OR), because narrowing is what a
 * second word is for: "student annual" should mean both, not either. Matching is case-insensitive
 * substring across email, status, plan, role and industry — an operator looking for "physician"
 * or "past_due" or a fragment of an address should not have to say which field they meant.
 */
export function matchesUserQuery(u: SearchableUser, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [u.email, u.status, u.plan ?? "", u.role ?? "", u.industry ?? ""].join(" ").toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

// ---------------------------------------------------------------- what the customer chose

/**
 * One switch or setting as the operator reads it.
 *
 * `detail` carries the thing that actually matters when a support question arrives — which topics,
 * which address, how many words — because "Daily brief: on" does not answer "why is their brief
 * empty?" and "on, no topics set" does.
 */
export interface OptionRow {
  label: string;
  /** On, off, or a short value. */
  value: string;
  detail?: string;
  /** True when this is a plain on/off, so the page can render a pip rather than text. */
  on?: boolean;
}

export interface OptionGroup {
  heading: string;
  rows: OptionRow[];
}

/** The settings shape this reads. Structural, so it does not drag the DB package into a pure module. */
export interface OptionSettings {
  watchFolders?: string[];
  outputToRoot?: boolean;
  includePdfs?: boolean;
  weeklyNotesArchive?: boolean;
  autoSendInvites?: boolean;
  email?: { meetingNotes: boolean };
  deliveryEmail?: string | null;
  deliveryVerifiedAt?: string | null;
  deliveryDocuments?: { planner: boolean; actionList: boolean; meetingNotes: boolean };
  dailyUpdate?: { enabled: boolean; topics: string[] };
  dailyPuzzle?: { enabled: boolean };
  conventions?: { active: Array<{ id: string; meaning: string; keyword?: string }> };
  lexicon?: string[];
  profile?: { role: string; industry: string; context: string } | null;
}

const onOff = (b: boolean | undefined): string => (b ? "On" : "Off");

/**
 * Everything the customer has switched on or typed in, grouped the way an operator asks about it.
 *
 * Read-only by design: this is the same account the operator can cancel and refund, and being able
 * to see a preference is a different thing from being able to change it. Nothing here edits.
 */
export function describeOptions(s: OptionSettings): OptionGroup[] {
  const topics = s.dailyUpdate?.topics ?? [];
  const delivery = s.deliveryDocuments;
  const attached = delivery
    ? [delivery.planner ? "planner" : null, delivery.actionList ? "action list" : null, delivery.meetingNotes ? "notes" : null].filter(Boolean)
    : [];
  const folders = s.watchFolders ?? [];

  return [
    {
      heading: "Daily extras",
      rows: [
        {
          label: "Daily brief",
          value: onOff(s.dailyUpdate?.enabled),
          on: s.dailyUpdate?.enabled ?? false,
          // The failure everyone hits: the brief is on, nobody typed a topic, and no notebook is
          // produced at all. Worth saying here rather than making someone read the run log.
          detail: s.dailyUpdate?.enabled
            ? topics.length
              ? `${topics.length} topic${topics.length === 1 ? "" : "s"}: ${topics.join(", ")}`
              : "no topics set — nothing is produced"
            : undefined,
        },
        { label: "Daily puzzle", value: onOff(s.dailyPuzzle?.enabled), on: s.dailyPuzzle?.enabled ?? false },
      ],
    },
    {
      heading: "What is read",
      rows: [
        {
          label: "Watched folders",
          value: folders.length ? String(folders.length) : "All notebooks",
          detail: folders.length ? folders.join(", ") : undefined,
        },
        { label: "Annotated PDFs", value: onOff(s.includePdfs), on: s.includePdfs ?? false },
        {
          label: "Ink conventions",
          value: String(s.conventions?.active.length ?? 0),
          detail: s.conventions?.active.length
            ? s.conventions.active.map((c) => (c.keyword ? `${c.id}="${c.keyword}"→${c.meaning}` : `${c.id}→${c.meaning}`)).join(", ")
            : undefined,
        },
        { label: "Vocabulary terms", value: String(s.lexicon?.length ?? 0) },
      ],
    },
    {
      heading: "What is written",
      rows: [
        { label: "Notebooks land in", value: s.outputToRoot ? "Tablet root" : "/ScriptumIQ" },
        { label: "Weekly notes archive", value: onOff(s.weeklyNotesArchive), on: s.weeklyNotesArchive ?? false },
        { label: "Meeting-note emails", value: onOff(s.email?.meetingNotes), on: s.email?.meetingNotes ?? false },
        {
          label: "PDF delivery address",
          // An unverified address is not used, so showing it as configured would be wrong (rule 10).
          value: s.deliveryEmail ? (s.deliveryVerifiedAt ? s.deliveryEmail : `${s.deliveryEmail} — UNVERIFIED`) : "Not set",
          detail: s.deliveryEmail && s.deliveryVerifiedAt ? (attached.length ? `attaches ${attached.join(", ")}` : "no documents attached") : undefined,
        },
        {
          label: "Auto-send invites",
          value: onOff(s.autoSendInvites),
          on: s.autoSendInvites ?? false,
          detail: s.autoSendInvites ? "high confidence, no external attendees (rule 7)" : undefined,
        },
      ],
    },
  ];
}
