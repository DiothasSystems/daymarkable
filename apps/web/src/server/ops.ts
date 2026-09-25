/**
 * Operator reporting: token burn and runway, revenue, and expenses.
 *
 * The arithmetic lives in finance-core (pure, tested); this file only fetches and assembles.
 * Everything is computed from our own `run_costs`, which records input/output/cache tokens and a
 * dollar cost per model per stage per run. That is deliberately not Anthropic's own figure — see
 * `tokenPlan` for why there is no such figure to fetch.
 */
import "server-only";
import os from "node:os";
import { statfs } from "node:fs/promises";
import { and, desc, eq, gte, isNotNull, isNull, schema, sql } from "@daymarkable/db";
import { ESCALATION_THRESHOLD_MAX, ESCALATION_THRESHOLD_MIN, clampEscalationThreshold } from "@daymarkable/decode";
import { describeOptions, type OptionGroup } from "./admin-core";
import {
  capacityUsers,
  headroom,
  perUserSecs,
  runCost,
  treeListings,
  utilisation,
  type Headroom,
  type RunCost,
  type RunSample,
} from "./capacity-core";
import { DateTime } from "luxon";
import { isPlan, type Plan } from "./billing-core";
import {
  PLAN_PRICE_USD,
  balanceWarning,
  currentBalance,
  billedUsd,
  burnPerDayUsd,
  expectedNightlyUsd,
  revenueUsd,
  runwayDays,
  type CurrentBalance,
  type DailySpend,
  type Period,
  type SubscriberCount,
} from "./finance-core";
import { getRuntime } from "./runtime";
import { audit } from "./audit";

export const PERIODS: Period[] = ["week", "month", "quarter", "year"];

/**
 * Whether the scheduler serves more than one account. False in Phase 0: `ensureDefaultUser`
 * resolves a single account from USER_EMAIL and `scheduler-boot` schedules for that one. Flip this
 * when the Phase 2 multi-tenant scheduler lands — until then the capacity monitor should say so
 * rather than imply a second customer would be served.
 */
export const MULTI_TENANT_SCHEDULER = false;

// ---------------------------------------------------------------- operator settings

export interface OpsSettings {
  /** Whether a NEW account starts with the daily brief / puzzle on. Never touches existing ones. */
  newsForNewUsers: boolean;
  puzzleForNewUsers: boolean;
  anthropicBalanceUsd: number | null;
  balanceAsOf: Date | null;
  warnDays: number;
  warnEmail: string;
  lastWarnedAt: Date | null;
  /** The escalation threshold every account follows unless it has an override of its own. */
  defaultEscalationThreshold: number;
}

const SINGLETON = "singleton";

