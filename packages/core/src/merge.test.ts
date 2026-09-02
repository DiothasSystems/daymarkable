import { emptyExtraction, type ExtractedTask, type PageExtraction } from "@daymarkable/decode";
import { describe, expect, it } from "vitest";
import { mergeRun, openActionList, pendingInbox } from "./merge.js";
import { emptyWorkingSet, type WorkingSet } from "./state.js";
import { buildActionList, buildMonth, buildOutputSet, buildWeek, startOfWeek } from "./views.js";

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

const notesPage = (ex: Partial<PageExtraction>, pageIndex = 0) => ({
  notebook: "Work",
  pageIndex,
  extraction: { ...emptyExtraction("notes"), ...ex },
});

const opts = { today: "2026-09-02", threshold: 0.7 };

describe("mergeRun", () => {
  it("dedupes within a run and across runs; append-only list never orphans", () => {
    const r1 = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Call dentist"), task("call the dentist")] })], opts);
    expect(openActionList(r1.state)).toHaveLength(1);
    expect(r1.changes.tasksCreated).toBe(1);
    expect(r1.changes.tasksMerged).toBe(1);
    const r2 = mergeRun(r1.state, [notesPage({ tasks: [task("Call dentist"), task("Renew passport")] })], { ...opts, today: "2026-09-03" });
    const open = openActionList(r2.state);
    expect(open.map((t) => t.text).sort()).toEqual(["Call dentist", "Renew passport"]);
    const dentist = open.find((t) => t.text === "Call dentist")!;
    expect(dentist.status).toBe("carried");
    expect(dentist.carriedCount).toBe(1);
  });

  it("ages carried items once per local date (idempotent re-run)", () => {
    const r1 = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Renew passport")] })], opts);
    const r2 = mergeRun(r1.state, [], { ...opts, today: "2026-09-03" });
    const r2again = mergeRun(r2.state, [], { ...opts, today: "2026-09-03" });
    expect(r2.state.tasks[0]!.carriedCount).toBe(1);
    expect(r2again.state.tasks[0]!.carriedCount).toBe(1);
    expect(r2again.changes.tasksCarried).toBe(0);
  });

  it("applies ticks and strikes from planner pages via printed item codes", () => {
    const r1 = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Buy milk"), task("Renew passport")] })], opts);
    const [a, b] = openActionList(r1.state);
    const state: WorkingSet = {
      ...r1.state,
      printed: [
        { pageCode: "dM/DAY/2026-09-02/1", itemCode: "A01", itemType: "task", itemId: a!.id },
        { pageCode: "dM/DAY/2026-09-02/1", itemCode: "A02", itemType: "task", itemId: b!.id },
      ],
    };
    const planner = {
      notebook: "Planner",
      pageIndex: 0,
      extraction: {
        ...emptyExtraction("planner"),
        planner_page_code: "dM/DAY/2026-09-02/1",
        checkbox_updates: [
          { item_code: "A01", label: "Buy milk", checked: true, struck: false, margin_note: null, confidence: 0.95 },
          { item_code: "A02", label: "Renew passport", checked: false, struck: true, margin_note: "ask Sam about visa", confidence: 0.9 },
          { item_code: "Z99", label: "ghost", checked: true, struck: false, margin_note: null, confidence: 0.9 },
        ],
      },
    };
    const r2 = mergeRun(state, [planner], { ...opts, today: "2026-09-03" });
    expect(r2.changes.checkboxApplied).toBe(2);
    expect(r2.changes.checkboxUnresolved).toBe(1);
    expect(r2.state.tasks.find((t) => t.id === a!.id)!.status).toBe("done");
    expect(r2.state.tasks.find((t) => t.id === b!.id)!.status).toBe("dropped");
    expect(openActionList(r2.state)).toHaveLength(0);
    expect(pendingInbox(r2.state).map((i) => i.kind)).toEqual(["margin_note"]);
  });

  it("routes low-confidence items to the Inbox and promotes them on tick", () => {
    const r1 = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Book flights", { confidence: 0.4, due: "2026-09-20" })] })], opts);
    expect(openActionList(r1.state)).toHaveLength(0);
    const inbox = pendingInbox(r1.state);
    expect(inbox).toHaveLength(1);
    const state: WorkingSet = { ...r1.state, printed: [{ pageCode: "dM/INBOX/2026-09-02/1", itemCode: "I01", itemType: "inbox", itemId: inbox[0]!.id }] };
    const planner = {
      notebook: "Planner",
      pageIndex: 5,
      extraction: {
        ...emptyExtraction("planner"),
        planner_page_code: "dM/INBOX/2026-09-02/1",
        checkbox_updates: [{ item_code: "I01", label: "Book flights", checked: true, struck: false, margin_note: null, confidence: 0.9 }],
      },
    };
    const r2 = mergeRun(state, [planner], { ...opts, today: "2026-09-03" });
    expect(r2.changes.inboxAccepted).toBe(1);
    const open = openActionList(r2.state);
    expect(open).toHaveLength(1);
    expect(open[0]!.due).toBe("2026-09-20");
    expect(open[0]!.confidence).toBe(1);
  });

  it("creates meetings from topic-grouped notes and only reports them once", () => {
    const page = notesPage({
      tasks: [task("Send Priya the deck")],
      notes: [
        { meeting_topic: "Roadmap sync", meeting_date: "2026-09-02", meeting_time: "10:00", attendees: ["Priya"], text: "Discussed Q4.", decisions: ["Ship in Oct"], confidence: 0.8 },
        { meeting_topic: "Roadmap sync", meeting_date: "2026-09-02", meeting_time: null, attendees: ["Sam"], text: "Budget ok.", decisions: [], confidence: 0.75 },
        { meeting_topic: null, meeting_date: null, meeting_time: null, attendees: [], text: "random thought", decisions: [], confidence: 0.9 },
      ],
    });
    const r1 = mergeRun(emptyWorkingSet(), [page], opts);
    expect(r1.newMeetings).toHaveLength(1);
    expect(r1.newMeetings[0]!.attendees.sort()).toEqual(["Priya", "Sam"]);
    expect(r1.newMeetings[0]!.actions).toEqual(["Send Priya the deck"]);
    const r2 = mergeRun(r1.state, [page], opts);
    expect(r2.newMeetings).toHaveLength(0);
  });

  it("folds several topics on one page into one meeting (section headings stay in the text)", () => {
    const page = notesPage({
      notes: [
        { meeting_topic: "Dave from Plume", meeting_date: "2026-09-01", meeting_time: null, attendees: ["Dave"], text: "Wi-Fi 8, cellular failover", decisions: [], confidence: 0.8 },
        { meeting_topic: "Roadmap", meeting_date: "2026-09-01", meeting_time: null, attendees: [], text: "No answers yet", decisions: ["Target by EOY"], confidence: 0.75 },
      ],
    });
    const r = mergeRun(emptyWorkingSet(), [page], opts);
    expect(r.newMeetings).toHaveLength(1);
    expect(r.newMeetings[0]!.topic).toBe("Dave from Plume");
    expect(r.newMeetings[0]!.text).toContain("Roadmap\nNo answers yet");
    expect(r.newMeetings[0]!.decisions).toEqual(["Target by EOY"]);
  });

  it("drops stale past events and dedupes same-day titles", () => {
    const page = notesPage({
      events: [
        { title: "Dentist", date: "2026-08-20", start_time: "14:00", end_time: null, location: null, people: [], confidence: 0.9 },
        { title: "Board meeting", date: "2026-09-05", start_time: "09:00", end_time: null, location: null, people: [], confidence: 0.9 },
        { title: "Board Meeting!", date: "2026-09-05", start_time: null, end_time: null, location: null, people: [], confidence: 0.9 },
      ],
    });
    const r = mergeRun(emptyWorkingSet(), [page], opts);
    expect(r.state.events.map((e) => e.title)).toEqual(["Board meeting"]);
  });
});

