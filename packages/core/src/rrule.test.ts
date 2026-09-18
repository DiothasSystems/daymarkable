/**
 * RRULE expansion — the cases the old `recurrence` enum could not express.
 *
 * Every rule here is one a real Outlook or Google invite produces. The point of full RRULE support
 * is that these land on the right days; an enum-shaped approximation would put them on the wrong
 * ones and leave nothing behind to say so.
 */
import { describe, expect, it } from "vitest";
import { MAX_OCCURRENCES, nextOccurrence, occurrencesInRange, occursOn } from "./recurrence.js";
import type { CalendarItem } from "./types.js";

const event = (over: Partial<CalendarItem>): CalendarItem => ({
  id: "e1",
  title: "Board meeting",
  date: "2026-09-17",
  startTime: "09:00",
  endTime: "10:30",
  location: null,
  people: [],
  source: "external",
  confidence: 1,
  ...over,
});

const hits = (e: CalendarItem, from: string, to: string) => occurrencesInRange([e], from, to).map((o) => o.date);

describe("full RRULE", () => {
  /** "The third Thursday of the month" — the case with no enum equivalent at all. */
  it("expands an ordinal weekday of the month", () => {
    const e = event({ date: "2026-09-17", rrule: "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3;COUNT=5" });
    expect(hits(e, "2026-09-01", "2027-02-28")).toEqual(["2026-09-17", "2026-10-15", "2026-11-19", "2026-12-17", "2027-01-21"]);
  });

  /** Two days a week, ending on a date — Outlook's default for a standup. */
  it("expands several weekdays a week and stops at UNTIL", () => {
    const e = event({ date: "2026-09-21", rrule: "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261021T000000Z" });
    const got = hits(e, "2026-09-01", "2026-12-31");
    expect(got[0]).toBe("2026-09-21");
    expect(got).toContain("2026-09-23");
    expect(got.at(-1)).toBe("2026-10-19");
    expect(got).not.toContain("2026-10-21");
  });

  it("honours an interval", () => {
    const e = event({ date: "2026-09-21", rrule: "FREQ=WEEKLY;INTERVAL=3;COUNT=4" });
    expect(hits(e, "2026-09-01", "2026-12-31")).toEqual(["2026-09-21", "2026-10-12", "2026-11-02", "2026-11-23"]);
  });

  /**
   * The organiser deleting one meeting out of a series. It has to beat everything, including the
   * anchor being its own first occurrence — a cancelled first meeting is still cancelled.
   */
  it("removes an excluded date, even when it is the anchor", () => {
    const series = event({ date: "2026-09-21", rrule: "FREQ=WEEKLY;COUNT=4", exdates: ["2026-10-05"] });
    expect(hits(series, "2026-09-01", "2026-12-31")).toEqual(["2026-09-21", "2026-09-28", "2026-10-12"]);

    const anchorGone = event({ date: "2026-09-21", rrule: "FREQ=WEEKLY;COUNT=3", exdates: ["2026-09-21"] });
    expect(occursOn(anchorGone, "2026-09-21")).toBe(false);
    expect(occursOn(anchorGone, "2026-09-28")).toBe(true);
  });

  it("counts the anchor as an occurrence even when the rule alone would not pick it", () => {
    // Anchored on a Monday, rule says Thursdays. RFC 5545 makes DTSTART part of the set.
    const e = event({ date: "2026-09-21", rrule: "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3;COUNT=2" });
    expect(occursOn(e, "2026-09-21")).toBe(true);
  });

  it("never fires before the day the series starts", () => {
    const e = event({ date: "2026-09-21", rrule: "FREQ=DAILY" });
    expect(occursOn(e, "2026-09-20")).toBe(false);
    expect(occursOn(e, "2026-09-21")).toBe(true);
  });

  it("finds the next occurrence of a rule the enum cannot describe", () => {
    const e = event({ date: "2026-09-17", rrule: "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3" });
    expect(nextOccurrence(e, "2026-10-01")).toBe("2026-10-15");
    expect(nextOccurrence(e, "2026-10-16")).toBe("2026-11-19");
  });

  /** An endless rule has to stop somewhere, and it must stop rather than hang. */
  it("bounds a rule with no UNTIL and no COUNT", () => {
    const e = event({ date: "2026-01-01", rrule: "FREQ=DAILY" });
    expect(occursOn(e, "2026-06-15")).toBe(true);
    expect(MAX_OCCURRENCES).toBeGreaterThan(365 * 5);
  });

  it("survives a rule it cannot parse, keeping the day the meeting was actually set for", () => {
    const e = event({ date: "2026-09-21", rrule: "FREQ=NONSENSE;;;" });
    expect(occursOn(e, "2026-09-21")).toBe(true);
    expect(occursOn(e, "2026-09-28")).toBe(false);
  });

  /**
   * An event can carry both, and the rule must win: the enum is a lossy label kept for printing
   * ("WEEKLY" on a page), and reading it in preference would move the meeting.
   */
  it("prefers the rule over the written shorthand when an event has both", () => {
    const e = event({ date: "2026-09-21", recurrence: "daily", rrule: "FREQ=WEEKLY;COUNT=3" });
    expect(occursOn(e, "2026-09-22")).toBe(false);
    expect(occursOn(e, "2026-09-28")).toBe(true);
  });

  it("leaves hand-written recurrence exactly as it was", () => {
    const e = event({ date: "2026-09-21", recurrence: "weekly" });
    expect(occursOn(e, "2026-09-28")).toBe(true);
    expect(occursOn(e, "2026-09-22")).toBe(false);
  });

  /**
   * The reason expansion is cached. A year of a daily series asks the same rule 365 times, and each
   * ask would otherwise walk the whole series from its anchor.
   */
  it("expands a long daily series across a year without falling over", () => {
    const e = event({ date: "2026-01-01", rrule: "FREQ=DAILY" });
    const start = Date.now();
    const got = hits(e, "2026-01-01", "2026-12-31");
    expect(got).toHaveLength(365);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
