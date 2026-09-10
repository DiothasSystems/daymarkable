import { emptyExtraction, type ExtractedTask, type PageExtraction } from "@daymarkable/decode";
import { describe, expect, it } from "vitest";
import { applyDecision } from "./decisions.js";
import { activeEvents, mergeRun, openActionList, pendingInbox } from "./merge.js";
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
          { item_code: "A01", label: "Buy milk", checked: true, struck: false, margin_note: null, written_due: null, written_priority: null, confidence: 0.95 },
          { item_code: "A02", label: "Renew passport", checked: false, struck: true, margin_note: "ask Sam about visa", written_due: null, written_priority: null, confidence: 0.9 },
          { item_code: "Z99", label: "ghost", checked: true, struck: false, margin_note: null, written_due: null, written_priority: null, confidence: 0.9 },
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
        checkbox_updates: [{ item_code: "I01", label: "Book flights", checked: true, struck: false, margin_note: null, written_due: null, written_priority: null, confidence: 0.9 }],
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
    expect(buildActionList(r.state, vo).groups.map((g) => g.label)).toEqual(["Work"]);
  });
});

describe("undated events", () => {
  const heading = { title: "Meetings in Sacramento", date: null, start_time: null, end_time: null, location: null, people: [], confidence: 0.95 };

  it("routes an event with no date to the Inbox instead of the calendar", () => {
    // A heading line reads like an event but has no date. Left as one it would show on the day
    // page every day forever, since nothing ages out an undated item.
    const r = mergeRun(emptyWorkingSet(), [notesPage({ events: [heading] })], opts);
    expect(activeEvents(r.state)).toHaveLength(0);
    const inbox = pendingInbox(r.state);
    expect(inbox.map((i) => i.text)).toEqual(["Meetings in Sacramento"]);
    expect(inbox[0]!.kind).toBe("event");
  });

  it("retires undated events stored before that rule existed", () => {
    const state = emptyWorkingSet();
    state.events.push({ id: "old", title: "Meetings in Sacramento", date: null, startTime: null, endTime: null, location: null, people: [], source: "ink", confidence: 0.95, status: "active" });
    const r = mergeRun(state, [], opts);
    expect(activeEvents(r.state)).toHaveLength(0);
  });

  it("keeps dated events on the calendar", () => {
    const r = mergeRun(emptyWorkingSet(), [notesPage({ events: [{ ...heading, date: "2026-09-04" }] })], opts);
    expect(activeEvents(r.state).map((e) => e.title)).toEqual(["Meetings in Sacramento"]);
  });
});

describe("hand-assigned dates and priorities", () => {
  const update = (over: Record<string, unknown>) => ({
    item_code: "A01", label: "Renew passport", checked: false, struck: false,
    margin_note: null, written_due: null, written_priority: null, confidence: 0.95, ...over,
  });

  /** One open task, already printed on an Action List page as A01. */
  const printed = () => {
    const r = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Renew passport")] })], opts);
    const t = openActionList(r.state)[0]!;
    return {
      state: { ...r.state, printed: [{ pageCode: "dM/ACTIONS/2026-09-02/1", itemCode: "A01", itemType: "task" as const, itemId: t.id }] },
      id: t.id,
    };
  };

  const plannerPage = (updates: ReturnType<typeof update>[]) => ({
    notebook: "Action List",
    pageIndex: 0,
    extraction: { ...emptyExtraction("planner"), planner_page_code: "dM/ACTIONS/2026-09-02/1", checkbox_updates: updates },
  });

  it("takes no due date from an entry that did not state one", () => {
    const r = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Renew passport")] })], opts);
    expect(openActionList(r.state)[0]!.due).toBeNull();
  });

  it("applies a date written in the WHEN / PRI field without closing the item", () => {
    const { state, id } = printed();
    const r = mergeRun(state, [plannerPage([update({ written_due: "2026-09-14" })])], { ...opts, today: "2026-09-03" });
    const t = r.state.tasks.find((x) => x.id === id)!;
    expect(t.due).toBe("2026-09-14");
    expect(t.status).not.toBe("done");
    expect(r.changes.datesAssigned).toBe(1);
    expect(openActionList(r.state)).toHaveLength(1);
  });

  it("applies a written priority, and both together", () => {
    const { state, id } = printed();
    const r = mergeRun(state, [plannerPage([update({ written_due: "2026-09-14", written_priority: "high" })])], { ...opts, today: "2026-09-03" });
    const t = r.state.tasks.find((x) => x.id === id)!;
    expect(t.priority).toBe("high");
    expect(t.due).toBe("2026-09-14");
    expect(r.changes.prioritiesAssigned).toBe(1);
  });

  it("still closes the item when the row is both dated and ticked", () => {
    const { state, id } = printed();
    const r = mergeRun(state, [plannerPage([update({ written_due: "2026-09-14", checked: true })])], { ...opts, today: "2026-09-03" });
    const t = r.state.tasks.find((x) => x.id === id)!;
    expect(t.due).toBe("2026-09-14");
    expect(t.status).toBe("done");
  });

  it("ignores an annotation it could not read confidently", () => {
    const { state, id } = printed();
    const r = mergeRun(state, [plannerPage([update({ written_due: "2026-09-14", confidence: 0.4 })])], { ...opts, today: "2026-09-03" });
    expect(r.state.tasks.find((x) => x.id === id)!.due).toBeNull();
    expect(r.changes.checkboxUnresolved).toBe(1);
  });

  it("re-reading the same page twice assigns the date once", () => {
    const { state, id } = printed();
    const page = plannerPage([update({ written_due: "2026-09-14" })]);
    const r1 = mergeRun(state, [page], { ...opts, today: "2026-09-03" });
    const r2 = mergeRun(r1.state, [page], { ...opts, today: "2026-09-03" });
    expect(r2.state.tasks.find((x) => x.id === id)!.due).toBe("2026-09-14");
    expect(r2.changes.datesAssigned).toBe(0);
  });
});

