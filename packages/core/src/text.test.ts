import { describe, expect, it } from "vitest";
import { repairNoteLines } from "./text.js";

/** The real shape of the defect: the page's lines joined with runs of spaces. */
const FLAT =
  "Sync On Optim API Access & Cellular Backup  SCTE ?  MDU ?  Cellular Backup - Support on FWA Nokia - Support Monitoring  1.) 5G Modem Switching";

describe("repairNoteLines", () => {
  it("leaves a properly structured note exactly as it is", () => {
    const good = "AI Learning Projects\n-Power\n-Smart Building";
    expect(repairNoteLines(good)).toBe(good);
  });

  it("does not touch a single short line of prose", () => {
    const one = "Discussed the installation window";
    expect(repairNoteLines(one)).toBe(one);
  });

  it("splits a flattened note back onto its written lines", () => {
    expect(repairNoteLines(FLAT).split("\n")).toEqual([
      "Sync On Optim API Access & Cellular Backup",
      "SCTE ?",
      "MDU ?",
      "Cellular Backup - Support on FWA Nokia - Support Monitoring",
      "1.) 5G Modem Switching",
    ]);
  });

  it("repairs a flattened body sitting under a heading line", () => {
    // The case the whole-note guard used to skip: the merge puts the topic on its own line, so
    // the note contained a newline and nothing was repaired.
    const mixed = `Synamedia\n${FLAT}`;
    const out = repairNoteLines(mixed).split("\n");
    expect(out[0]).toBe("Synamedia");
    expect(out[1]).toBe("Sync On Optim API Access & Cellular Backup");
    expect(out.length).toBe(6);
  });

  it("repairs only the flattened section, keeping blank-line gaps", () => {
    const out = repairNoteLines(`Heading\n\n${FLAT}`).split("\n");
    expect(out[0]).toBe("Heading");
    expect(out[1]).toBe("");
    expect(out[2]).toBe("Sync On Optim API Access & Cellular Backup");
  });

  it("leaves a wide gap inside a short line alone", () => {
    const short = "Done.  Next week we review";
    expect(repairNoteLines(short)).toBe(short);
  });

  it("is idempotent", () => {
    const once = repairNoteLines(FLAT);
    expect(repairNoteLines(once)).toBe(once);
    expect(repairNoteLines(repairNoteLines(`Synamedia\n${FLAT}`))).toBe(repairNoteLines(`Synamedia\n${FLAT}`));
  });

  it("handles empty and whitespace-only text", () => {
    expect(repairNoteLines("")).toBe("");
    expect(repairNoteLines("   ")).toBe("   ");
  });
});
