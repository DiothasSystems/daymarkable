/**
 * The admin portal's second factor — the database half (rule 13).
 *
 *   1. Password right (admin.ts): `createChallenge` stores a keyed digest of a fresh six-digit code,
 *      and the code is mailed to ADMIN_2FA_EMAIL. The browser gets a signed pointer to the row.
 *   2. Code typed (`answerChallenge`): checked against the row that pointer names, and only that one.
 *
 * Bound to the browser that gave the password: the code is useless without the pointer, which is an
 * HttpOnly, SameSite=Strict cookie on /admin — so a code read over someone's shoulder, or in a mail
 * that went astray, cannot open a session anywhere else. Five wrong codes spend the challenge, and
 * each wrong code also counts against the IP in the existing admin lockout, so guessing codes is
 * throttled the same way guessing passwords is.
 *
 * Takes `db` rather than the runtime, like sign-in.ts, so it is tested against PGlite.
 */
import { and, eq, isNull, schema, sql, type Db } from "@daymarkable/db";
import { ADMIN_CODE_MAX_TRIES, ADMIN_CODE_TTL_MS, adminCodeDigest, adminCodeMatches, newAdminCode, type AdminConfig } from "./admin-core";

export async function createChallenge(db: Db, cfg: AdminConfig, ip: string, now = new Date()): Promise<{ id: string; code: string }> {
  const [row] = await db
    .insert(schema.adminLoginChallenges)
    // The digest needs the id and the id is the database's, so write a placeholder and fill it in:
    // a row with a placeholder digest can match no code, so the gap is harmless.
    .values({ codeDigest: "pending", ip, expiresAt: new Date(now.getTime() + ADMIN_CODE_TTL_MS), createdAt: now })
    .returning();
  const code = newAdminCode();
  await db.update(schema.adminLoginChallenges).set({ codeDigest: adminCodeDigest(cfg, row!.id, code) }).where(eq(schema.adminLoginChallenges.id, row!.id));
  return { id: row!.id, code };
}

export type ChallengeAnswer =
  | { ok: true }
  | { ok: false; reason: "wrong"; triesLeft: number }
  /** Spent, expired, used up, or never existed: the only way on is to give the password again. */
  | { ok: false; reason: "restart" };

/**
 * Answer a challenge with a code. A right code spends the challenge — conditionally, so of two
 * simultaneous right answers exactly one wins. A wrong one uses up a try; the last wrong try spends it.
 */
export async function answerChallenge(db: Db, cfg: AdminConfig, challengeId: string, code: string, now = new Date()): Promise<ChallengeAnswer> {
  // A malformed id is not worth a query — and must not become a database error that differs from
  // "no such challenge".
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return { ok: false, reason: "restart" };
  const row = await db.query.adminLoginChallenges.findFirst({ where: eq(schema.adminLoginChallenges.id, challengeId) });
  if (!row || row.usedAt || row.expiresAt <= now || row.attempts >= ADMIN_CODE_MAX_TRIES) return { ok: false, reason: "restart" };

  if (/^\d{6}$/.test(code.trim()) && adminCodeMatches(cfg, row.id, code, row.codeDigest)) {
    const spent = await db
      .update(schema.adminLoginChallenges)
      .set({ usedAt: now })
      .where(and(eq(schema.adminLoginChallenges.id, row.id), isNull(schema.adminLoginChallenges.usedAt)))
      .returning();
    return spent.length ? { ok: true } : { ok: false, reason: "restart" };
  }

  const tries = row.attempts + 1;
  await db
    .update(schema.adminLoginChallenges)
    .set({ attempts: sql`${schema.adminLoginChallenges.attempts} + 1`, ...(tries >= ADMIN_CODE_MAX_TRIES ? { usedAt: now } : {}) })
    .where(eq(schema.adminLoginChallenges.id, row.id));
  return tries >= ADMIN_CODE_MAX_TRIES ? { ok: false, reason: "restart" } : { ok: false, reason: "wrong", triesLeft: ADMIN_CODE_MAX_TRIES - tries };
}