describe("buildActionList grouping", () => {
  type Spec = { text: string; due?: string | null; priority?: "high" | "normal" | "low"; notebook?: string; page?: number; pageDate?: string | null };
  const withTasks = (specs: Spec[]) => {
    const state = emptyWorkingSet();
    specs.forEach((sp, i) => state.tasks.push({
      id: `t${i}`, text: sp.text, due: sp.due ?? null, dueTime: null, priority: sp.priority ?? "normal",
      kind: "action", project: null, people: [], confidence: 0.9,
      source: { notebook: sp.notebook ?? "Work", pageIndex: sp.page ?? 0, pageDate: sp.pageDate ?? null },
      carriedCount: 0, createdOn: "2026-09-01", status: "open", sourceConvention: null, lastAgedOn: "2026-09-01", completedOn: null,
    }));
    return state;
  };
  const view = { today: "2026-09-05", timezone: "UTC", generatedAt: "2026-09-05T03:00:00Z", runLabel: "test" };

  it("groups by the page the items were written on, named after the notebook", () => {
    const m = buildActionList(withTasks([
      { text: "One", notebook: "Plume MDU", page: 3 },
      { text: "Two", notebook: "Plume MDU", page: 3 },
      { text: "Elsewhere", notebook: "Synamedia", page: 0 },
    ]), view);
    expect(m.groups.map((g) => g.label)).toEqual(["Plume MDU", "Synamedia"]);
    expect(m.groups[0]!.tasks.map((t) => t.text)).toEqual(["One", "Two"]);
  });

  it("keeps two pages of the same notebook apart", () => {
    const m = buildActionList(withTasks([
      { text: "On page 4", notebook: "Plume MDU", page: 3 },
      { text: "On page 1", notebook: "Plume MDU", page: 0 },
    ]), view);
    expect(m.groups).toHaveLength(2);
    expect(m.groups.map((g) => g.subtitle)).toEqual(["p.1", "p.4"]);
  });

  it("puts the page date in the subheading when the writer dated the page", () => {
    const m = buildActionList(withTasks([{ text: "One", notebook: "Plume MDU", page: 3, pageDate: "2026-09-03" }]), view);
    expect(m.groups[0]!.subtitle).toBe("p.4 · Thu 3 Sep");
  });

  it("omits the date when the page carries none", () => {
    const m = buildActionList(withTasks([{ text: "One", page: 1 }]), view);
    expect(m.groups[0]!.subtitle).toBe("p.2");
  });

  it("orders pages by their earliest due date, before any undated page", () => {
    const m = buildActionList(withTasks([
      { text: "No date here", notebook: "Aardvark" },
      { text: "Due later", notebook: "Zebra", page: 1, due: "2026-09-20" },
      { text: "Due sooner", notebook: "Mango", page: 2, due: "2026-09-08" },
    ]), view);
    expect(m.groups.map((g) => g.label)).toEqual(["Mango", "Zebra", "Aardvark"]);
  });

  it("orders undated pages by priority, then by notebook name", () => {
    const m = buildActionList(withTasks([
      { text: "Normal", notebook: "Alpha" },
      { text: "Urgent", notebook: "Zulu", page: 1, priority: "high" },
      { text: "Also normal", notebook: "Bravo", page: 2 },
    ]), view);
    expect(m.groups.map((g) => g.label)).toEqual(["Zulu", "Alpha", "Bravo"]);
  });

  it("names a page with no notebook rather than showing an empty heading", () => {
    const m = buildActionList(withTasks([{ text: "One", notebook: "  " }]), view);
    expect(m.groups[0]!.label).toBe("Unfiled");
  });

  it("sorts within a page by due date then priority", () => {
    const m = buildActionList(withTasks([
      { text: "Undated normal" },
      { text: "Undated urgent", priority: "high" },
      { text: "Dated", due: "2026-09-09" },
    ]), view);
    expect(m.groups[0]!.tasks.map((t) => t.text)).toEqual(["Dated", "Undated urgent", "Undated normal"]);
    expect(m.openCount).toBe(3);
  });
});