export async function getOpsSettings(): Promise<OpsSettings> {
  const rt = await getRuntime();
  const row = await rt.db.query.opsSettings.findFirst({ where: eq(schema.opsSettings.id, SINGLETON) });
  return {
    newsForNewUsers: row?.newsForNewUsers ?? true,
    puzzleForNewUsers: row?.puzzleForNewUsers ?? true,
    anthropicBalanceUsd: row?.anthropicBalanceUsd === null || row?.anthropicBalanceUsd === undefined ? null : Number(row.anthropicBalanceUsd),
    balanceAsOf: row?.balanceAsOf ?? null,
    warnDays: row?.warnDays ?? 14,
    warnEmail: row?.warnEmail ?? "diothassystems@gmail.com",
    lastWarnedAt: row?.lastWarnedAt ?? null,
    defaultEscalationThreshold: clampEscalationThreshold(row ? Number(row.defaultEscalationThreshold) : null),
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

/**
 * Switch the daily brief or the puzzle off for accounts created from now on.
 *
 * Deliberately not retroactive. Deciding a feature costs too much is a decision about the next
 * customer, not a reason to take something away from someone already using it — they can still
 * turn it off themselves, and nothing here reaches into their settings.
 */
export async function setNewUserFeatures(patch: { news?: boolean; puzzle?: boolean }): Promise<void> {
  const rt = await getRuntime();
  const values = {
    id: SINGLETON,
    ...(patch.news === undefined ? {} : { newsForNewUsers: patch.news }),
    ...(patch.puzzle === undefined ? {} : { puzzleForNewUsers: patch.puzzle }),
    updatedAt: new Date(),
  };
  await rt.db.insert(schema.opsSettings).values(values).onConflictDoUpdate({ target: schema.opsSettings.id, set: values });
  await audit("admin.features.newUsers", { ...patch });
}

/**
 * Set the escalation threshold for every account that has not overridden it.
 *
 * Takes effect on the next run — nothing is recomputed, because a page already read is already read.
 * Audited like every other operator action (rule 13): it changes what customers are charged for and
 * how accurately their pages are read, which is not a setting to change without a record.
 */
export async function setDefaultEscalationThreshold(value: number): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!Number.isFinite(value) || value < ESCALATION_THRESHOLD_MIN || value > ESCALATION_THRESHOLD_MAX) {
    return { ok: false, message: `Escalation threshold must be between ${ESCALATION_THRESHOLD_MIN} and ${ESCALATION_THRESHOLD_MAX}` };
  }
  const rt = await getRuntime();
  const values = { id: SINGLETON, defaultEscalationThreshold: value.toFixed(3), updatedAt: new Date() };
  await rt.db.insert(schema.opsSettings).values(values).onConflictDoUpdate({ target: schema.opsSettings.id, set: values });
  await audit("admin.decode.escalationThreshold", { value });
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

/**
 * Exact dollars charged since an instant. Deliberately not derived from `dailySpend`, which buckets
 * by UTC day: a balance recorded at 14:00 would otherwise be charged for the morning's spend as
 * well, and the current balance would read low every time it was re-recorded mid-day.
 */
export async function spendSinceUsd(since: Date): Promise<number> {
  const rt = await getRuntime();
  const [row] = await rt.db
    .select({ usd: sql<string>`coalesce(sum(${schema.runCosts.costUsd}), 0)` })
    .from(schema.runCosts)
    .where(gte(schema.runCosts.createdAt, since));
  return Number(row?.usd ?? 0);
}

/**
 * The live balance, or null when nothing has ever been recorded. One resolver so the overview, the
 * tokens page and the warning mail cannot drift apart — three places computing "what is left"
 * separately is three places to get it wrong.
 */
export async function resolveBalance(settings?: OpsSettings): Promise<CurrentBalance | null> {
  const s = settings ?? (await getOpsSettings());
  if (s.anthropicBalanceUsd === null || s.balanceAsOf === null) return null;
  return currentBalance({
    recordedUsd: s.anthropicBalanceUsd,
    recordedAt: s.balanceAsOf,
    spentSinceUsd: await spendSinceUsd(s.balanceAsOf),
    now: new Date(),
  });
}

/** What the overview card needs, and nothing more — it must not pay for the whole token plan. */
export interface BalanceSummary {
  balance: CurrentBalance | null;
  burnPerDayUsd: number;
  runwayDays: number | null;
  warnDays: number;
  low: boolean;
}

export async function balanceSummary(): Promise<BalanceSummary> {
  const settings = await getOpsSettings();
  const [balance, days] = await Promise.all([resolveBalance(settings), dailySpend(30)]);
  const burn = burnPerDayUsd(days, 7);
  const runway = balance === null ? null : runwayDays(balance.currentUsd, burn);
  return {
    balance,
    burnPerDayUsd: burn,
    runwayDays: runway,
    warnDays: settings.warnDays,
    low: runway !== null && runway <= settings.warnDays,
  };
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
  /** The recorded snapshot drawn down by spend since. Null until a balance is recorded. */
  balance: CurrentBalance | null;
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
  const balance = await resolveBalance(settings);
  // Runway from the CURRENT balance, not the recorded one. Using the snapshot would overstate the
  // runway by exactly as much as has been spent since it was typed in, and grow more wrong daily —
  // which is the one direction a runway figure must never err in.
  const runway = balance === null ? null : runwayDays(balance.currentUsd, burn);
  return {
    settings,
    balance,
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
  const [days, balance] = await Promise.all([dailySpend(30), resolveBalance(settings)]);
  const burn = burnPerDayUsd(days, 7);
  const decision = balanceWarning({
    balanceUsd: balance === null ? null : balance.currentUsd,
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
    `Balance now: $${(balance?.currentUsd ?? 0).toFixed(2)}`,
    `Recorded: $${(settings.anthropicBalanceUsd ?? 0).toFixed(2)}${settings.balanceAsOf ? ` on ${settings.balanceAsOf.toISOString().slice(0, 10)}` : ""}, less $${(balance?.spentSinceUsd ?? 0).toFixed(2)} spent since`,
    `Burn rate: $${burn.toFixed(4)} per day over the last 7 spending days`,
    `Runway: ${runway}`,
    `Warn threshold: ${settings.warnDays} days`,
    "",
    "Top up at https://platform.claude.com/settings/billing then record the new balance in the admin portal.",
  ];
  const res = await rt.mail.send({
    to: settings.warnEmail,
    subject: `ScriptumIQ — ${decision.reason}`,
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
  /**
   * Spend this month that belongs to no customer: the shared daily crossword. Reported separately
   * rather than folded into `byUser`, because it is neither one person's cost nor invisible — the
   * money was spent, and the per-account rows above deliberately do not add up to the total without
   * it.
   */
  house: { stage: string; usd: number }[];
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
  const house = await rt.db
    .select({ stage: schema.runCosts.stage, usd: sql<string>`sum(${schema.runCosts.costUsd})` })
    .from(schema.runCosts)
    .where(and(isNull(schema.runCosts.userId), gte(schema.runCosts.createdAt, monthStart)))
    .groupBy(schema.runCosts.stage)
    .orderBy(sql`sum(${schema.runCosts.costUsd}) desc`);
  return {
    periods: PERIODS.map((period) => ({ period, usd: totalFor(PERIOD_DAYS[period]) })),
    byModel: await spendByModel(30),
    byUser: byUser.map((r) => ({ ...r, usd: Number(r.usd), pages: Number(r.pages), userId: r.userId! })),
    house: house.map((r) => ({ stage: r.stage, usd: Number(r.usd) })),
    days: days.slice(0, 30),
  };
}

// ---------------------------------------------------------------- per-user reporting extras

/** One day of one account's consumption, as the cost review reads it. */
export interface UserDay {
  /** The run's LOCAL date, not a UTC bucket — see the query for why that matters. */
  localDate: string;
  costUsd: number;
  pages: number;
  tokens: number;
  runs: number;
  onDemand: number;
  failed: number;
  /** Which models read that night, so an escalation is visible rather than averaged away. */
  models: string;
}

/**
 * Daily token cost and pages for one account, newest first.
 *
 * Grouped by `runs.local_date` rather than by the cost row's timestamp. A nightly run starts at 00:07
 * local and an on-demand sync can land at any hour, so a UTC day would split one night's work across
 * two rows for anyone west of Greenwich — and the local date is the day the customer would name.
 *
 * LEFT JOIN from runs, so a night that ran and cost nothing still appears. A missing row and a zero
 * row mean different things: nothing ran, versus nothing changed.
 */
export async function userDailyCosts(userId: string, days = 30): Promise<UserDay[]> {
  const rt = await getRuntime();
  const rows = await rt.db
    .select({
      localDate: schema.runs.localDate,
      costUsd: sql<string>`coalesce(sum(${schema.runCosts.costUsd}), 0)`,
      tokens: sql<string>`coalesce(sum(${schema.runCosts.inputTokens} + ${schema.runCosts.outputTokens} + ${schema.runCosts.cacheReadTokens} + ${schema.runCosts.cacheWriteTokens}), 0)`,
      pages: sql<string>`coalesce(sum(${schema.runCosts.pages}), 0)`,
      runs: sql<string>`count(distinct ${schema.runs.id})`,
      onDemand: sql<string>`count(distinct ${schema.runs.id}) filter (where ${schema.runs.kind} = 'on_demand')`,
      failed: sql<string>`count(distinct ${schema.runs.id}) filter (where ${schema.runs.status} = 'failed')`,
      models: sql<string>`coalesce(string_agg(distinct ${schema.runCosts.model}, ', '), '')`,
    })
    .from(schema.runs)
    // Joined on the COST's owner as well as the run's. Without the second condition a house cost —
    // the shared crossword, paid for by whichever run reached midnight first — would be counted
    // against that customer here, which is the distortion booking it to the house exists to avoid.
    .leftJoin(schema.runCosts, and(eq(schema.runCosts.runId, schema.runs.id), eq(schema.runCosts.userId, userId)))
    .where(eq(schema.runs.userId, userId))
    .groupBy(schema.runs.localDate)
    .orderBy(desc(schema.runs.localDate))
    .limit(days);
  return rows.map((r) => ({
    localDate: r.localDate,
    costUsd: Number(r.costUsd),
    pages: Number(r.pages),
    tokens: Number(r.tokens),
    runs: Number(r.runs),
    onDemand: Number(r.onDemand),
    failed: Number(r.failed),
    models: r.models,
  }));
}

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
  /** Everything the customer switched on or typed in. Read-only on this screen.  */
  options: OptionGroup[];
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
    options: describeOptions(user?.settings ?? {}),
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
    // House spend has no user, and a null key in a per-user map is a bug waiting to be indexed.
    .where(isNotNull(schema.runCosts.userId))
    .groupBy(schema.runCosts.userId);
  return new Map(rows.map((r) => [r.userId!, Number(r.tokens) / Number(r.days)] as const));
}

// ---------------------------------------------------------------- capacity

/**
 * The planning window: 00:01 local, when the automatic run fires, to 06:00, by which time the
 * notebooks want to be on the tablet. Runs may finish later without anything breaking; this is the
 * budget capacity is measured against, not a deadline the code enforces.
 */
export const WINDOW_SECS = 6 * 3600;
/** Runs overlapped when planning the concurrent figure. They are almost entirely network wait. */
export const PLANNED_CONCURRENCY = 5;

export interface CapacitySnapshot {
  cost: RunCost;
  /** Pages a night, median across accounts that wrote anything — what "a typical user" costs. */
  medianPages: number;
  perUserSecs: number;
  accounts: number;
  usersSerial: number;
  usersConcurrent: number;
  utilisation: number;
  treeListings: number;
  headroom: Headroom;
  /** Nightly wall clock actually used, newest first, against the window. */
  recentNights: { day: string; secs: number; runs: number; pages: number }[];
  host: {
    cores: number;
    loadAvg: number;
    memTotalBytes: number;
    memFreeBytes: number;
    memUsedPct: number;
    diskTotalBytes: number;
    diskFreeBytes: number;
    diskUsedPct: number;
    /** No swap on this host, so a memory spike is an OOM kill rather than a slowdown. */
    swapKnown: false;
  };
  /** False while `ensureDefaultUser` serves one account; the cap is one regardless of resources. */
  multiTenant: boolean;
  windowSecs: number;
  concurrency: number;
}

export async function capacitySnapshot(): Promise<CapacitySnapshot> {
  const rt = await getRuntime();

  const runs = await rt.db
    .select({
      // localDate, not a UTC calendar day: it is already the run's own notion of which night it
      // belongs to, and a UTC day boundary would split one night for users in some zones.
      day: schema.runs.localDate,
      secs: sql<string>`extract(epoch from (${schema.runs.finishedAt} - ${schema.runs.startedAt}))`,
      pages: sql<string>`coalesce((${schema.runs.stats}->>'pagesDecoded')::int, 0)`,
    })
    .from(schema.runs)
    .where(and(eq(schema.runs.status, "succeeded"), sql`${schema.runs.startedAt} is not null and ${schema.runs.finishedAt} is not null`))
    .orderBy(desc(schema.runs.createdAt))
    .limit(200);
  const samples: RunSample[] = runs.map((r) => ({ secs: Math.max(0, Math.round(Number(r.secs))), pages: Number(r.pages) }));
  const cost = runCost(samples);

  // Nights are the unit that matters: several runs can land on one date, and the window holds the
  // sum of them, not the longest.
  const byDay = new Map<string, { secs: number; runs: number; pages: number }>();
  for (const r of runs) {
    const prev = byDay.get(r.day) ?? { secs: 0, runs: 0, pages: 0 };
    byDay.set(r.day, { secs: prev.secs + Math.round(Number(r.secs)), runs: prev.runs + 1, pages: prev.pages + Number(r.pages) });
  }
  const recentNights = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14).map(([day, v]) => ({ day, ...v }));

  const written = samples.filter((s) => s.pages > 0).map((s) => s.pages).sort((a, b) => a - b);
  const medianPages = written.length ? written[Math.floor(written.length / 2)]! : 8;

  const [active] = await rt.db
    .select({ n: sql<string>`count(*)` })
    .from(schema.users)
    .where(sql`${schema.users.status} in ('trial','active','past_due')`);
  const accounts = Number(active?.n ?? 0);

  const per = perUserSecs(cost, medianPages);
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsedPct = memTotal > 0 ? ((memTotal - memFree) / memTotal) * 100 : 0;
  let diskTotal = 0;
  let diskFree = 0;
  try {
    // The container's root is the host's disk through the overlay, which is the number that fills.
    const fs = await statfs("/");
    diskTotal = Number(fs.blocks) * Number(fs.bsize);
    diskFree = Number(fs.bavail) * Number(fs.bsize);
  } catch {
    /* not fatal: the page renders without disk figures rather than 500ing */
  }
  const diskUsedPct = diskTotal > 0 ? ((diskTotal - diskFree) / diskTotal) * 100 : 0;
  const listings = treeListings(accounts);

  return {
    cost,
    medianPages,
    perUserSecs: per,
    accounts,
    usersSerial: capacityUsers(per, WINDOW_SECS),
    usersConcurrent: capacityUsers(per, WINDOW_SECS, PLANNED_CONCURRENCY),
    utilisation: utilisation(accounts, per, WINDOW_SECS, PLANNED_CONCURRENCY),
    treeListings: listings,
    headroom: headroom({ accounts, utilisation: utilisation(accounts, per, WINDOW_SECS, PLANNED_CONCURRENCY), treeListings: listings, diskUsedPct, memUsedPct, multiTenant: MULTI_TENANT_SCHEDULER }),
    recentNights,
    host: {
      cores: os.cpus().length,
      loadAvg: os.loadavg()[0] ?? 0,
      memTotalBytes: memTotal,
      memFreeBytes: memFree,
      memUsedPct,
      diskTotalBytes: diskTotal,
      diskFreeBytes: diskFree,
      diskUsedPct,
      swapKnown: false,
    },
    multiTenant: MULTI_TENANT_SCHEDULER,
    windowSecs: WINDOW_SECS,
    concurrency: PLANNED_CONCURRENCY,
  };
}
