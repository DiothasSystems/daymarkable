/**
 * Capacity arithmetic: how long a run costs, therefore how many accounts fit in a night.
 *
 * Pure and tested, like billing-core and finance-core. The method is the one recorded in
 * docs/CAPACITY.md — a run has a fixed cost (listing the whole reMarkable account and diffing it)
 * plus a marginal cost per page decoded, and the two have to be separated or the per-page figure
 * comes out about three times worse than it is.
 */

/** A finished run, reduced to the two numbers capacity depends on. */
export interface RunSample {
  secs: number;
  pages: number;
}

/** Measured on the founder's account, 2026-09-13. Used until this host has enough runs of its own. */
export const DEFAULT_FIXED_SECS = 36;
export const DEFAULT_PER_PAGE_SECS = 13;

/** Runs needed before this host's own numbers are preferred to the documented ones. */
export const MIN_SAMPLES = 3;

export interface RunCost {
  fixedSecs: number;
  perPageSecs: number;
  /** How many zero-page and page-bearing runs each figure came from. */
  fixedFrom: number;
  perPageFrom: number;
  /** True when either figure fell back to the documented default for want of data. */
  estimated: boolean;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Split run duration into its fixed and per-page parts.
 *
 * Median rather than mean throughout, because the sample reliably contains a couple of runs where
 * the Batch API deadline expired and the wall clock measures the timeout instead of the work. One
 * of those would drag a mean badly; neither moves a median.
 */
export function runCost(samples: readonly RunSample[]): RunCost {
  const zero = samples.filter((r) => r.pages === 0).map((r) => r.secs);
  const fixedFrom = zero.length;
  const fixedSecs = fixedFrom >= MIN_SAMPLES ? median(zero) : DEFAULT_FIXED_SECS;

  const withPages = samples.filter((r) => r.pages > 0);
  // Marginal cost only, so the fixed part comes off first. Clamped at zero: a run faster than the
  // fixed estimate means the estimate is high, not that a page took negative time.
  const marginal = withPages.map((r) => Math.max(0, (r.secs - fixedSecs) / r.pages));
  const perPageFrom = marginal.length;
  const perPageSecs = perPageFrom >= MIN_SAMPLES ? median(marginal) : DEFAULT_PER_PAGE_SECS;

  return {
    fixedSecs,
    perPageSecs,
    fixedFrom,
    perPageFrom,
    estimated: fixedFrom < MIN_SAMPLES || perPageFrom < MIN_SAMPLES,
  };
}

/** Seconds one account costs on a night when it writes `pages` pages. */
export function perUserSecs(cost: RunCost, pages: number): number {
  return cost.fixedSecs + cost.perPageSecs * Math.max(0, pages);
}

/**
 * Accounts that fit in the window. `concurrency` is how many runs overlap: runs are almost
 * entirely network wait, so overlapping them is close to linear until something else binds.
 */
export function capacityUsers(perUser: number, windowSecs: number, concurrency = 1): number {
  if (perUser <= 0) return 0;
  return Math.floor((windowSecs * Math.max(1, concurrency)) / perUser);
}

/** Share of the window the current account count would use, 0..1+ (it can exceed 1). */
export function utilisation(accounts: number, perUser: number, windowSecs: number, concurrency = 1): number {
  if (windowSecs <= 0) return 0;
  return (accounts * perUser) / (windowSecs * Math.max(1, concurrency));
}

export type Verdict = "ok" | "watch" | "act";

export interface Headroom {
  verdict: Verdict;
  /** One line naming the thing that is closest to binding. */
  reason: string;
}

/**
 * What to do, if anything. Thresholds are deliberately early: the fix for every one of these is
 * work (a scheduler, request hygiene, staggered start times), and work wants lead time. "act" does
 * not mean a bigger host — docs/CAPACITY.md is clear that hardware is the last thing to bind.
 */
export function headroom(input: {
  accounts: number;
  utilisation: number;
  /** Tree listings a night across all accounts; the reMarkable rate limit is the real ceiling. */
  treeListings: number;
  diskUsedPct: number;
  memUsedPct: number;
  /** False while the scheduler serves a single account, which caps the host at one regardless. */
  multiTenant: boolean;
}): Headroom {
  if (!input.multiTenant && input.accounts > 1) {
    return { verdict: "act", reason: `${input.accounts} accounts exist but the scheduler serves one — Phase 2 scheduler needed before any of this matters` };
  }
  if (input.utilisation >= 0.8) return { verdict: "act", reason: `nightly window is ${(input.utilisation * 100).toFixed(0)}% full` };
  if (input.diskUsedPct >= 85) return { verdict: "act", reason: `disk is ${input.diskUsedPct.toFixed(0)}% full` };
  if (input.memUsedPct >= 85) return { verdict: "act", reason: `memory is ${input.memUsedPct.toFixed(0)}% used and there is no swap` };
  if (input.treeListings >= 2000) return { verdict: "act", reason: `${input.treeListings.toLocaleString()} reMarkable tree listings a night — one tree per run, and stagger start times` };
  if (input.utilisation >= 0.5) return { verdict: "watch", reason: `nightly window is ${(input.utilisation * 100).toFixed(0)}% full` };
  if (input.treeListings >= 800) return { verdict: "watch", reason: `${input.treeListings.toLocaleString()} reMarkable tree listings a night` };
  if (input.diskUsedPct >= 70) return { verdict: "watch", reason: `disk is ${input.diskUsedPct.toFixed(0)}% full` };
  return { verdict: "ok", reason: "nothing close to binding" };
}

/** Tree listings a night: roughly eight per run, because uploadPdf(replace) lists before it deletes. */
export const TREE_LISTINGS_PER_RUN = 8;

export function treeListings(accounts: number): number {
  return accounts * TREE_LISTINGS_PER_RUN;
}