describe("repeating events", () => {
  const weekly = (over: Record<string, unknown> = {}) => ({
    title: "Team meeting", date: "2026-09-07", start_time: "09:00", end_time: "10:00",
    location: null, people: [], recurrence: "weekly" as const, confidence: 0.9, ...over,
  });

  it("stores the series once and shows it on every occurrence", () => {
    const r = mergeRun(emptyWorkingSet(), [notesPage({ events: [weekly()] })], { ...opts, today: "2026-09-07" });
    expect(activeEvents(r.state)).toHaveLength(1);
    expect(activeEvents(r.state)[0]!.recurrence).toBe("weekly");
    const view = { today: "2026-09-14", timezone: "UTC", generatedAt: "2026-09-14T03:00:00Z", runLabel: "test" };
    const daily = buildOutputSet(r.state, view).planner.daily;
    expect(daily.events.map((e) => e.title)).toEqual(["Team meeting"]);
    expect(daily.events[0]!.date).toBe("2026-09-14");
  });

  it("does not start a second series when the same meeting is written again later", () => {
    const r1 = mergeRun(emptyWorkingSet(), [notesPage({ events: [weekly()] })], { ...opts, today: "2026-09-07" });
    const r2 = mergeRun(r1.state, [notesPage({ events: [weekly({ date: "2026-09-14" })] }, 1)], { ...opts, today: "2026-09-14" });
    expect(activeEvents(r2.state)).toHaveLength(1);
    expect(r2.changes.eventsCreated).toBe(0);
  });

  it("a repeating entry on an old page is kept, where a one-off would be dropped as stale", () => {
    const old = { ...weekly(), date: "2026-08-03" };
    const r = mergeRun(emptyWorkingSet(), [notesPage({ events: [old] })], { ...opts, today: "2026-09-07" });
    expect(activeEvents(r.state)).toHaveLength(1);
    const oneOff = mergeRun(emptyWorkingSet(), [notesPage({ events: [{ ...old, recurrence: null }] })], { ...opts, today: "2026-09-07" });
    expect(activeEvents(oneOff.state)).toHaveLength(0);
  });

  it("writing 'weekly' beside a meeting already known turns it into a series", () => {
    const once = { ...weekly(), recurrence: null };
    const r1 = mergeRun(emptyWorkingSet(), [notesPage({ events: [once] })], { ...opts, today: "2026-09-07" });
    expect(activeEvents(r1.state)[0]!.recurrence).toBeNull();
    const r2 = mergeRun(r1.state, [notesPage({ events: [weekly()] }, 1)], { ...opts, today: "2026-09-07" });
    expect(activeEvents(r2.state)).toHaveLength(1);
    expect(activeEvents(r2.state)[0]!.recurrence).toBe("weekly");
  });

  it("dropping the series stops every future occurrence", () => {
    const r = mergeRun(emptyWorkingSet(), [notesPage({ events: [weekly()] })], { ...opts, today: "2026-09-07" });
    r.state.events[0]!.status = "dropped";
    const view = { today: "2026-09-14", timezone: "UTC", generatedAt: "2026-09-14T03:00:00Z", runLabel: "test" };
    expect(buildOutputSet(r.state, view).planner.daily.events).toHaveLength(0);
  });
});

