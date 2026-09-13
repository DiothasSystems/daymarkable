import { describe, expect, it } from "vitest";
import {
  PLAN_PRICE_USD,
  balanceWarning,
  billedUsd,
  burnPerDayUsd,
  expectedNightlyUsd,
  marginPct,
  marginUsd,
  monthlyRecognizedUsd,
  proratedRefund,
  revenueUsd,
  runwayDays,
} from "./finance-core.js";

describe("recognized revenue", () => {
  it("spreads an annual plan across the twelve months it covers", () => {
    expect(monthlyRecognizedUsd("monthly")).toBe(10);
    expect(monthlyRecognizedUsd("annual")).toBeCloseTo(100 / 12, 6);
    // The whole point of prorating: an annual subscriber is worth less per month than a monthly
    // one, because the annual plan is the discount.
    expect(monthlyRecognizedUsd("annual")).toBeLessThan(monthlyRecognizedUsd("monthly"));
  });

  it("scales by period without landing an annual charge whole in one month", () => {
    const subs = { monthly: 3, annual: 2 };
    const perMonth = 3 * 10 + 2 * (100 / 12);
    expect(revenueUsd(subs, "month")).toBeCloseTo(perMonth, 6);
    expect(revenueUsd(subs, "quarter")).toBeCloseTo(perMonth * 3, 6);
    expect(revenueUsd(subs, "year")).toBeCloseTo(perMonth * 12, 6);
    expect(revenueUsd(subs, "week")).toBeCloseTo((perMonth * 12) / 52, 6);
  });

  it("keeps billed cash separate from recognized revenue", () => {
    // Over a full year the two agree; inside one month they must not.
    const subs = { monthly: 0, annual: 1 };
    expect(billedUsd(subs, "year")).toBeCloseTo(PLAN_PRICE_USD.annual, 6);
    expect(revenueUsd(subs, "year")).toBeCloseTo(PLAN_PRICE_USD.annual, 6);
    expect(billedUsd(subs, "month")).toBeCloseTo(100 / 12, 6);
  });

  it("is zero with no subscribers", () => {
    expect(revenueUsd({ monthly: 0, annual: 0 }, "year")).toBe(0);
  });
});

describe("burn rate", () => {
  const days = [
    { day: "2026-09-12", usd: 0.3 },
    { day: "2026-09-11", usd: 0.1 },
    { day: "2026-09-10", usd: 0.2 },
  ];

  it("averages over days that actually spent, not the calendar", () => {
    expect(burnPerDayUsd(days, 7)).toBeCloseTo(0.2, 6);
    // A quiet day must not halve the burn rate and double the apparent runway.
    expect(burnPerDayUsd([...days, { day: "2026-09-09", usd: 0 }], 7)).toBeCloseTo(0.2, 6);
  });

  it("honours the window, newest first", () => {
    expect(burnPerDayUsd(days, 1)).toBeCloseTo(0.3, 6);
  });

  it("is zero when nothing has been spent", () => {
    expect(burnPerDayUsd([], 7)).toBe(0);
    expect(burnPerDayUsd([{ day: "2026-09-12", usd: 0 }], 7)).toBe(0);
    expect(expectedNightlyUsd([])).toBe(0);
  });
});

describe("runway", () => {
  it("divides balance by burn", () => {
    expect(runwayDays(20, 0.5)).toBeCloseTo(40, 6);
  });

  it("is null when nothing is being spent, rather than pretending to be infinite", () => {
    expect(runwayDays(20, 0)).toBeNull();
  });

  it("is zero, not negative, when the credit is gone", () => {
    expect(runwayDays(0, 0.5)).toBe(0);
    expect(runwayDays(-5, 0.5)).toBe(0);
  });
});

