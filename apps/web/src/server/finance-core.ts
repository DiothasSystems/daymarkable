/**
 * Revenue, token burn and runway arithmetic. Pure and tested, like billing-core and admin-core,
 * because these are the numbers an operator makes decisions on and a silent off-by-twelve in
 * annual recognition is not the kind of thing a dashboard makes obvious.
 *
 * No DB, no Next, no network.
 */
import type { Plan } from "./billing-core";

/** List price in dollars per billing interval. Monthly is per month, annual is per year. */
export const PLAN_PRICE_USD: Record<Plan, number> = { monthly: 10, annual: 100 };

export type Period = "week" | "month" | "quarter" | "year";

/** Months in each reporting period. A week is a twelfth of a quarter, near enough for MRR maths. */
export const PERIOD_MONTHS: Record<Period, number> = { week: 12 / 52, month: 1, quarter: 3, year: 12 };

/**
 * What one subscription contributes to a month, with annual spread across the twelve months it
 * covers rather than landed whole in the month it was charged. Asked for explicitly: "annual is
 * prorated by month". It means a month of mixed plans reads as a comparable number instead of
 * spiking every time an annual renews.
 */
export function monthlyRecognizedUsd(plan: Plan): number {
  return plan === "annual" ? PLAN_PRICE_USD.annual / 12 : PLAN_PRICE_USD.monthly;
}

export interface SubscriberCount {
  monthly: number;
  annual: number;
}

/** Recognized revenue for a period at the current subscriber mix. */
export function revenueUsd(subs: SubscriberCount, period: Period): number {
  const perMonth = subs.monthly * monthlyRecognizedUsd("monthly") + subs.annual * monthlyRecognizedUsd("annual");
  return perMonth * PERIOD_MONTHS[period];
}

/** Cash actually collected in a period, which is not the same shape as recognized revenue. */
export function billedUsd(subs: SubscriberCount, period: Period): number {
  const months = PERIOD_MONTHS[period];
  return subs.monthly * PLAN_PRICE_USD.monthly * months + subs.annual * PLAN_PRICE_USD.annual * (months / 12);
}

// ---------------------------------------------------------------- token burn and runway

export interface DailySpend {
  /** ISO date, UTC. */
  day: string;
  usd: number;
}

/**
 * Average dollars a day over the trailing window, counting only days we have data for. Counting
 * empty days as zero would flatter the burn rate on a new account and overstate the runway,
 * which is the one direction a runway estimate must never be wrong in.
 */
export function burnPerDayUsd(days: readonly DailySpend[], window = 7): number {
  const recent = [...days].sort((a, b) => b.day.localeCompare(a.day)).slice(0, window);
  const spending = recent.filter((d) => d.usd > 0);
  if (spending.length === 0) return 0;
  return spending.reduce((n, d) => n + d.usd, 0) / spending.length;
}

/** What one more night is expected to cost: the trailing mean of nights that actually ran. */
export function expectedNightlyUsd(days: readonly DailySpend[], window = 14): number {
  return burnPerDayUsd(days, window);
}

/**
 * Days of credit left at the current burn. Null when nothing is being spent — "infinite runway"
 * is not a number, and rendering it as one invites a warning that never fires or always does.
 */
export function runwayDays(balanceUsd: number, burnUsd: number): number | null {
  if (burnUsd <= 0) return null;
  if (balanceUsd <= 0) return 0;
  return balanceUsd / burnUsd;
}

// ---------------------------------------------------------------- balance now

export interface CurrentBalance {
  /** What the operator typed in, and when they typed it. */
  recordedUsd: number;
  recordedAt: Date;
  /** Everything run_costs has charged since that moment. */
  spentSinceUsd: number;
  /** The figure worth looking at: what was recorded, less what has been spent since. */
  currentUsd: number;
  /** How stale the recorded figure is. */
  ageDays: number;
  /** The arithmetic says there is nothing left. */
  exhausted: boolean;
  /**
   * The arithmetic says we have spent MORE than was ever recorded, which is impossible unless a
   * top-up went unrecorded. Worth saying out loud rather than rendering a negative balance as if
   * it were a fact about Anthropic.
   */
  overspent: boolean;
}