describe("a closed action is not resurrected by re-reading its page", () => {
  const page = (tasks: ExtractedTask[], pageIndex = 0) => notesPage({ tasks }, pageIndex);

  it("keeps a ticked-off item closed when its page is decoded again", () => {
    // The reported defect: an action was completed and crossed off, then the notebook was
    // edited elsewhere, the whole page was re-decoded, and the item came back open.
    const r1 = mergeRun(emptyWorkingSet(), [page([task("dayMarkable email server")])], opts);
    const created = openActionList(r1.state)[0]!;
    created.status = "done";
    created.completedOn = opts.today;

    const r2 = mergeRun(r1.state, [page([task("dayMarkable email server")])], { ...opts, today: "2026-09-03" });
    expect(openActionList(r2.state)).toHaveLength(0);
    expect(r2.changes.tasksCreated).toBe(0);
    expect(r2.state.tasks).toHaveLength(1);
    expect(r2.state.tasks[0]!.status).toBe("done");
  });

  it("keeps a dropped item dropped", () => {
    const r1 = mergeRun(emptyWorkingSet(), [page([task("Not relevant")])], opts);
    r1.state.tasks[0]!.status = "dropped";
    const r2 = mergeRun(r1.state, [page([task("Not relevant")])], { ...opts, today: "2026-09-03" });
    expect(r2.state.tasks).toHaveLength(1);
    expect(openActionList(r2.state)).toHaveLength(0);
  });

  it("still enriches an OPEN item re-read from its own page", () => {
    const r1 = mergeRun(emptyWorkingSet(), [page([task("Call Dana")])], opts);
    const r2 = mergeRun(r1.state, [page([task("Call Dana", { due: "2026-09-20", priority: "high" })])], opts);
    const [t] = openActionList(r2.state);
    expect(t!.due).toBe("2026-09-20");
    expect(t!.priority).toBe("high");
    expect(r2.state.tasks).toHaveLength(1);
  });

  it("treats the same words on a DIFFERENT page as a new intent", () => {
    // Writing it down again on a fresh page means the user wants it again.
    const r1 = mergeRun(emptyWorkingSet(), [page([task("Book travel")], 0)], opts);
    r1.state.tasks[0]!.status = "done";
    const r2 = mergeRun(r1.state, [page([task("Book travel")], 4)], { ...opts, today: "2026-09-03" });
    expect(openActionList(r2.state).map((t) => t.text)).toEqual(["Book travel"]);
    expect(r2.changes.tasksCreated).toBe(1);
  });

  it("does not resurrect across a re-read of a page in a different notebook", () => {
    const r1 = mergeRun(emptyWorkingSet(), [page([task("Shared wording")])], opts);
    r1.state.tasks[0]!.status = "done";
    const other = { notebook: "Other", pageIndex: 0, extraction: { ...emptyExtraction("notes"), tasks: [task("Shared wording")] } };
    const r2 = mergeRun(r1.state, [other], { ...opts, today: "2026-09-03" });
    // A different notebook is a different page: this one IS a new intent.
    expect(openActionList(r2.state)).toHaveLength(1);
  });
});

describe("marks decide, on pages that use them", () => {
  const unmarked = (text: string, over: Partial<ExtractedTask> = {}) => task(text, { source_convention: null, ...over });

  it("holds an unmarked line beside a marked one, instead of making it an action", () => {
    // The reported defect: a plain note on a page of asterisked actions became an action item.
    const r = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Call Dana"), unmarked("Travel to Nokia Supplier Day")] })], opts);
    expect(openActionList(r.state).map((t) => t.text)).toEqual(["Call Dana"]);
    const [item] = pendingInbox(r.state);
    expect(item!.text).toBe("Travel to Nokia Supplier Day");
    expect(item!.kind).toBe("task");
    expect(item!.detail).toContain("no action mark");
  });

  it("trusts the reading on a page where nothing is marked", () => {
    // Marks say nothing about intent here, so a page of plain notes still yields its actions.
    const r = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [unmarked("Call w/Sean on Wi-Fi 8"), unmarked("PFA Beta w/Test")] })], opts);
    expect(openActionList(r.state).map((t) => t.text)).toEqual(["Call w/Sean on Wi-Fi 8", "PFA Beta w/Test"]);
    expect(pendingInbox(r.state)).toHaveLength(0);
  });

  it("judges each page on its own marks", () => {
    const marked = notesPage({ tasks: [task("Send the survey"), unmarked("Budget review")] }, 0);
    const plain = { notebook: "Work", pageIndex: 1, extraction: { ...emptyExtraction("notes"), tasks: [unmarked("Book the room")] } };
    const r = mergeRun(emptyWorkingSet(), [marked, plain], opts);
    expect(openActionList(r.state).map((t) => t.text).sort()).toEqual(["Book the room", "Send the survey"]);
    expect(pendingInbox(r.state).map((i) => i.text)).toEqual(["Budget review"]);
  });

  it("says both reasons when a held line is also unreadable", () => {
    const r = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Call Dana"), unmarked("Something faint", { confidence: 0.2, due: "2026-09-20" })] })], opts);
    const [item] = pendingInbox(r.state);
    expect(item!.detail).toContain("due 2026-09-20");
    expect(item!.detail).toContain("no action mark");
  });

  it("confirming a held item promotes it to a real action", () => {
    // The Inbox is a holding pen, not a bin: the user's tick is the mark.
    const r = mergeRun(emptyWorkingSet(), [notesPage({ tasks: [task("Call Dana"), unmarked("Travel to Nokia Supplier Day")] })], opts);
    const item = pendingInbox(r.state)[0]!;
    applyDecision(r.state, { itemType: "inbox", itemId: item.id, action: "complete" }, opts.today);
    expect(openActionList(r.state).map((t) => t.text).sort()).toEqual(["Call Dana", "Travel to Nokia Supplier Day"]);
  });
});
