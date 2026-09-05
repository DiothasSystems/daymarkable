import { describe, expect, it } from "vitest";
import { newDocument } from "./canvas.js";
import { BODY_SIZE, LINE_H, Section, type ComposeContext, type RowItem } from "./section.js";

const ROW: RowItem = {
  id: "t1",
  type: "task",
  text: "",
  tag: null,
  meta: null,
  carried: false,
  emphasis: false,
};

/** Draw one checkbox row and record every baseline `canvas.text` was called at. */
async function drawRow(text: string): Promise<{ baselines: number[]; strings: string[]; endY: number }> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: "2026-09-05", generatedAt: "2026-09-05T03:00:00Z", runLabel: "test", printed: [] };
  const s = new Section(ctx, "ACTIONS", () => "Action List", () => "test");
  s.newPage();
  const calls: { text: string; y: number }[] = [];
  const real = s.canvas.text.bind(s.canvas);
  s.canvas.text = (t: string, x: number, y: number, opts) => {
    calls.push({ text: t, y });
    return real(t, x, y, opts);
  };
  const top = s.y;
  s.checkboxRow({ ...ROW, text }, "A");
  // The item code is drawn at the first baseline too; only the wrapped body lines matter here.
  const body = calls.filter((c) => c.text !== "A01");
  return { baselines: body.map((c) => c.y - top), strings: body.map((c) => c.text), endY: s.y - top };
}

describe("checkboxRow", () => {
  it("draws a single-line action once", async () => {
    const r = await drawRow("Call the dentist");
    expect(r.strings).toEqual(["Call the dentist"]);
    expect(r.baselines).toEqual([BODY_SIZE]);
  });

  it("puts each wrapped line on its own baseline", async () => {
    // Long enough to wrap; the bug this pins printed every line at the first baseline, so the
    // row came out as a smear of overlapping text.
    const r = await drawRow(
      "Follow up with the regional operations team about the Sacramento site survey and confirm the revised installation window before the end of the quarter",
    );
    expect(r.strings.length).toBeGreaterThan(1);
    // No two lines share a baseline, and they step down by exactly one line height.
    expect(new Set(r.baselines).size).toBe(r.baselines.length);
    r.baselines.forEach((y, i) => expect(y).toBe(BODY_SIZE + i * LINE_H));
    // Every wrapped line is drawn exactly once.
    expect(new Set(r.strings).size).toBe(r.strings.length);
  });

  it("reserves height for every line it drew", async () => {
    const r = await drawRow(
      "Follow up with the regional operations team about the Sacramento site survey and confirm the revised installation window before the end of the quarter",
    );
    const lastBaseline = Math.max(...r.baselines);
    expect(r.endY).toBeGreaterThan(lastBaseline);
  });
});

/** Record every string the notes body draws, with its baseline and x offset. */
async function drawNotes(text: string): Promise<{ strings: string[]; xs: number[]; ys: number[] }> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: "2026-09-05", generatedAt: "2026-09-05T03:00:00Z", runLabel: "test", printed: [] };
  const s = new Section(ctx, "MEETINGS", () => "Meeting Notes", () => "test");
  s.newPage();
  const calls: { text: string; x: number; y: number }[] = [];
  const real = s.canvas.text.bind(s.canvas);
  s.canvas.text = (t: string, x: number, y: number, opts) => {
    calls.push({ text: t, x, y });
    return real(t, x, y, opts);
  };
  s.notesBlock(text);
  return { strings: calls.map((c) => c.text), xs: calls.map((c) => c.x), ys: calls.map((c) => c.y) };
}

describe("notesBlock", () => {
  it("keeps each written line on its own line", async () => {
    const r = await drawNotes("Meetings in Sacramento\nAI Learning Projects\nBudget review");
    expect(r.strings).toEqual(["Meetings in Sacramento", "AI Learning Projects", "Budget review"]);
    expect(new Set(r.ys).size).toBe(3);
  });

  it("does not run a dashed list together into a paragraph", async () => {
    // The reported defect: "-Power / -Smart Building / -LLM & ML" came out as one wall of text.
    const r = await drawNotes("AI Learning Projects\n-Power\n-Smart Building\n-LLM & ML");
    expect(r.strings).toContain("Power");
    expect(r.strings).toContain("Smart Building");
    expect(r.strings).toContain("LLM & ML");
    expect(r.strings.some((t) => t.includes("Power") && t.includes("Smart Building"))).toBe(false);
  });

  it("keeps the marker and hangs the text beside it", async () => {
    const r = await drawNotes("-Power");
    const marker = r.strings.indexOf("–");
    expect(marker).toBeGreaterThanOrEqual(0);
    const body = r.strings.indexOf("Power");
    expect(r.xs[body]!).toBeGreaterThan(r.xs[marker]!);
    expect(r.ys[body]!).toBe(r.ys[marker]!);
  });

  it("indents a sub-item under its parent", async () => {
    const r = await drawNotes("- Projects\n  - Power");
    const parent = r.strings.indexOf("Projects");
    const child = r.strings.indexOf("Power");
    expect(r.xs[child]!).toBeGreaterThan(r.xs[parent]!);
  });

  it("treats a blank line as a gap, not a row", async () => {
    const r = await drawNotes("First block\n\nSecond block");
    expect(r.strings).toEqual(["First block", "Second block"]);
  });

  it("still wraps a line too long for the page", async () => {
    const long = "The regional operations team confirmed the revised installation window and asked for the survey to be repeated before the end of the quarter so the schedule holds";
    const r = await drawNotes(long);
    expect(r.strings.length).toBeGreaterThan(1);
    expect(new Set(r.ys).size).toBe(r.strings.length);
  });
});

describe("note bullet markers", () => {
  it("keeps a numbered marker whole", async () => {
    // From a real page: "1.) Harmony - RF Optimization" was split into marker "1." and text
    // ") Harmony - RF Optimization", stranding the bracket.
    const r = await drawNotes("1.) Harmony - RF Optimization");
    expect(r.strings).toContain("1.)");
    expect(r.strings).toContain("Harmony - RF Optimization");
    expect(r.strings.some((t) => t.startsWith(")"))).toBe(false);
  });

  it("recognises lettered markers so they align with numbered ones", async () => {
    const r = await drawNotes("b.) 80 -> 40 for 5G\nc) TxPower Reduction");
    expect(r.strings).toContain("b.)");
    expect(r.strings).toContain("c)");
    expect(r.strings).toContain("80 -> 40 for 5G");
    expect(r.strings).toContain("TxPower Reduction");
  });

  it("accepts the plain forms too", async () => {
    const r = await drawNotes("1. First\n2) Second\n- Third");
    expect(r.strings).toContain("1.");
    expect(r.strings).toContain("2)");
    expect(r.strings).toContain("–");
  });

  it("does not treat a sentence starting with a capital and a dot as a marker", async () => {
    const r = await drawNotes("A. Smith joined the call");
    expect(r.strings).toEqual(["A. Smith joined the call"]);
  });
});
