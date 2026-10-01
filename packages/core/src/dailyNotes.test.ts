import { describe, expect, it } from "vitest";
import { appendLines, buildDailyNotes, dailyNotesDate, dailyNotesName, lineTokens, newLines, pageLines, type DailyNoteEntry } from "./dailyNotes.js";

const read = (lines: string[]) => lines.map(lineTokens);

describe("pageLines", () => {
  it("keeps the written lines in order and drops the blank ones", () => {
    expect(pageLines("Call Dana\n\n  - bring the deck  \n\n")).toEqual(["Call Dana", "  - bring the deck"]);
    expect(pageLines("")).toEqual([]);
  });
});

describe("newLines", () => {
  it("reports a page read for the first time in full", () => {
    expect(newLines(null, ["a line", "another"])).toEqual(["a line", "another"]);
  });

  it("reports only what was added since the last reading", () => {
    const monday = ["Vendor review with Priya", "- pricing holds at $10", "- ship in October"];
    const tuesday = [...monday, "Follow up: send the contract"];
    expect(newLines(read(monday), tuesday)).toEqual(["Follow up: send the contract"]);
  });

  it("does not report a line again because a re-read spelled one word differently", () => {
    const before = ["Discussed the quarterly roadmap with the platform team"];
    const after = ["Discussed the quarterly roadmap with the platfrom team", "New: hire two engineers"];
    expect(newLines(read(before), after)).toEqual(["New: hire two engineers"]);
  });

  it("counts a line written twice as new the second time", () => {
    expect(newLines(read(["call Dana"]), ["call Dana", "call Dana"])).toEqual(["call Dana"]);
  });

  it("compares fingerprinted words exactly as it compares words — what the store keeps instead of text", () => {
    const print = (t: string) => `#${t.length}${t.split("").reverse().join("")}`;
    const tokensOf = (l: string) => lineTokens(l).map(print);
    const stored = ["Vendor review with Priya"].map(tokensOf);
    expect(newLines(stored, ["Vendor review with Priya", "send contract"], tokensOf)).toEqual(["send contract"]);
  });

  it("finds nothing new on a page that was only tidied", () => {
    expect(newLines(read(["one", "two"]), ["two", "one"])).toEqual([]);
  });
});

describe("appendLines", () => {
  it("adds a second sync's lines to the day's entry without repeating the first's", () => {
    expect(appendLines(["morning note"], ["morning note", "afternoon note"])).toEqual(["morning note", "afternoon note"]);
  });
});

describe("buildDailyNotes", () => {
  const e = (notebook: string, pageIndex: number, lines: string[], date = "2026-10-01"): DailyNoteEntry => ({ date, docId: notebook, pageId: `${notebook}-${pageIndex}`, notebook, pageIndex, lines });

  it("puts each notebook under its own name, pages in order, and only that day's writing", () => {
    const model = buildDailyNotes("2026-10-01", [e("Work", 4, ["late"]), e("journal", 0, ["dear diary"]), e("Work", 1, ["early"]), e("Work", 2, ["yesterday"], "2026-09-30"), e("Empty", 0, [])]);
    expect(model.notebooks.map((n) => n.notebook)).toEqual(["journal", "Work"]);
    expect(model.notebooks[1]!.pages.map((p) => p.pageIndex)).toEqual([1, 4]);
    expect(model.lineCount).toBe(3);
  });
});

describe("dailyNotesName", () => {
  it("names the document by its date, month first, and reads the date back", () => {
    expect(dailyNotesName("2026-10-01")).toBe("Notes - 10-01-2026");
    expect(dailyNotesDate("Notes - 10-01-2026")).toBe("2026-10-01");
    expect(dailyNotesDate("Notes - Week of 09-07-2026")).toBeNull();
    expect(dailyNotesDate("Notes")).toBeNull();
  });
});
