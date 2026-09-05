import { describe, expect, it } from "vitest";
import { repairNoteLines } from "./text.js";

describe("repairNoteLines", () => {
  it("leaves a properly structured note exactly as it is", () => {
    const good = "AI Learning Projects\n-Power\n-Smart Building";
    expect(repairNoteLines(good)).toBe(good);
  });

  it("does not touch a single line of prose", () => {
    const one = "Discussed the installation window and agreed to repeat the survey";
    expect(repairNoteLines(one)).toBe(one);
  });

  it("splits a flattened note back onto its written lines", () => {
    // Real shape of the defect: the decoder returned the page's lines joined with runs of
    // spaces, single spaces inside each line.
    const flat = "Sync On Optim API Access & Cellular Backup  SCTE ?  MDU ?  Cellular Backup - Support on FWA";
    expect(repairNoteLines(flat).split("\n")).toEqual([
      "Sync On Optim API Access & Cellular Backup",
      "SCTE ?",
      "MDU ?",
      "Cellular Backup - Support on FWA",
    ]);
  });

  it("is idempotent", () => {
    const flat = "One item  Second item  Third item";
    const once = repairNoteLines(flat);
    expect(repairNoteLines(once)).toBe(once);
  });

  it("never fires on text that already has any newline", () => {
    // A note the decoder got right can contain wide gaps; leaving it alone is the safe default.
    const mixed = "Heading\nFirst  item with a wide gap";
    expect(repairNoteLines(mixed)).toBe(mixed);
  });

  it("handles empty and whitespace-only text", () => {
    expect(repairNoteLines("")).toBe("");
    expect(repairNoteLines("   ")).toBe("   ");
  });
});
