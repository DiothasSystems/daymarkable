/**
 * Operator reporting: token burn and runway, revenue, and expenses.
 *
 * The arithmetic lives in finance-core (pure, tested); this file only fetches and assembles.
 * Everything is computed from our own `run_costs`, which records input/output/cache tokens and a
 * dollar cost per model per stage per run. That is deliberately not Anthropic's own figure — see
 * `tokenPlan` for why there is no such figure to fetch.
 */
import "server-only";
import { and, desc, eq, gte, schema, sql } from "@daymarkable/db";
import { DateTime } from "luxon";
import { isPlan, type Plan } from "./billing-core";
import {
  PLAN_PRICE_USD,
  balanceWarning,
  billedUsd,
  burnPerDayUsd,
  expectedNightlyUsd,
  revenueUsd,
  runwayDays,
  type DailySpend,
  type Period,
  type SubscriberCount,
} from "./finance-core";
import { getRuntime } from "./runtime";
import { audit } from "./audit";

export const PERIODS: Period[] = ["week", "month", "quarter", "year"];

// ---------------------------------------------------------------- operator settings

export interface OpsSettings {
  anthropicBalanceUsd: number | null;
  balanceAsOf: Date | null;
  warnDays: number;
  warnEmail: string;
  lastWarnedAt: Date | null;
}

const SINGLETON = "singleton";

export async function getOpsSettings(): Promise<OpsSettings> {
  const rt = await getRuntime();
  const row = await rt.db.query.opsSettings.findFirst({ where: eq(schema.opsSettings.id, SINGLETON) });
  return {
    anthropicBalanceUsd: row?.anthropicBalanceUsd === null || row?.anthropicBalanceUsd === undefined ? null : Number(row.anthropicBalanceUsd),
    balanceAsOf: row?.balanceAsOf ?? null,
    warnDays: row?.warnDays ?? 14,
    warnEmail: row?.warnEmail ?? "diothassystems@gmail.com",
    lastWarnedAt: row?.lastWarnedAt ?? null,
  };
}

/** Recording a new balance clears `lastWarnedAt`, so a top-up is allowed to warn again. */
export async function recordBalance(balanceUsd: number | null, warnDays: number): Promise<{ ok: true } | { ok: false; message: string }> {
  if (balanceUsd !== null && (!Number.isFinite(balanceUsd) || balanceUsd < 0)) {
    return { ok: false, message: "Balance must be a number, zero or more" };
  }
  if (!Number.isFinite(warnDays) || warnDays < 1 || warnDays > 365) {
    return { ok: false, message: "Warn at must be between 1 and 365 days" };
  }
  const rt = await getRuntime();
  const values = {
    id: SINGLETON,
    anthropicBalanceUsd: balanceUsd === null ? null : balanceUsd.toFixed(2),
    balanceAsOf: balanceUsd === null ? null : new Date(),
    warnDays: Math.round(warnDays),
    lastWarnedAt: null,
    updatedAt: new Date(),
  };
  await rt.db.insert(schema.opsSettings).values(values).onConflictDoUpdate({ target: schema.opsSettings.id, set: values });
  await audit("admin.tokens.balance", { balanceUsd, warnDays });
  return { ok: true };
}

// ---------------------------------------------------------------- spend

/** Dollars per UTC day over the trailing window, newest first. */
export async function dailySpend(days = 30): Promise<DailySpend[]> {
  const rt = await getRuntime();
  const since = DateTime.utc().minus({ days }).startOf("day").toJSDate();
  const rows = await rt.db
    .select({ day: sql<string>`to_char(date_trunc('day', ${schema.runCosts.createdAt}), 'YYYY-MM-DD')`, usd: sql<string>`sum(${schema.runCosts.costUsd})` })
    .from(schema.runCosts)
    .where(gte(schema.runCosts.createdAt, since))
    .groupBy(sql`date_trunc('day', ${schema.runCosts.createdAt})`)
    .orderBy(sql`date_trunc('day', ${schema.runCosts.createdAt}) desc`);
  return rows.map((r) => ({ day: r.day, usd: Number(r.usd) }));
}