/**
 * The live credit balance: the recorded snapshot, drawn down by our own spend since.
 *
 * Anthropic publishes no balance endpoint (see `tokenPlan`), so the recorded figure is the only
 * ground truth available and it is stale the moment it is typed. Subtracting `run_costs` from it
 * is not a guess — it is the same ledger every other number on these screens comes from, so the
 * two agree by construction.
 *
 * It can go negative, and that is information rather than a bug: it means credit was topped up
 * without recording it. `overspent` says so, and the UI should ask for a fresh figure rather than
 * pretend the account is $4 in the red.
 */
export function currentBalance(input: { recordedUsd: number; recordedAt: Date; spentSinceUsd: number; now: Date }): CurrentBalance {
  const spent = Math.max(0, input.spentSinceUsd);
  const currentUsd = input.recordedUsd - spent;
  return {
    recordedUsd: input.recordedUsd,
    recordedAt: input.recordedAt,
    spentSinceUsd: spent,
    currentUsd,
    ageDays: Math.max(0, (input.now.getTime() - input.recordedAt.getTime()) / 86_400_000),
    exhausted: currentUsd <= 0,
    overspent: currentUsd < 0,
  };
}

export interface BalanceWarning {
  warn: boolean;
  /** Why, in one line, ready for the subject of the mail. */
  reason: string;
  runway: number | null;
}

/**
 * Whether to raise the low-credit alarm, and whether we are allowed to raise it again yet.
 * `lastWarnedAt` exists so a low balance mails once a day rather than once every scheduler tick;
 * an alert that arrives every fifteen minutes gets filtered, and then it is not an alert.
 */
export function balanceWarning(input: {
  balanceUsd: number | null;
  burnUsd: number;
  warnDays: number;
  lastWarnedAt: Date | null;
  now: Date;
  minHoursBetween?: number;
}): BalanceWarning {
  const { balanceUsd, burnUsd, warnDays, lastWarnedAt, now } = input;
  const runway = balanceUsd === null ? null : runwayDays(balanceUsd, burnUsd);
  if (balanceUsd === null) return { warn: false, reason: "no balance recorded", runway: null };
  const hours = input.minHoursBetween ?? 24;
  if (lastWarnedAt && now.getTime() - lastWarnedAt.getTime() < hours * 3_600_000) {
    return { warn: false, reason: "already warned recently", runway };
  }
  if (balanceUsd <= 0) return { warn: true, reason: "Anthropic credit is exhausted", runway: 0 };
  if (runway === null) return { warn: false, reason: "nothing is being spent", runway: null };
  if (runway <= warnDays) {
    return { warn: true, reason: `About ${runway.toFixed(1)} days of Anthropic credit left`, runway };
  }
  return { warn: false, reason: "runway is fine", runway };
}

// ---------------------------------------------------------------- unit economics

/**
 * Gross margin on one account for a period: what it pays us against what its pages cost to read.
 * Negative is the number worth knowing — a heavy writer on the monthly plan can cost more to
 * serve than they pay, and nothing else on the admin screens would say so.
 */
export function marginUsd(recognizedUsd: number, tokenCostUsd: number): number {
  return recognizedUsd - tokenCostUsd;
}

export function marginPct(recognizedUsd: number, tokenCostUsd: number): number | null {
  if (recognizedUsd <= 0) return null;
  return (marginUsd(recognizedUsd, tokenCostUsd) / recognizedUsd) * 100;
}

// ---------------------------------------------------------------- prorated refund

export interface ProratedRefund {
  /** Dollars to refund, rounded to the cent. */
  usd: number;
  unusedDays: number;
  totalDays: number;
}

/**
 * The unused part of a period the customer has already paid for.
 *
 * Day-granular on purpose: refunding by the second invites an argument about which second, and
 * every plan here is billed monthly or annually. Clamped at both ends — cancelling on the last
 * day refunds nothing rather than a negative, and a period that has not started yet refunds all
 * of it rather than more than was paid.
 */
export function proratedRefund(input: { paidUsd: number; periodStart: Date; periodEnd: Date; now: Date }): ProratedRefund {
  const { paidUsd, periodStart, periodEnd, now } = input;
  const day = 86_400_000;
  const totalDays = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / day));
  const rawUnused = Math.ceil((periodEnd.getTime() - now.getTime()) / day);
  const unusedDays = Math.min(totalDays, Math.max(0, rawUnused));
  const usd = Math.round(Math.max(0, paidUsd) * (unusedDays / totalDays) * 100) / 100;
  return { usd, unusedDays, totalDays };
}
