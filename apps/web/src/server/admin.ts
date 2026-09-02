import "server-only";
import { and, avg, count, desc, eq, gte, schema, sql } from "@daymarkable/db";
import { repo } from "@daymarkable/pipeline";
import { DateTime } from "luxon";
import { cookies, headers } from "next/headers";
import {
  adminConfigFromEnv,
  checkAdminCredentials,
  issueAdminToken,
  loginLocked,
  verifyAdminToken,
  ADMIN_SESSION_TTL_MS,
  ADMIN_WINDOW_MS,
} from "./admin-core";
import { getRuntime } from "./runtime";

export const ADMIN_COOKIE = "dm_admin";

export function adminEnabled(): boolean {
  return adminConfigFromEnv() !== null;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

export interface AdminSession {
  loginId: string;
  expiresAt: Date;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cfg = adminConfigFromEnv();
  if (!cfg) return null;
  const jar = await cookies();
  const v = verifyAdminToken(cfg, jar.get(ADMIN_COOKIE)?.value);
  return v.ok ? { loginId: cfg.loginId, expiresAt: new Date(v.expiresAt) } : null;
}

/** Append-only: nothing in the codebase updates or deletes admin_audit rows. */
export async function audit(action: string, detail: Record<string, unknown> = {}, targetUserId: string | null = null): Promise<void> {
  const rt = await getRuntime();
  const cfg = adminConfigFromEnv();
  await rt.db.insert(schema.adminAudit).values({ adminLoginId: cfg?.loginId ?? "unknown", action, targetUserId, detail, ip: await clientIp() });
}

export type LoginResult = { ok: true; token: string; maxAgeSec: number } | { ok: false; status: 401 | 429 | 503; message: string };

export async function adminLogin(loginId: string, password: string): Promise<LoginResult> {
  const cfg = adminConfigFromEnv();
  if (!cfg) return { ok: false, status: 503, message: "Admin portal is not configured on this host (ADMIN_LOGIN_ID / ADMIN_PASSWORD_HASH)." };
  const rt = await getRuntime();
  const ip = await clientIp();
  const since = new Date(Date.now() - ADMIN_WINDOW_MS);
  const attempts = await rt.db.query.adminLoginAttempts.findMany({ where: gte(schema.adminLoginAttempts.createdAt, since) });
  const lock = loginLocked(attempts, ip);
  if (lock.locked) {
    await audit("admin.login.locked", { ip, retryAfterMs: lock.retryAfterMs });
    return { ok: false, status: 429, message: `Too many failed attempts. Try again in ${Math.ceil(lock.retryAfterMs / 60_000)} minutes.` };
  }
  const ok = await checkAdminCredentials(cfg, loginId, password);
  await rt.db.insert(schema.adminLoginAttempts).values({ ip, success: ok });
  if (!ok) {
    await audit("admin.login.failed", { ip, loginIdAttempted: loginId.slice(0, 32) });
    return { ok: false, status: 401, message: "Wrong login id or password." };
  }
  await audit("admin.login", { ip });
  return { ok: true, token: issueAdminToken(cfg), maxAgeSec: ADMIN_SESSION_TTL_MS / 1000 };
}

// ---------------------------------------------------------------- metrics
export interface AdminUserRow {
  id: string;
  email: string;
  status: string;
  timezone: string;
  createdAt: Date;
  onboardedAt: Date | null;
  paired: boolean;
  runs: number;
  onDemandRuns: number;
  failedRuns: number;
  pagesDecoded: number;
  firstRunAt: Date | null;
  lastRunAt: Date | null;
  /** Average per calendar day since the first run. */
  avgPagesPerDay: number;
  avgRunsPerDay: number;
  avgOnDemandPerDay: number;
  costTotalUsd: number;
  costMonthUsd: number;
  ratingAvg: number | null;
  ratingCount: number;
}

export async function listUsers(): Promise<AdminUserRow[]> {
  const rt = await getRuntime();
  const users = await rt.db.query.users.findMany({ orderBy: desc(schema.users.createdAt) });
  const monthStart = DateTime.utc().startOf("month").toJSDate();
  const out: AdminUserRow[] = [];
  for (const u of users) {
    const runs = await rt.db.query.runs.findMany({ where: eq(schema.runs.userId, u.id) });
    const succeeded = runs.filter((r) => r.status === "succeeded");
    const pages = succeeded.reduce((n, r) => n + (r.stats?.pagesDecoded ?? 0), 0);
    const [total] = await rt.db.select({ usd: sql<string>`coalesce(sum(${schema.runCosts.costUsd}), 0)` }).from(schema.runCosts).where(eq(schema.runCosts.userId, u.id));
    const [month] = await rt.db.select({ usd: sql<string>`coalesce(sum(${schema.runCosts.costUsd}), 0)` }).from(schema.runCosts).where(and(eq(schema.runCosts.userId, u.id), gte(schema.runCosts.createdAt, monthStart)));
    const [rating] = await rt.db.select({ avg: avg(schema.feedback.rating), n: count() }).from(schema.feedback).where(eq(schema.feedback.userId, u.id));
    const cred = await rt.db.query.tabletCredentials.findFirst({ where: eq(schema.tabletCredentials.userId, u.id) });
    const first = runs.length ? new Date(Math.min(...runs.map((r) => r.createdAt.getTime()))) : null;
    const last = runs.length ? new Date(Math.max(...runs.map((r) => r.createdAt.getTime()))) : null;
    const days = first ? Math.max(1, Math.ceil((Date.now() - first.getTime()) / 86_400_000)) : 1;
    const onDemand = runs.filter((r) => r.kind === "on_demand" && r.status !== "skipped").length;
    out.push({
      id: u.id,
      email: u.email,
      status: u.status,
      timezone: u.timezone,
      createdAt: u.createdAt,
      onboardedAt: u.onboardedAt,
      paired: !!cred,
      runs: runs.length,
      onDemandRuns: onDemand,
      failedRuns: runs.filter((r) => r.status === "failed").length,
      pagesDecoded: pages,
      firstRunAt: first,
      lastRunAt: last,
      avgPagesPerDay: pages / days,
      avgRunsPerDay: succeeded.length / days,
      avgOnDemandPerDay: onDemand / days,
      costTotalUsd: Number(total?.usd ?? 0),
      costMonthUsd: Number(month?.usd ?? 0),
      ratingAvg: rating?.avg ? Number(rating.avg) : null,
      ratingCount: Number(rating?.n ?? 0),
    });
  }
  return out;
}

export async function getUserDetail(userId: string) {
  const rows = await listUsers();
  const row = rows.find((r) => r.id === userId);
  if (!row) return null;
  const rt = await getRuntime();
  const runs = await rt.db.query.runs.findMany({ where: eq(schema.runs.userId, userId), orderBy: desc(schema.runs.createdAt), limit: 30 });
  const costs = await rt.db
    .select({ model: schema.runCosts.model, mode: schema.runCosts.mode, usd: sql<string>`sum(${schema.runCosts.costUsd})`, pages: sql<number>`sum(${schema.runCosts.pages})`, inTok: sql<number>`sum(${schema.runCosts.inputTokens})`, outTok: sql<number>`sum(${schema.runCosts.outputTokens})` })
    .from(schema.runCosts)
    .where(eq(schema.runCosts.userId, userId))
    .groupBy(schema.runCosts.model, schema.runCosts.mode);
  const auditRows = await rt.db.query.adminAudit.findMany({ where: eq(schema.adminAudit.targetUserId, userId), orderBy: desc(schema.adminAudit.createdAt), limit: 20 });
  return { user: row, runs, costs: costs.map((c) => ({ ...c, usd: Number(c.usd) })), audit: auditRows };
}

export async function customerCounts(): Promise<Record<string, number> & { total: number }> {
  const rt = await getRuntime();
  const rows = await rt.db.select({ status: schema.users.status, n: count() }).from(schema.users).groupBy(schema.users.status);
  const out: Record<string, number> = { trial: 0, active: 0, past_due: 0, canceled: 0, deleted: 0 };
  let total = 0;
  for (const r of rows) {
    out[r.status] = Number(r.n);
    total += Number(r.n);
  }
  return { ...out, total };
}

export interface FeedbackMetrics {
  average: number | null;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Weekly average over the last 8 weeks (oldest first). */
  trend: Array<{ weekStart: string; average: number | null; count: number }>;
  /** Lowest-rated recent runs: rating + comment only (never note content). */
  lowest: Array<{ id: number; rating: number; comment: string | null; createdAt: Date; runId: string | null; runKind: string | null; runDate: string | null; email: string }>;
}

export async function feedbackMetrics(): Promise<FeedbackMetrics> {
  const rt = await getRuntime();
  const rows = await rt.db.query.feedback.findMany({ orderBy: desc(schema.feedback.createdAt) });
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const r of rows) distribution[r.rating as 1 | 2 | 3 | 4 | 5]++;
  const average = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : null;
  const trend: FeedbackMetrics["trend"] = [];
  for (let w = 7; w >= 0; w--) {
    const start = DateTime.utc().startOf("week").minus({ weeks: w });
    const end = start.plus({ weeks: 1 });
    const inWeek = rows.filter((r) => r.createdAt >= start.toJSDate() && r.createdAt < end.toJSDate());
    trend.push({ weekStart: start.toISODate()!, average: inWeek.length ? inWeek.reduce((a, r) => a + r.rating, 0) / inWeek.length : null, count: inWeek.length });
  }
  const users = await rt.db.query.users.findMany();
  const lowest = [...rows]
    .filter((r) => r.createdAt.getTime() > Date.now() - 30 * 86_400_000)
    .sort((a, b) => a.rating - b.rating || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);
  const enriched = [];
  for (const r of lowest) {
    const run = r.runId ? await rt.db.query.runs.findFirst({ where: eq(schema.runs.id, r.runId) }) : null;
    enriched.push({ id: r.id, rating: r.rating, comment: r.comment, createdAt: r.createdAt, runId: r.runId, runKind: run?.kind ?? null, runDate: run?.localDate ?? null, email: users.find((u) => u.id === r.userId)?.email ?? "?" });
  }
  return { average, count: rows.length, distribution, trend, lowest: enriched };
}

