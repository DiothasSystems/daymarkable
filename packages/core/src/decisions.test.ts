import { describe, expect, it } from "vitest";
import { applyDecision } from "./decisions.js";
import { activeEvents, openActionList, pendingInbox } from "./merge.js";
import { emptyWorkingSet, type StoredInboxItem, type StoredTask, type WorkingSet } from "./state.js";

const TODAY = "2026-09-05";
const SOURCE = { notebook: "Work", pageIndex: 3 };

function withTask(): { state: WorkingSet; task: StoredTask } {
  const state = emptyWorkingSet();
  const task: StoredTask = {
    id: "t1", text: "Call the dentist", due: null, dueTime: null, priority: "normal", kind: "action",
    project: null, people: [], confidence: 0.9, source: SOURCE, carriedCount: 0, createdOn: "2026-09-01",
    status: "open", sourceConvention: "asterisk", lastAgedOn: "2026-09-01", completedOn: null,
  };
  state.tasks.push(task);
  return { state, task };
}

function inboxItem(kind: StoredInboxItem["kind"], payload: Record<string, unknown>, text: string): StoredInboxItem {
  return { id: "i1", kind, text, detail: null, confidence: 0.5, source: SOURCE, payload, status: "pending", createdOn: TODAY };
}

describe("applyDecision", () => {
  it("ticking a task closes it, the same as a tick on paper", () => {
    const { state } = withTask();
    const r = applyDecision(state, { itemType: "task", itemId: "t1", action: "complete" }, TODAY);
    expect(r.status).toBe("done");
    expect(state.tasks[0]!.completedOn).toBe(TODAY);
    expect(openActionList(state)).toHaveLength(0);
  });

  it("dropping a task removes it without marking it done", () => {
    const { state } = withTask();
    applyDecision(state, { itemType: "task", itemId: "t1", action: "drop" }, TODAY);
    expect(state.tasks[0]!.status).toBe("dropped");
    expect(state.tasks[0]!.completedOn).toBeNull();
    expect(openActionList(state)).toHaveLength(0);
  });

  it("refuses to close an item twice", () => {
    const { state } = withTask();
    applyDecision(state, { itemType: "task", itemId: "t1", action: "complete" }, TODAY);
    expect(() => applyDecision(state, { itemType: "task", itemId: "t1", action: "drop" }, TODAY)).toThrow(/already closed/);
  });

  it("rejects an unknown item", () => {
    expect(() => applyDecision(emptyWorkingSet(), { itemType: "task", itemId: "nope", action: "drop" }, TODAY)).toThrow(/not found/);
  });

  it("confirming an Inbox task promotes it at full confidence", () => {
    const state = emptyWorkingSet();
    state.inbox.push(inboxItem("task", { text: "Send the survey", due: "2026-09-09", priority: "high", kind: "action", people: ["Dana"] }, "Send the survey"));
    const r = applyDecision(state, { itemType: "inbox", itemId: "i1", action: "complete" }, TODAY);
    expect(r.created.tasks).toHaveLength(1);
    const [t] = openActionList(state);
    expect(t!.text).toBe("Send the survey");
    expect(t!.due).toBe("2026-09-09");
    expect(t!.priority).toBe("high");
    expect(t!.confidence).toBe(1);
    expect(pendingInbox(state)).toHaveLength(0);
  });

  it("confirming an undated Inbox event creates nothing — there is no date to schedule", () => {
    const state = emptyWorkingSet();
    state.inbox.push(inboxItem("event", { title: "Meetings in Sacramento", date: null }, "Meetings in Sacramento"));
    const r = applyDecision(state, { itemType: "inbox", itemId: "i1", action: "complete" }, TODAY);
    expect(r.created.events).toHaveLength(0);
    expect(activeEvents(state)).toHaveLength(0);
  });

  it("confirming a dated Inbox event puts it on the calendar", () => {
    const state = emptyWorkingSet();
    state.inbox.push(inboxItem("event", { title: "Site survey", date: "2026-09-11", start_time: "09:30", people: [] }, "Site survey"));
    applyDecision(state, { itemType: "inbox", itemId: "i1", action: "complete" }, TODAY);
    const [e] = activeEvents(state);
    expect(e!.title).toBe("Site survey");
    expect(e!.startTime).toBe("09:30");
  });

  it("dropping an Inbox item promotes nothing", () => {
    const state = emptyWorkingSet();
    state.inbox.push(inboxItem("task", { text: "Send the survey" }, "Send the survey"));
    const r = applyDecision(state, { itemType: "inbox", itemId: "i1", action: "drop" }, TODAY);
    expect(r.created.tasks).toHaveLength(0);
    expect(openActionList(state)).toHaveLength(0);
    expect(pendingInbox(state)).toHaveLength(0);
  });

  it("confirming a meeting request records the confirmation but does not send it (rule 7)", () => {
    const state = emptyWorkingSet();
    state.meetingRequests.push({ id: "m1", topic: "Quarter review", proposedDate: "2026-09-14", proposedTime: null, durationMinutes: 30, attendees: ["Dana"], confidence: 0.9, source: SOURCE, state: "drafted", confirmedOn: null });
    const r = applyDecision(state, { itemType: "meeting_request", itemId: "m1", action: "complete" }, TODAY);
    expect(r.status).toBe("confirmed");
    expect(state.meetingRequests[0]!.confirmedOn).toBe(TODAY);
    expect(state.meetingRequests[0]!.state).not.toBe("sent");
  });

  it("drops an event that was never a real commitment", () => {
    const state = emptyWorkingSet();
    state.events.push({ id: "e1", title: "Meetings in Sacramento", date: "2026-09-06", startTime: null, endTime: null, location: null, people: [], source: "ink", confidence: 0.9, status: "active" });
    applyDecision(state, { itemType: "event", itemId: "e1", action: "drop" }, TODAY);
    expect(activeEvents(state)).toHaveLength(0);
  });
});
