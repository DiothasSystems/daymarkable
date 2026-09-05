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