export interface ModelSpendRow {
  model: string;
  mode: string;
  pages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number;
}

export async function spendByModel(sinceDays: number): Promise<ModelSpendRow[]> {
  const rt = await getRuntime();
  const since = DateTime.utc().minus({ days: sinceDays }).startOf("day").toJSDate();
  const rows = await rt.db
    .select({
      model: schema.runCosts.model,
      mode: schema.runCosts.mode,
      pages: sql<string>`sum(${schema.runCosts.pages})`,
      inputTokens: sql<string>`sum(${schema.runCosts.inputTokens})`,
      outputTokens: sql<string>`sum(${schema.runCosts.outputTokens})`,
      cacheReadTokens: sql<string>`sum(${schema.runCosts.cacheReadTokens})`,
      cacheWriteTokens: sql<string>`sum(${schema.runCosts.cacheWriteTokens})`,
      usd: sql<string>`sum(${schema.runCosts.costUsd})`,
    })
    .from(schema.runCosts)
    .where(gte(schema.runCosts.createdAt, since))
    .groupBy(schema.runCosts.model, schema.runCosts.mode)
    .orderBy(sql`sum(${schema.runCosts.costUsd}) desc`);
  return rows.map((r) => ({
    model: r.model,
    mode: r.mode,
    pages: Number(r.pages),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    cacheReadTokens: Number(r.cacheReadTokens),
    cacheWriteTokens: Number(r.cacheWriteTokens),
    usd: Number(r.usd),
  }));
}

// ---------------------------------------------------------------- token plan

export interface TokenPlan {
  settings: OpsSettings;
  /** Trailing daily spend, newest first, for the chart and the burn rate. */
  days: DailySpend[];
  burnPerDayUsd: number;
  expectedNightlyUsd: number;
  /** Per active account, so the projection can be scaled when accounts are added. */
  expectedPerAccountUsd: number;
  activeAccounts: number;
  runwayDays: number | null;
  runwayUntil: Date | null;
  projectedMonthUsd: number;
  byModel: ModelSpendRow[];
  /**
   * Why the balance is typed in rather than fetched. Anthropic publishes no credit-balance
   * endpoint: the Usage and Cost Admin API reports historical usage and spend only, and is
   * unavailable to individual accounts regardless. Kept here so the screen can say so.
   */
  balanceIsManual: true;
}

export async function tokenPlan(): Promise<TokenPlan> {
  const rt = await getRuntime();
  const [settings, days, byModel] = await Promise.all([getOpsSettings(), dailySpend(30), spendByModel(30)]);
  const [active] = await rt.db
    .select({ n: sql<string>`count(*)` })
    .from(schema.users)
    .where(sql`${schema.users.status} in ('trial','active','past_due')`);
  const activeAccounts = Number(active?.n ?? 0);
  const burn = burnPerDayUsd(days, 7);
  const nightly = expectedNightlyUsd(days, 14);
  const runway = settings.anthropicBalanceUsd === null ? null : runwayDays(settings.anthropicBalanceUsd, burn);
  return {
    settings,
    days,
    burnPerDayUsd: burn,
    expectedNightlyUsd: nightly,
    expectedPerAccountUsd: activeAccounts > 0 ? nightly / activeAccounts : nightly,
    activeAccounts,
    runwayDays: runway,
    runwayUntil: runway === null ? null : DateTime.utc().plus({ days: runway }).toJSDate(),
    projectedMonthUsd: nightly * 30,
    byModel,
    balanceIsManual: true,
  };
}

/**
 * Send the low-credit warning if it is due. Called from the scheduler tick, so it is checked
 * every fifteen minutes but mails at most daily (finance-core decides which).
 */
