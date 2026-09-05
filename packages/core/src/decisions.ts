/**
 * Decisions made in the web/mobile UI — tick an action off, or drop one that is not relevant.
 *
 * These are exactly the transitions a pen produces on a printed planner page (rule 8: items leave
 * the Action List only by tick or explicit drop), so they live here in core beside the merge that
 * applies the paper ones, not in the web layer. The caller persists whatever `touched` reports.
 */
import type { StoredEvent, StoredInboxItem, StoredMeetingRequest, StoredTask, WorkingSet } from "./state.js";
import { stableId } from "./text.js";

export type DecisionItemType = "task" | "event" | "inbox" | "meeting_request";
/** `complete` = ticked the box; `drop` = crossed it out as not relevant. */
export type DecisionAction = "complete" | "drop";

export interface Decision {
  itemType: DecisionItemType;
  itemId: string;
  action: DecisionAction;
}

export interface DecisionResult {
  /** What the row now reads as, for the confirmation message. */
  label: string;
  status: string;
  /** Rows the decision created (accepting an Inbox item promotes it). */
  created: {
    tasks: StoredTask[];
    events: StoredEvent[];
    meetingRequests: StoredMeetingRequest[];
  };
}

const NUM = (v: unknown): number | null => (typeof v === "number" ? v : null);
const STR = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const LIST = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Apply one decision to the working set, mutating it in place.
 * Throws if the item is unknown or the action does not apply to it.
 */
export function applyDecision(state: WorkingSet, d: Decision, today: string): DecisionResult {
  const empty = { tasks: [], events: [], meetingRequests: [] };

  if (d.itemType === "task") {
    const t = state.tasks.find((x) => x.id === d.itemId);
    if (!t) throw new Error("action not found");
    if (t.status === "done" || t.status === "dropped") throw new Error("that action is already closed");
    t.status = d.action === "complete" ? "done" : "dropped";
    t.completedOn = d.action === "complete" ? today : null;
    return { label: t.text, status: t.status, created: empty };
  }

  if (d.itemType === "event") {
    const e = state.events.find((x) => x.id === d.itemId);
    if (!e) throw new Error("event not found");
    if (e.status === "dropped") throw new Error("that event is already dropped");
    // A calendar entry is not something you finish, so both gestures remove it from the planner.
    e.status = "dropped";
    return { label: e.title, status: "dropped", created: empty };
  }

  if (d.itemType === "meeting_request") {
    const m = state.meetingRequests.find((x) => x.id === d.itemId);
    if (!m) throw new Error("meeting request not found");
    if (m.state !== "drafted") throw new Error(`that request is already ${m.state}`);
    // Confirming here is the explicit user confirmation rule 7 requires before an invite is sent.
    m.state = d.action === "complete" ? "confirmed" : "dropped";
    m.confirmedOn = d.action === "complete" ? today : null;
    return { label: m.topic, status: m.state, created: empty };
  }

  const it = state.inbox.find((x) => x.id === d.itemId);
  if (!it) throw new Error("inbox item not found");
  if (it.status !== "pending") throw new Error(`that item is already ${it.status}`);
  if (d.action === "drop") {
    it.status = "dropped";
    return { label: it.text, status: "dropped", created: empty };
  }
  it.status = "accepted";
  return { label: it.text, status: "accepted", created: promote(state, it, today) };
}

/**
 * Confirming an Inbox item turns it into the real thing at full confidence — the user has just
 * read it, so it is no longer a guess. Mirrors the planner-tick path in mergeRun.
 */
function promote(state: WorkingSet, it: StoredInboxItem, today: string): DecisionResult["created"] {
  const p = it.payload;
  const created: DecisionResult["created"] = { tasks: [], events: [], meetingRequests: [] };

  if (it.kind === "task" || it.kind === "margin_note") {
    const text = STR(p.text) ?? it.text;
    const id = stableId("task", text);
    if (state.tasks.some((x) => x.id === id)) return created;
    const task: StoredTask = {
      id,
      text,
      due: STR(p.due),
      dueTime: STR(p.due_time),
      priority: (STR(p.priority) as StoredTask["priority"]) ?? "normal",
      kind: (STR(p.kind) as StoredTask["kind"]) ?? "task",
      project: STR(p.project),
      people: LIST(p.people),
      confidence: 1,
      source: it.source,
      carriedCount: 0,
      createdOn: today,
      status: "open",
      sourceConvention: STR(p.source_convention),
      lastAgedOn: today,
      completedOn: null,
    };
    state.tasks.push(task);
    created.tasks.push(task);
    return created;
  }

  if (it.kind === "event") {
    const title = STR(p.title) ?? it.text;
    const date = STR(p.date);
    // Same rule as the merge: without a date there is nothing to put on a calendar.
    if (!date) return created;
    const id = stableId("event", `${title} ${date} ${STR(p.start_time) ?? ""}`);
    if (state.events.some((x) => x.id === id)) return created;
    const event: StoredEvent = {
      id,
      title,
      date,
      startTime: STR(p.start_time),
      endTime: STR(p.end_time),
      location: STR(p.location),
      people: LIST(p.people),
      source: "ink",
      confidence: 1,
      status: "active",
    };
    state.events.push(event);
    created.events.push(event);
    return created;
  }

  const topic = STR(p.topic) ?? it.text.replace(/^Set up:\s*/i, "");
  const id = stableId("meeting_request", `${topic} ${STR(p.proposed_date) ?? ""} ${LIST(p.attendees).join(",")}`);
  if (state.meetingRequests.some((x) => x.id === id)) return created;
  const mr: StoredMeetingRequest = {
    id,
    topic,
    proposedDate: STR(p.proposed_date),
    proposedTime: STR(p.proposed_time),
    durationMinutes: NUM(p.duration_minutes),
    attendees: LIST(p.attendees),
    confidence: 1,
    source: it.source,
    state: "drafted",
    confirmedOn: null,
  };
  state.meetingRequests.push(mr);
  created.meetingRequests.push(mr);
  return created;
}
