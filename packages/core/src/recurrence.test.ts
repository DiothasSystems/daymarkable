import { describe, expect, it } from "vitest";
import { eventsOnDate, nextOccurrence, occurrencesInRange, occursOn, recurrenceLabel, type Recurrence } from "./recurrence.js";
import type { StoredEvent } from "./state.js";

/** 2026-09-07 is a Monday. */
const MONDAY = "2026-09-07";

const event = (over: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "e1",
  title: "Team meeting",
  date: MONDAY,
  startTime: "09:00",
  endTime: "10:00",
  location: null,
  people: [],
  source: "ink",
  confidence: 0.9,
  status: "active",
  recurrence: null,
  ...over,
});

describe("occursOn", () => {
  it("a one-off falls only on its own date", () => {
    const e = event();
    expect(occursOn(e, MONDAY)).toBe(true);
    expect(occursOn(e, "2026-09-14")).toBe(false);
  });

  it("weekly lands on the same weekday, every week", () => {
    const e = event({ recurrence: "weekly" });
    expect(occursOn(e, MONDAY)).toBe(true);
    expect(occursOn(e, "2026-09-14")).toBe(true); // next Monday
    expect(occursOn(e, "2026-10-05")).toBe(true); // a month later
    expect(occursOn(e, "2026-09-08")).toBe(false); // Tuesday
  });

  it("never lands before the day it was written", () => {
    const e = event({ recurrence: "weekly" });
    expect(occursOn(e, "2026-08-31")).toBe(false); // the Monday before
  });

  it("biweekly skips the alternate week", () => {
    const e = event({ recurrence: "biweekly" });
    expect(occursOn(e, "2026-09-14")).toBe(false);
    expect(occursOn(e, "2026-09-21")).toBe(true);
    expect(occursOn(e, "2026-09-28")).toBe(false);
    expect(occursOn(e, "2026-10-05")).toBe(true);
  });

  it("daily lands every day; weekdays skips the weekend", () => {
    expect(occursOn(event({ recurrence: "daily" }), "2026-09-12")).toBe(true); // Saturday
    expect(occursOn(event({ recurrence: "weekdays" }), "2026-09-12")).toBe(false);
    expect(occursOn(event({ recurrence: "weekdays" }), "2026-09-13")).toBe(false); // Sunday
    expect(occursOn(event({ recurrence: "weekdays" }), "2026-09-11")).toBe(true); // Friday
  });

  it("monthly keeps the day of the month", () => {
    const e = event({ date: "2026-09-15", recurrence: "monthly" });
    expect(occursOn(e, "2026-10-15")).toBe(true);
    expect(occursOn(e, "2026-10-14")).toBe(false);
  });

  it("a monthly meeting on the 31st simply has no February", () => {
    // Clamping to the 28th would invent a date the writer never chose.
    const e = event({ date: "2026-01-31", recurrence: "monthly" });
    expect(occursOn(e, "2026-03-31")).toBe(true);
    expect(occursOn(e, "2026-02-28")).toBe(false);
  });

  it("yearly keeps the month and day", () => {
    const e = event({ date: "2026-09-07", recurrence: "yearly" });
    expect(occursOn(e, "2027-09-07")).toBe(true);
    expect(occursOn(e, "2027-09-08")).toBe(false);
  });

  it("an undated event never occurs", () => {
    expect(occursOn(event({ date: null, recurrence: "weekly" }), MONDAY)).toBe(false);
  });
});

describe("eventsOnDate", () => {
  it("gives an occurrence the date it falls on, not the series anchor", () => {
    const [o] = eventsOnDate([event({ recurrence: "weekly" })], "2026-09-21");
    expect(o!.date).toBe("2026-09-21");
    expect(o!.startTime).toBe("09:00");
    expect(o!.id).toBe("e1"); // still the same series
  });

  it("leaves a one-off on its own date untouched", () => {
    const source = event();
    expect(eventsOnDate([source], MONDAY)[0]).toBe(source);
  });

  it("orders a day's events by start time", () => {
    const events = [event({ id: "b", title: "Late", startTime: "15:00" }), event({ id: "a", title: "Early", startTime: "08:00" })];
    expect(eventsOnDate(events, MONDAY).map((e) => e.title)).toEqual(["Early", "Late"]);
  });
});

describe("occurrencesInRange", () => {
  it("expands a weekly series across the coming week exactly once", () => {
    const out = occurrencesInRange([event({ recurrence: "weekly" })], "2026-09-08", "2026-09-21");
    expect(out.map((e) => e.date)).toEqual(["2026-09-14", "2026-09-21"]);
  });

  it("returns nothing when the range is empty or inverted", () => {
    expect(occurrencesInRange([event({ recurrence: "daily" })], "2026-09-21", "2026-09-08")).toEqual([]);
  });

  it("counts a daily series once per day", () => {
    const out = occurrencesInRange([event({ recurrence: "daily" })], "2026-09-08", "2026-09-10");
    expect(out).toHaveLength(3);
  });
});

describe("recurrenceLabel", () => {
  it("reads as a word on the page", () => {
    const cases: Array<[Recurrence, string]> = [
      ["weekly", "WEEKLY"],
      ["biweekly", "BIWEEKLY"],
      ["weekdays", "WEEKDAYS"],
    ];
    for (const [r, label] of cases) expect(recurrenceLabel(r)).toBe(label);
  });
});

describe("nextOccurrence", () => {
  it("a one-off in the past has no next occurrence", () => {
    expect(nextOccurrence(event({ date: "2026-09-01" }), "2026-09-10")).toBeNull();
  });

  it("a one-off ahead returns its own date", () => {
    expect(nextOccurrence(event({ date: "2026-09-21" }), "2026-09-10")).toBe("2026-09-21");
  });

  it("a weekly series anchored in the past returns the next Monday", () => {
    // The case the web viewer got wrong: a series written weeks ago is still live.
    expect(nextOccurrence(event({ recurrence: "weekly" }), "2026-10-01")).toBe("2026-10-05");
  });

  it("returns today when the series falls today", () => {
    expect(nextOccurrence(event({ recurrence: "weekly" }), "2026-09-14")).toBe("2026-09-14");
  });

  it("never returns a date before the series began", () => {
    expect(nextOccurrence(event({ recurrence: "weekly" }), "2026-08-01")).toBe(MONDAY);
  });

  it("an undated event has no next occurrence", () => {
    expect(nextOccurrence(event({ date: null, recurrence: "weekly" }), "2026-09-10")).toBeNull();
  });
});
