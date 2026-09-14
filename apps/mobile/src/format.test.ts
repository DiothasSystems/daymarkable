/**
 * The dates the app draws, and the one piece of copy it repeats from the web.
 *
 * `dueTag` exists in two places (see format.ts). This file is what keeps them saying the same
 * thing: the cases below are the branches of `dueTag` in apps/web/src/server/services.ts, in the
 * same order, with the same words.
 */
import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayTitle, dueTag, monthEnd, monthGrid, monthStart, monthTitle, shortDate, sourceLine } from "./format.js";

const TODAY = "2026-09-14"; // a Monday

describe("dueTag", () => {
  it("says the same as the web's copy, branch for branch", () => {
    expect(dueTag(null, TODAY)).toBeNull();
    expect(dueTag("2026-09-13", TODAY)).toEqual({ label: "OVERDUE", soon: true });
    expect(dueTag("2026-09-14", TODAY)).toEqual({ label: "TODAY", soon: true });
    expect(dueTag("2026-09-15", TODAY)).toEqual({ label: "TOMORROW", soon: true });
    expect(dueTag("2026-09-21", TODAY)).toEqual({ label: "THIS WEEK", soon: false });
    expect(dueTag("2026-09-30", TODAY)).toEqual({ label: "THIS MONTH", soon: false });
    expect(dueTag("2026-10-02", TODAY)).toEqual({ label: "2 OCT", soon: false });
  });

  it("treats the seventh day as this week and the eighth as this month", () => {
    expect(dueTag(addDays(TODAY, 7), TODAY)?.label).toBe("THIS WEEK");
    expect(dueTag(addDays(TODAY, 8), TODAY)?.label).toBe("THIS MONTH");
  });
});

describe("dates", () => {
  it("moves by days and months without drifting through a timezone", () => {
    // The bug this guards: doing any of this with local Date objects shifts the day west of UTC.
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(monthStart("2026-09-14")).toBe("2026-09-01");
    expect(monthEnd("2026-09-14")).toBe("2026-09-30");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
  });

  it("titles a month and a day the way the planner prints them", () => {
    expect(monthTitle("2026-09-14")).toBe("September 2026");
    expect(dayTitle("2026-09-14")).toBe("Mon 14 Sep");
    expect(shortDate("2026-10-02")).toBe("2 Oct");
  });
});

describe("monthGrid", () => {
  it("starts on the Monday on or before the first, and runs six full weeks", () => {
    const grid = monthGrid("2026-09-14");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-08-31"); // the Monday before Tue 1 Sep
    expect(grid[41]).toBe("2026-10-11");
    expect(grid).toContain("2026-09-01");
    expect(grid).toContain("2026-09-30");
  });

  it("handles a month that begins on a Monday without a blank leading week", () => {
    const grid = monthGrid("2026-06-15"); // June 2026 starts on a Monday
    expect(grid[0]).toBe("2026-06-01");
  });
});

describe("sourceLine", () => {
  it("cites the page, counting from one the way a person does", () => {
    expect(sourceLine({ notebook: "Daily", pageIndex: 2 })).toBe("DAILY · p.3");
  });

  it("says nothing for an item that was typed rather than written", () => {
    // An item created in the app carries no notebook (packages/pipeline/src/edits.ts).
    expect(sourceLine({ notebook: "", pageIndex: 0 })).toBeNull();
    expect(sourceLine(null)).toBeNull();
  });
});