export async function checkBalanceWarning(log: (m: string) => void = () => {}): Promise<"sent" | "not_due" | "no_provider"> {
  const rt = await getRuntime();
  const settings = await getOpsSettings();
  const days = await dailySpend(30);
  const burn = burnPerDayUsd(days, 7);
  const decision = balanceWarning({
    balanceUsd: settings.anthropicBalanceUsd,
    burnUsd: burn,
    warnDays: settings.warnDays,
    lastWarnedAt: settings.lastWarnedAt,
    now: new Date(),
  });
  if (!decision.warn) return "not_due";

  const runway = decision.runway === null ? "unknown" : `${decision.runway.toFixed(1)} days`;
  const lines = [
    decision.reason,
    "",
    `Balance recorded: $${(settings.anthropicBalanceUsd ?? 0).toFixed(2)}${settings.balanceAsOf ? ` (as of ${settings.balanceAsOf.toISOString().slice(0, 10)})` : ""}`,
    `Burn rate: $${burn.toFixed(4)} per day over the last 7 spending days`,
    `Runway: ${runway}`,
    `Warn threshold: ${settings.warnDays} days`,
    "",
    "Top up at https://platform.claude.com/settings/billing then record the new balance in the admin portal.",
  ];
  const res = await rt.mail.send({
    to: settings.warnEmail,
    subject: `dayMarkable — ${decision.reason}`,
    text: lines.join("\n"),
    html: `<p>${lines.slice(0, 1).join("")}</p><pre style="font:13px ui-monospace,monospace">${lines.slice(2).join("\n")}</pre>`,
    // One warning per day per threshold: the key carries the date so a retry cannot double-send.
    idempotencyKey: `credit-warning:${new Date().toISOString().slice(0, 10)}:${settings.warnDays}`,
  });
  if (res.status === "skipped") {
    log("credit warning not sent: no email provider configured");
    return "no_provider";
  }
  await rt.db
    .insert(schema.opsSettings)
    .values({ id: SINGLETON, lastWarnedAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.opsSettings.id, set: { lastWarnedAt: new Date(), updatedAt: new Date() } });
  log(`credit warning mailed to ${settings.warnEmail}: ${decision.reason}`);
  return "sent";
}

// ---------------------------------------------------------------- revenue

export interface RevenueSummary {
  subs: SubscriberCount;
  trialing: number;
  pastDue: number;
  canceled: number;
  /** Recognized (annual spread by month) and billed (cash) for each period. */
  periods: { period: Period; recognizedUsd: number; billedUsd: number }[];
  /** Token cost over the same window, so margin is visible beside revenue. */
  monthTokenCostUsd: number;
  prices: typeof PLAN_PRICE_USD;
}

export async function revenueSummary(): Promise<RevenueSummary> {
  const rt = await getRuntime();
  const rows = await rt.db
    .select({ status: schema.users.status, plan: schema.users.plan, n: sql<string>`count(*)` })
    .from(schema.users)
    .groupBy(schema.users.status, schema.users.plan);
  const subs: SubscriberCount = { monthly: 0, annual: 0 };
  let trialing = 0;
  let pastDue = 0;
  let canceled = 0;
  for (const r of rows) {
    const n = Number(r.n);
    if (r.status === "active" || r.status === "past_due") {
      const plan: Plan = isPlan(r.plan) ? r.plan : "monthly";
      subs[plan] += n;
    }
    if (r.status === "trial") trialing += n;
    if (r.status === "past_due") pastDue += n;
    if (r.status === "canceled") canceled += n;
  }
  const monthStart = DateTime.utc().startOf("month").toJSDate();
  const [cost] = await rt.db
    .select({ usd: sql<string>`coalesce(sum(${schema.runCosts.costUsd}), 0)` })
    .from(schema.runCosts)
    .where(gte(schema.runCosts.createdAt, monthStart));
  return {
    subs,
    trialing,
    pastDue,
    canceled,
    periods: PERIODS.map((period) => ({ period, recognizedUsd: revenueUsd(subs, period), billedUsd: billedUsd(subs, period) })),
    monthTokenCostUsd: Number(cost?.usd ?? 0),
    prices: PLAN_PRICE_USD,
  };
}

