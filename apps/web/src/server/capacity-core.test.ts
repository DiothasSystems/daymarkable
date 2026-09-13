import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIXED_SECS,
  DEFAULT_PER_PAGE_SECS,
  capacityUsers,
  headroom,
  perUserSecs,
  runCost,
  treeListings,
  utilisation,
} from "./capacity-core.js";

/** The real sample from docs/CAPACITY.md: fourteen runs, 2026-09-06 to 2026-09-13. */
const REAL = [
  { secs: 41, pages: 0 },
  { secs: 38, pages: 3 },
  { secs: 232, pages: 1 },
  { secs: 37, pages: 0 },
  { secs: 430, pages: 7 },
  { secs: 651, pages: 31 },
  { secs: 201, pages: 6 },
  { secs: 38, pages: 0 },
  { secs: 128, pages: 6 },
  { secs: 33, pages: 0 },
  { secs: 33, pages: 0 },
  { secs: 47, pages: 1 },
  { secs: 42, pages: 1 },
  { secs: 200, pages: 16 },
];

describe("runCost", () => {
  it("recovers the documented figures from the real sample", () => {
    const c = runCost(REAL);
    // Zero-page runs: 33, 33, 37, 38, 41 -> median 37.
    expect(c.fixedSecs).toBe(37);
    expect(c.fixedFrom).toBe(5);
    // Per-page median lands near the 13s the doc records, despite two batch-timeout outliers.
    expect(c.perPageSecs).toBeGreaterThan(5);
    expect(c.perPageSecs).toBeLessThan(20);
    expect(c.estimated).toBe(false);
  });

  /**
   * The two runs where the Batch API deadline expired measure the timeout, not the work: they
   * contribute 195 s/page and 56 s/page. A mean would let them set the figure — it comes out near
   * 38 s/page, three times the truth. The median is bounded by them instead of dragged by them.
   */
  it("resists the batch-timeout outliers that would wreck a mean", () => {
    const c = runCost(REAL);
    const marginals = REAL.filter((r) => r.pages > 0).map((r) => (r.secs - c.fixedSecs) / r.pages);
    const mean = marginals.reduce((a, b) => a + b, 0) / marginals.length;
    expect(mean).toBeGreaterThan(35);
    expect(c.perPageSecs).toBeLessThan(mean / 2);
    // Dropping the two outliers moves the median by a few seconds, not by a factor.
    const clean = runCost(REAL.filter((r) => r.secs !== 232 && r.secs !== 430));
    expect(Math.abs(clean.perPageSecs - c.perPageSecs)).toBeLessThan(6);
  });

  it("falls back to the documented defaults until this host has its own runs", () => {
    const c = runCost([{ secs: 40, pages: 0 }, { secs: 100, pages: 4 }]);
    expect(c.fixedSecs).toBe(DEFAULT_FIXED_SECS);
    expect(c.perPageSecs).toBe(DEFAULT_PER_PAGE_SECS);
    expect(c.estimated).toBe(true);
  });

  it("survives no runs at all", () => {
    const c = runCost([]);
    expect(c.fixedSecs).toBe(DEFAULT_FIXED_SECS);
    expect(c.estimated).toBe(true);
    expect(perUserSecs(c, 8)).toBe(DEFAULT_FIXED_SECS + DEFAULT_PER_PAGE_SECS * 8);
  });

  it("never reports a negative page cost when a run beat the fixed estimate", () => {
    // 20s for 2 pages against a 36s fixed default would be -8s/page if left unclamped.
    const c = runCost([{ secs: 20, pages: 2 }, { secs: 20, pages: 2 }, { secs: 20, pages: 2 }]);
    expect(c.perPageSecs).toBe(0);
  });
});

describe("capacity", () => {
  const cost = { fixedSecs: 36, perPageSecs: 13, fixedFrom: 5, perPageFrom: 7, estimated: false };
  const window4h = 4 * 3600;

  it("matches the numbers in the capacity doc", () => {
    const per = perUserSecs(cost, 8);
    expect(per).toBe(140);
    expect(capacityUsers(per, window4h)).toBe(102);
    expect(capacityUsers(per, window4h, 5)).toBe(514);
  });

  it("scales with how many pages a user writes", () => {
    expect(perUserSecs(cost, 0)).toBe(36);
    expect(perUserSecs(cost, 31)).toBe(439);
    expect(capacityUsers(perUserSecs(cost, 31), window4h)).toBeLessThan(capacityUsers(perUserSecs(cost, 8), window4h));
  });

  it("reports utilisation and can exceed the window", () => {
    expect(utilisation(0, 140, window4h)).toBe(0);
    expect(utilisation(102, 140, window4h)).toBeCloseTo(0.99, 1);
    expect(utilisation(200, 140, window4h)).toBeGreaterThan(1);
  });

  it("does not divide by zero on a fresh install", () => {
    expect(capacityUsers(0, window4h)).toBe(0);
    expect(utilisation(5, 140, 0)).toBe(0);
  });
});

describe("headroom", () => {
  const base = { accounts: 1, utilisation: 0.01, treeListings: 8, diskUsedPct: 5, memUsedPct: 13, multiTenant: false };

  it("is quiet on the current single-account install", () => {
    expect(headroom(base).verdict).toBe("ok");
  });

  it("puts the single-user scheduler ahead of every resource signal", () => {
    // Even with everything else healthy, a second account cannot be served.
    const r = headroom({ ...base, accounts: 2 });
    expect(r.verdict).toBe("act");
    expect(r.reason).toContain("scheduler serves one");
  });

  it("warns on a half-full window and acts on a nearly-full one", () => {
    expect(headroom({ ...base, multiTenant: true, accounts: 50, utilisation: 0.55 }).verdict).toBe("watch");
    expect(headroom({ ...base, multiTenant: true, accounts: 80, utilisation: 0.85 }).verdict).toBe("act");
  });

  it("raises the reMarkable ceiling before the host runs out of anything", () => {
    const r = headroom({ ...base, multiTenant: true, accounts: 300, treeListings: 2400 });
    expect(r.verdict).toBe("act");
    expect(r.reason).toContain("tree listings");
  });

  it("notices a full disk and, since there is no swap, tight memory", () => {
    expect(headroom({ ...base, multiTenant: true, diskUsedPct: 90 }).verdict).toBe("act");
    expect(headroom({ ...base, multiTenant: true, diskUsedPct: 72 }).verdict).toBe("watch");
    expect(headroom({ ...base, multiTenant: true, memUsedPct: 90 }).reason).toContain("no swap");
  });
});

describe("treeListings", () => {
  it("counts eight per run, which is what uploadPdf(replace) costs", () => {
    expect(treeListings(1)).toBe(8);
    expect(treeListings(400)).toBe(3200);
  });
});