export async function auditLog(limit = 200) {
  const rt = await getRuntime();
  return rt.db.query.adminAudit.findMany({ orderBy: desc(schema.adminAudit.createdAt), limit });
}

// ---------------------------------------------------------------- destructive actions (typed confirmation, audited)
export async function deleteAccount(userId: string, typedEmail: string): Promise<{ ok: true; purgedRuns: number } | { ok: false; message: string }> {
  const rt = await getRuntime();
  const user = await rt.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return { ok: false, message: "user not found" };
  if (typedEmail.trim().toLowerCase() !== user.email) return { ok: false, message: "Typed confirmation does not match the account email." };
  await audit("admin.account.delete.requested", { email: user.email }, userId);
  const runs = await rt.db.query.runs.findMany({ where: eq(schema.runs.userId, userId) });
  let purged = 0;
  for (const r of runs) {
    try {
      await rt.cache.purge(r.id);
      purged++;
    } catch {
      /* best effort; the 48h sweep is the failsafe */
    }
  }
  // Cascades remove credentials, runs, costs, tasks, events, meetings, documents, sessions, feedback.
  await rt.db.delete(schema.users).where(eq(schema.users.id, userId));
  await audit("admin.account.delete.completed", { email: user.email, purgedRunCaches: purged, runs: runs.length }, userId);
  return { ok: true, purgedRuns: purged };
}

export { repo };