// ---------------------------------------------------------------- expenses

export interface ExpenseSummary {
  periods: { period: Period; usd: number }[];
  byModel: ModelSpendRow[];
  /** Per-account spend this month, heaviest first, so an unprofitable writer is visible. */
  byUser: { userId: string; email: string; plan: string | null; usd: number; pages: number }[];
  days: DailySpend[];
}

const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, quarter: 91, year: 365 };

export async function expenseSummary(): Promise<ExpenseSummary> {
  const rt = await getRuntime();
  const days = await dailySpend(365);
  const totalFor = (n: number) => {
    const cutoff = DateTime.utc().minus({ days: n }).startOf("day").toISODate()!;
    return days.filter((d) => d.day >= cutoff).reduce((s, d) => s + d.usd, 0);
  };
  const monthStart = DateTime.utc().startOf("month").toJSDate();
  const byUser = await rt.db
    .select({
      userId: schema.runCosts.userId,
      email: schema.users.email,
      plan: schema.users.plan,
      usd: sql<string>`sum(${schema.runCosts.costUsd})`,
      pages: sql<string>`sum(${schema.runCosts.pages})`,
    })
    .from(schema.runCosts)
    .innerJoin(schema.users, eq(schema.users.id, schema.runCosts.userId))
    .where(gte(schema.runCosts.createdAt, monthStart))
    .groupBy(schema.runCosts.userId, schema.users.email, schema.users.plan)
    .orderBy(sql`sum(${schema.runCosts.costUsd}) desc`);
  return {
    periods: PERIODS.map((period) => ({ period, usd: totalFor(PERIOD_DAYS[period]) })),
    byModel: await spendByModel(30),
    byUser: byUser.map((r) => ({ ...r, usd: Number(r.usd), pages: Number(r.pages) })),
    days: days.slice(0, 30),
  };
}

// ---------------------------------------------------------------- per-user reporting extras

export interface UserOpsFacts {
  /** Mean confidence of everything the decoder produced for this account. */
  confidenceAvg: number | null;
  confidenceItems: number;
  calibration: { status: string; accuracy: number | null; capturedAt: Date | null } | null;
  /** What they told us they do, which is what shapes the calibration passage and the lexicon. */
  role: string | null;
  industry: string | null;
  lexiconTerms: number;
  /** Nights with a successful run, so "pages per night" divides by something real. */
  nights: number;
  tokensPerDay: number;
}

export async function userOpsFacts(userId: string): Promise<UserOpsFacts> {
  const rt = await getRuntime();
  const user = await rt.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const confidence = await rt.db
    .select({ sum: sql<string>`coalesce(sum(c),0)`, n: sql<string>`count(*)` })
    .from(
      sql`(
        select ${schema.tasks.confidence} as c from ${schema.tasks} where ${schema.tasks.userId} = ${userId}
        union all
        select ${schema.events.confidence} as c from ${schema.events} where ${schema.events.userId} = ${userId}
        union all
        select ${schema.meetings.confidence} as c from ${schema.meetings} where ${schema.meetings.userId} = ${userId}
      ) as all_confidence`,
    );
  const items = Number(confidence[0]?.n ?? 0);
  const cal = await rt.db.query.calibrations.findFirst({
    where: eq(schema.calibrations.userId, userId),
    orderBy: desc(schema.calibrations.createdAt),
  });
  const [nights] = await rt.db
    .select({ n: sql<string>`count(distinct ${schema.runs.localDate})` })
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, userId), eq(schema.runs.status, "succeeded")));
  const [tok] = await rt.db
    .select({
      tokens: sql<string>`coalesce(sum(${schema.runCosts.inputTokens} + ${schema.runCosts.outputTokens} + ${schema.runCosts.cacheReadTokens} + ${schema.runCosts.cacheWriteTokens}),0)`,
      days: sql<string>`greatest(count(distinct date_trunc('day', ${schema.runCosts.createdAt})), 1)`,
    })
    .from(schema.runCosts)
    .where(eq(schema.runCosts.userId, userId));
  return {
    confidenceAvg: items > 0 ? Number(confidence[0]!.sum) / items : null,
    confidenceItems: items,
    calibration: cal ? { status: cal.status, accuracy: cal.accuracy, capturedAt: cal.capturedAt } : null,
    role: user?.settings.profile?.role ?? null,
    industry: user?.settings.profile?.industry ?? null,
    lexiconTerms: user?.settings.lexicon.length ?? 0,
    nights: Number(nights?.n ?? 0),
    tokensPerDay: Number(tok?.tokens ?? 0) / Number(tok?.days ?? 1),
  };
}