describe("low balance warning", () => {
  const now = new Date("2026-09-12T08:00:00Z");

  it("warns inside the threshold and stays quiet outside it", () => {
    expect(balanceWarning({ balanceUsd: 3, burnUsd: 0.5, warnDays: 14, lastWarnedAt: null, now }).warn).toBe(true);
    expect(balanceWarning({ balanceUsd: 100, burnUsd: 0.5, warnDays: 14, lastWarnedAt: null, now }).warn).toBe(false);
  });

  it("warns outright when the credit is exhausted", () => {
    const r = balanceWarning({ balanceUsd: 0, burnUsd: 0.5, warnDays: 14, lastWarnedAt: null, now });
    expect(r.warn).toBe(true);
    expect(r.reason).toContain("exhausted");
  });

  it("does not repeat inside the quiet window, so the alert stays an alert", () => {
    const justWarned = new Date(now.getTime() - 3 * 3_600_000);
    expect(balanceWarning({ balanceUsd: 3, burnUsd: 0.5, warnDays: 14, lastWarnedAt: justWarned, now }).warn).toBe(false);
    const yesterday = new Date(now.getTime() - 25 * 3_600_000);
    expect(balanceWarning({ balanceUsd: 3, burnUsd: 0.5, warnDays: 14, lastWarnedAt: yesterday, now }).warn).toBe(true);
  });

  it("says nothing at all when no balance has been recorded", () => {
    const r = balanceWarning({ balanceUsd: null, burnUsd: 0.5, warnDays: 14, lastWarnedAt: null, now });
    expect(r.warn).toBe(false);
    expect(r.runway).toBeNull();
  });

  it("does not warn on a healthy balance that is simply idle", () => {
    const r = balanceWarning({ balanceUsd: 50, burnUsd: 0, warnDays: 14, lastWarnedAt: null, now });
    expect(r.warn).toBe(false);
    expect(r.runway).toBeNull();
  });
});

describe("margin", () => {
  it("goes negative when a writer costs more to serve than they pay", () => {
    expect(marginUsd(10, 3)).toBeCloseTo(7, 6);
    expect(marginUsd(10, 14)).toBeCloseTo(-4, 6);
    expect(marginPct(10, 3)).toBeCloseTo(70, 6);
    expect(marginPct(0, 3)).toBeNull();
  });
});

describe("prorated refund", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  const end = new Date("2026-10-01T00:00:00Z"); // 30 days

  it("refunds the unused days of a paid period", () => {
    const r = proratedRefund({ paidUsd: 10, periodStart: start, periodEnd: end, now: new Date("2026-09-11T00:00:00Z") });
    expect(r.totalDays).toBe(30);
    expect(r.unusedDays).toBe(20);
    expect(r.usd).toBeCloseTo(6.67, 2);
  });

  it("refunds nothing once the period is over, rather than a negative amount", () => {
    const r = proratedRefund({ paidUsd: 10, periodStart: start, periodEnd: end, now: new Date("2026-10-05T00:00:00Z") });
    expect(r.unusedDays).toBe(0);
    expect(r.usd).toBe(0);
  });

  it("never refunds more than was paid, even before the period starts", () => {
    const r = proratedRefund({ paidUsd: 10, periodStart: start, periodEnd: end, now: new Date("2026-08-01T00:00:00Z") });
    expect(r.unusedDays).toBe(30);
    expect(r.usd).toBeCloseTo(10, 2);
  });

  it("handles an annual period", () => {
    const r = proratedRefund({
      paidUsd: 100,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2027-01-01T00:00:00Z"),
      now: new Date("2026-07-02T00:00:00Z"),
    });
    expect(r.totalDays).toBe(365);
    expect(r.usd).toBeGreaterThan(49);
    expect(r.usd).toBeLessThan(51);
  });

  it("rounds to the cent, because a refund is a payment", () => {
    const r = proratedRefund({ paidUsd: 10, periodStart: start, periodEnd: end, now: new Date("2026-09-08T00:00:00Z") });
    expect(Number.isInteger(r.usd * 100)).toBe(true);
  });
});
