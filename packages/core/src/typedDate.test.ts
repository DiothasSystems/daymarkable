import { describe, expect, it } from "vitest";
import { parseTypedDate } from "./typedDate.js";

const TODAY = "2026-10-07"; // a Wednesday

describe("parseTypedDate", () => {
  it("reads the ways people type a date", () => {
    expect(parseTypedDate("10/14", TODAY)).toBe("2026-10-14");
    expect(parseTypedDate("10/14/26", TODAY)).toBe("2026-10-14");
    expect(parseTypedDate("10-14-2026", TODAY)).toBe("2026-10-14");
    expect(parseTypedDate("2026-10-14", TODAY)).toBe("2026-10-14");
    expect(parseTypedDate("Oct 14", TODAY)).toBe("2026-10-14");
    expect(parseTypedDate("October 14, 2026", TODAY)).toBe("2026-10-14");
    expect(parseTypedDate("14 Oct", TODAY)).toBe("2026-10-14");
    expect(parseTypedDate("  today ", TODAY)).toBe(TODAY);
    expect(parseTypedDate("tomorrow", TODAY)).toBe("2026-10-08");
  });

  it("takes a date with no year as the next time it comes round", () => {
    expect(parseTypedDate("1/5", TODAY)).toBe("2027-01-05");
    expect(parseTypedDate("10/7", TODAY)).toBe(TODAY);
  });

  it("takes a weekday as the next one, and a week on when it is today", () => {
    expect(parseTypedDate("fri", TODAY)).toBe("2026-10-09");
    expect(parseTypedDate("Friday", TODAY)).toBe("2026-10-09");
    expect(parseTypedDate("wed", TODAY)).toBe("2026-10-14");
  });

  it("refuses what is not a date rather than guessing", () => {
    for (const bad of ["", "soon", "13/40", "2/30/2026", "Octember 3", "next", "frizzle"]) expect(parseTypedDate(bad, TODAY)).toBeNull();
  });
});