describe("views", () => {
  it("computes Monday-start weeks and month grids", () => {
    expect(startOfWeek("2026-09-02")).toBe("2026-08-31");
    expect(startOfWeek("2026-09-06", 0)).toBe("2026-09-06");
    const r = mergeRun(
      emptyWorkingSet(),
      [notesPage({ tasks: [task("Buy milk", { due: "2026-09-04" })], events: [{ title: "Dentist", date: "2026-09-02", start_time: "14:00", end_time: null, location: null, people: [], confidence: 0.9 }] })],
      opts,
    );
    const vo = { today: "2026-09-02", timezone: "UTC", generatedAt: "2026-09-02T03:00:00Z", runLabel: "nightly" };
    const week = buildWeek(r.state, vo);
    expect(week.days.map((d) => d.date)).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(week.days[2]!.events).toHaveLength(1);
    expect(week.days[4]!.tasksDue).toHaveLength(1);
    const month = buildMonth(r.state, 2026, 9, vo);
    expect(month.weeks[0]![0]!.date).toBe("2026-08-31");
    expect(month.weeks.at(-1)!.at(-1)!.date >= "2026-09-30").toBe(true);
    expect(month.eventCount).toBe(1);
    const out = buildOutputSet(r.state, vo);
    expect(out.planner.year.months).toHaveLength(12);
    expect(out.planner.quarter.quarter).toBe(3);
    expect(buildActionList(r.state, vo).groups.map((g) => g.label)).toEqual(["2026-09-04"]);
  });
});