/** Service start: when they began paying if we know, else when they finished setup, else signup. */
export async function serviceStartedAt(user: { onboardedAt: Date | null; createdAt: Date; trialUsedAt: Date | null }): Promise<Date> {
  return user.trialUsedAt ?? user.onboardedAt ?? user.createdAt;
}

/** Calibration state for every account at once, for the users table. */
export async function calibrationByUser(): Promise<Map<string, { status: string; accuracy: number | null }>> {
  const rt = await getRuntime();
  const rows = await rt.db
    .select({ userId: schema.calibrations.userId, status: schema.calibrations.status, accuracy: schema.calibrations.accuracy, createdAt: schema.calibrations.createdAt })
    .from(schema.calibrations)
    .orderBy(desc(schema.calibrations.createdAt));
  const out = new Map<string, { status: string; accuracy: number | null }>();
  for (const r of rows) if (!out.has(r.userId)) out.set(r.userId, { status: r.status, accuracy: r.accuracy });
  return out;
}

/** Mean decoded-item confidence for every account at once, for the users table. */
export async function confidenceByUser(): Promise<Map<string, { avg: number; items: number }>> {
  const rt = await getRuntime();
  const rows = await rt.db
    .select({ userId: sql<string>`user_id`, sum: sql<string>`coalesce(sum(c),0)`, n: sql<string>`count(*)` })
    .from(
      sql`(
        select ${schema.tasks.userId} as user_id, ${schema.tasks.confidence} as c from ${schema.tasks}
        union all
        select ${schema.events.userId} as user_id, ${schema.events.confidence} as c from ${schema.events}
        union all
        select ${schema.meetings.userId} as user_id, ${schema.meetings.confidence} as c from ${schema.meetings}
      ) as all_confidence`,
    )
    .groupBy(sql`user_id`);
  const out = new Map<string, { avg: number; items: number }>();
  for (const r of rows) {
    const items = Number(r.n);
    if (items > 0) out.set(r.userId, { avg: Number(r.sum) / items, items });
  }
  return out;
}

/** Tokens per day for every account at once, for the users table. */
export async function tokensPerDayByUser(): Promise<Map<string, number>> {
  const rt = await getRuntime();
  const rows = await rt.db
    .select({
      userId: schema.runCosts.userId,
      tokens: sql<string>`sum(${schema.runCosts.inputTokens} + ${schema.runCosts.outputTokens} + ${schema.runCosts.cacheReadTokens} + ${schema.runCosts.cacheWriteTokens})`,
      days: sql<string>`greatest(count(distinct date_trunc('day', ${schema.runCosts.createdAt})), 1)`,
    })
    .from(schema.runCosts)
    .groupBy(schema.runCosts.userId);
  return new Map(rows.map((r) => [r.userId, Number(r.tokens) / Number(r.days)] as const));
}
