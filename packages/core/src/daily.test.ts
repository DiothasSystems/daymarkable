import { emptyExtraction, type ExtractedTask } from "@daymarkable/decode";
import { describe, expect, it } from "vitest";
import { assembleDailySheet } from "./daily.js";
import { normalizeText, similar } from "./text.js";

const task = (text: string, extra: Partial<ExtractedTask> = {}): ExtractedTask => ({
  text,
  due: null,
  due_time: null,
  priority: "normal",
  kind: "action",
  project: null,
  people: [],
  source_convention: "asterisk",
  confidence: 0.9,
  ...extra,
});

const opts = {
  date: "2026-09-02",
  timezone: "America/New_York",
  generatedAt: "2026-09-02T03:00:00-04:00",
  runLabel: "nightly",
  confidenceThreshold: 0.7,
};

describe("assembleDailySheet", () => {
  it("dedupes 'call dentist' written twice into one task", () => {
    const ex = { ...emptyExtraction("notes"), tasks: [task("Call dentist"), task("call the dentist!")] };
    const sheet = assembleDailySheet([{ notebook: "N", pageIndex: 0, extraction: ex }], opts);
    expect(sheet.actions).toHaveLength(1);
  });

  it("routes low-confidence items to the Inbox, never the action list", () => {
    const ex = { ...emptyExtraction("notes"), tasks: [task("renew passport", { confidence: 0.4 })] };
    const sheet = assembleDailySheet([{ notebook: "N", pageIndex: 0, extraction: ex }], opts);
    expect(sheet.actions).toHaveLength(0);
    expect(sheet.inbox.map((i) => i.text)).toEqual(["renew passport"]);
  });

  it("orders by due date then priority, undated last", () => {
    const ex = {
      ...emptyExtraction("notes"),
      tasks: [
        task("later thing"),
        task("tomorrow low", { due: "2026-09-03", priority: "low" }),
        task("tomorrow high", { due: "2026-09-03", priority: "high" }),
        task("today", { due: "2026-09-02" }),
      ],
    };
    const sheet = assembleDailySheet([{ notebook: "N", pageIndex: 0, extraction: ex }], opts);
    expect(sheet.actions.map((a) => a.text)).toEqual(["today", "tomorrow high", "tomorrow low", "later thing"]);
  });

  it("is idempotent: same input, same ids and order", () => {
    const ex = { ...emptyExtraction("notes"), tasks: [task("call Steve", { due: "2026-09-08", due_time: "14:00" })] };
    const a = assembleDailySheet([{ notebook: "N", pageIndex: 0, extraction: ex }], opts);
    const b = assembleDailySheet([{ notebook: "N", pageIndex: 0, extraction: ex }], opts);
    expect(a.actions).toEqual(b.actions);
  });

  it("splits today's events from the 7-day upcoming list", () => {
    const ex = {
      ...emptyExtraction("notes"),
      events: [
        { title: "Dentist", date: "2026-09-02", start_time: "14:00", end_time: null, location: null, people: [], confidence: 0.9 },
        { title: "Board", date: "2026-09-05", start_time: "09:00", end_time: null, location: null, people: [], confidence: 0.9 },
        { title: "Far", date: "2026-10-05", start_time: null, end_time: null, location: null, people: [], confidence: 0.9 },
      ],
    };
    const sheet = assembleDailySheet([{ notebook: "N", pageIndex: 0, extraction: ex }], opts);
    expect(sheet.events.map((e) => e.title)).toEqual(["Dentist"]);
    expect(sheet.upcoming.map((e) => e.title)).toEqual(["Board"]);
  });
});

describe("text", () => {
  it("normalizes and matches", () => {
    expect(normalizeText("Call the Dentist!")).toBe("call dentist");
    expect(similar("email Priya re: budget", "Email Priya about budget")).toBe(false);
    expect(similar("email Priya budget", "email Priya budget!")).toBe(true);
  });
});
