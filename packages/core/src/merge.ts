/**
 * The nightly merge (docs/ARCHITECTURE.md §5). Deterministic, pure, no I/O:
 *   1. apply checkbox_updates from dayMarkable's own planner pages (ticks → done, strikes → drop,
 *      Inbox ticks → promote, margin notes → new items)
 *   2. ingest new tasks / events / meeting requests / meetings, deduping by fuzzy text
 *      ("call dentist" twice = one task); below-threshold items go to the Inbox (rule 3)
 *   3. age carried items once per local date (idempotent re-runs, rule 4)
 * The Action List is append-only and canonical: items leave only by tick or explicit drop (rule 8).
 */
import type { ExtractedEvent, ExtractedMeetingRequest, ExtractedTask, PageExtraction } from "@daymarkable/decode";
import { compareActions } from "./daily.js";
import type {
  Meeting,
  PrintedItem,
  StoredEvent,
  StoredInboxItem,
  StoredMeetingRequest,
  StoredTask,
  WorkingSet,
} from "./state.js";
import { similar, stableId } from "./text.js";
import type { ItemSource, Priority } from "./types.js";

export interface MergePage {
  notebook: string;
  pageIndex: number;
  extraction: PageExtraction;
}

export interface MergeOptions {
  today: string;
  threshold: number;
  /** Pending Inbox items older than this expire (default 7 days). */
  inboxExpiryDays?: number;
  /** Ignore an event whose date is more than this many days in the past (default 1). */
  pastEventGraceDays?: number;
}

export interface MergeChanges {
  checkboxApplied: number;
  checkboxUnresolved: number;
  tasksCreated: number;
  tasksCompleted: number;
  tasksDropped: number;
  tasksCarried: number;
  tasksMerged: number;
  eventsCreated: number;
  meetingRequestsCreated: number;
  meetingRequestsConfirmed: number;
  meetingRequestsDropped: number;
  inboxCreated: number;
  inboxAccepted: number;
  inboxDropped: number;
  inboxExpired: number;
  meetingsCreated: number;
}

export interface MergeResult {
  state: WorkingSet;
  changes: MergeChanges;
  newMeetings: Meeting[];
  /** Counts/ids only, never content. */
  log: string[];
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

function clone<T>(v: T): T {
  return structuredClone(v);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mergeRun(previous: WorkingSet, pages: readonly MergePage[], opts: MergeOptions): MergeResult {
  const state = clone(previous);
  const changes: MergeChanges = {
    checkboxApplied: 0,
    checkboxUnresolved: 0,
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksDropped: 0,
    tasksCarried: 0,
    tasksMerged: 0,
    eventsCreated: 0,
    meetingRequestsCreated: 0,
    meetingRequestsConfirmed: 0,
    meetingRequestsDropped: 0,
    inboxCreated: 0,
    inboxAccepted: 0,
    inboxDropped: 0,
    inboxExpired: 0,
    meetingsCreated: 0,
  };
  const log: string[] = [];
  const newMeetings: Meeting[] = [];
  const today = opts.today;

  const openTasks = () => state.tasks.filter((t) => t.status === "open" || t.status === "carried");

  const addTask = (t: ExtractedTask, source: ItemSource): "created" | "merged" => {
    const dup = openTasks().find((x) => similar(x.text, t.text));
    if (dup) {
      if (PRIORITY_RANK[t.priority] < PRIORITY_RANK[dup.priority]) dup.priority = t.priority;
      if (!dup.due && t.due) {
        dup.due = t.due;
        dup.dueTime = t.due_time;
      }
      if (t.people.length) dup.people = [...new Set([...dup.people, ...t.people])];
      changes.tasksMerged++;
      return "merged";
    }
    // Reopen a done/dropped task written again? No: a re-written task is a new intent.
    const id = stableId(`task:${today}`, t.text);
    if (state.tasks.some((x) => x.id === id)) return "merged";
    state.tasks.push({
      id,
      text: t.text,
      due: t.due,
      dueTime: t.due_time,
      priority: t.priority,
      kind: t.kind,
      project: t.project,
      people: t.people,
      confidence: t.confidence,
      source,
      carriedCount: 0,
      createdOn: today,
      status: "open",
      sourceConvention: t.source_convention,
      lastAgedOn: today,
      completedOn: null,
    });
    changes.tasksCreated++;
    return "created";
  };

  const addEvent = (e: ExtractedEvent, _source: ItemSource): boolean => {
    const grace = opts.pastEventGraceDays ?? 1;
    if (e.date && e.date < addDays(today, -grace)) return false; // stale: already happened
    const id = stableId("event", `${e.title} ${e.date ?? ""} ${e.start_time ?? ""}`);
    if (state.events.some((x) => x.id === id)) return false;
    const dup = state.events.find((x) => x.status === "active" && x.date === e.date && similar(x.title, e.title));
    if (dup) {
      if (!dup.startTime && e.start_time) dup.startTime = e.start_time;
      if (!dup.endTime && e.end_time) dup.endTime = e.end_time;
      return false;
    }
    state.events.push({
      id,
      title: e.title,
      date: e.date,
      startTime: e.start_time,
      endTime: e.end_time,
      location: e.location,
      people: e.people,
      source: "ink",
      confidence: e.confidence,
      status: "active",
    });
    changes.eventsCreated++;
    return true;
  };

  const addMeetingRequest = (m: ExtractedMeetingRequest, source: ItemSource): boolean => {
    const id = stableId("meeting_request", `${m.topic} ${m.proposed_date ?? ""} ${m.attendees.join(",")}`);
    if (state.meetingRequests.some((x) => x.id === id)) return false;
    const dup = state.meetingRequests.find((x) => x.state !== "dropped" && similar(x.topic, m.topic) && x.proposedDate === m.proposed_date);
    if (dup) return false;
    state.meetingRequests.push({
      id,
      topic: m.topic,
      proposedDate: m.proposed_date,
      proposedTime: m.proposed_time,
      durationMinutes: m.duration_minutes,
      attendees: m.attendees,
      confidence: m.confidence,
      source,
      state: "drafted",
      confirmedOn: null,
    });
    changes.meetingRequestsCreated++;
    return true;
  };

  const addInbox = (item: Omit<StoredInboxItem, "status" | "createdOn">): void => {
    if (state.inbox.some((x) => x.id === item.id)) return;
    if (state.inbox.some((x) => x.status === "pending" && similar(x.text, item.text))) return;
    state.inbox.push({ ...item, status: "pending", createdOn: today });
    changes.inboxCreated++;
  };

  const promote = (item: StoredInboxItem, source: ItemSource): void => {
    const p = item.payload;
    const boosted = { ...p, confidence: 1 } as Record<string, unknown>;
    if (item.kind === "task" || item.kind === "margin_note") {
      addTask(boosted as unknown as ExtractedTask, source);
    } else if (item.kind === "event") {
      addEvent(boosted as unknown as ExtractedEvent, source);
    } else if (item.kind === "meeting_request") {
      addMeetingRequest(boosted as unknown as ExtractedMeetingRequest, source);
    }
  };

  // ---- 1. checkbox updates from planner pages -------------------------------------------
  const printedIndex = new Map<string, PrintedItem>();
  for (const p of state.printed) printedIndex.set(`${p.pageCode}|${p.itemCode}`, p);

  const plannerPages = pages.filter((p) => p.extraction.page_kind === "planner");
  for (const page of plannerPages) {
    const source: ItemSource = { notebook: page.notebook, pageIndex: page.pageIndex };
    const pageCode = page.extraction.planner_page_code;
    for (const u of page.extraction.checkbox_updates) {
      const key = pageCode && u.item_code ? `${pageCode}|${u.item_code.toUpperCase()}` : null;
      const printed = key ? printedIndex.get(key) : undefined;
      let resolved: PrintedItem | undefined = printed;
      if (!resolved && u.label) {
        // Fallback: match by label against items printed on that page.
        resolved = state.printed.find((p) => p.pageCode === pageCode && labelMatches(state, p, u.label));
      }
      if (u.margin_note && u.margin_note.trim()) {
        addInbox({
          id: stableId(`inbox:margin:${today}`, u.margin_note),
          kind: "margin_note",
          text: u.margin_note.trim(),
          detail: resolved ? `margin note on ${resolved.itemCode}` : "margin note",
          confidence: u.confidence,
          source,
          payload: {
            text: u.margin_note.trim(),
            due: null,
            due_time: null,
            priority: "normal",
            kind: "action",
            project: null,
            people: [],
            source_convention: null,
            confidence: u.confidence,
          },
        });
      }
      if (!resolved) {
        if (u.checked || u.struck) changes.checkboxUnresolved++;
        continue;
      }
      if (!u.checked && !u.struck) continue;
      if (u.confidence < opts.threshold) {
        changes.checkboxUnresolved++;
        continue;
      }
      changes.checkboxApplied++;
      if (resolved.itemType === "task") {
        const t = state.tasks.find((x) => x.id === resolved!.itemId);
        if (!t || t.status === "done" || t.status === "dropped") continue;
        if (u.struck) {
          t.status = "dropped";
          changes.tasksDropped++;
        } else {
          t.status = "done";
          t.completedOn = today;
          changes.tasksCompleted++;
        }
      } else if (resolved.itemType === "inbox") {
        const it = state.inbox.find((x) => x.id === resolved!.itemId);
        if (!it || it.status !== "pending") continue;
        if (u.struck) {
          it.status = "dropped";
          changes.inboxDropped++;
        } else {
          it.status = "accepted";
          changes.inboxAccepted++;
          promote(it, it.source);
        }
      } else if (resolved.itemType === "meeting_request") {
        const m = state.meetingRequests.find((x) => x.id === resolved!.itemId);
        if (!m || m.state !== "drafted") continue;
        if (u.struck) {
          m.state = "dropped";
          changes.meetingRequestsDropped++;
        } else {
          m.state = "confirmed";
          m.confirmedOn = today;
          changes.meetingRequestsConfirmed++;
        }
      }
    }
  }

  // ---- 2. ingest new items from notes pages ---------------------------------------------
  for (const page of pages) {
    const ex = page.extraction;
    if (ex.page_kind === "blank") continue;
    const source: ItemSource = { notebook: page.notebook, pageIndex: page.pageIndex };
    const pageTaskTexts: string[] = [];

    for (const t of ex.tasks) {
      if (ex.page_kind === "planner" && !t.source_convention) continue; // printed rows are not new tasks
      if (t.confidence < opts.threshold) {
        addInbox({
          id: stableId(`inbox:task:${today}`, t.text),
          kind: "task",
          text: t.text,
          detail: t.due ? `due ${t.due}${t.due_time ? ` ${t.due_time}` : ""}` : null,
          confidence: t.confidence,
          source,
          payload: t as unknown as Record<string, unknown>,
        });
        continue;
      }
      pageTaskTexts.push(t.text);
      addTask(t, source);
    }

    for (const e of ex.events) {
      if (e.confidence < opts.threshold) {
        addInbox({
          id: stableId(`inbox:event:${today}`, `${e.title} ${e.date ?? ""}`),
          kind: "event",
          text: e.title,
          detail: [e.date, e.start_time].filter(Boolean).join(" ") || null,
          confidence: e.confidence,
          source,
          payload: e as unknown as Record<string, unknown>,
        });
        continue;
      }
      addEvent(e, source);
    }

    for (const m of ex.meeting_requests) {
      if (m.confidence < opts.threshold) {
        addInbox({
          id: stableId(`inbox:mr:${today}`, `${m.topic} ${m.proposed_date ?? ""}`),
          kind: "meeting_request",
          text: `Set up: ${m.topic}`,
          detail: [m.proposed_date, m.proposed_time, m.attendees.length ? `with ${m.attendees.join(", ")}` : null].filter(Boolean).join(" ") || null,
          confidence: m.confidence,
          source,
          payload: m as unknown as Record<string, unknown>,
        });
        continue;
      }
      addMeetingRequest(m, source);
    }

    // Meetings: a page is (almost always) ONE meeting. Notes on the same page and date are
    // folded into a single meeting whose topic is the first topic the decoder named; further
    // topics become headed sections. Loose notes (null topic) are not meetings.
    const grouped = new Map<string, Meeting>();
    for (const n of ex.notes) {
      if (!n.meeting_topic || n.confidence < opts.threshold * 0.85) continue;
      const date = n.meeting_date ?? today;
      const existing = grouped.get(date);
      if (existing) {
        const section = existing.topic.toLowerCase() === n.meeting_topic.toLowerCase() ? n.text : `${n.meeting_topic}\n${n.text}`;
        existing.text = `${existing.text}\n\n${section}`.trim();
        existing.decisions.push(...n.decisions);
        existing.attendees = [...new Set([...existing.attendees, ...n.attendees])];
        existing.confidence = Math.min(existing.confidence, n.confidence);
        if (!existing.time && n.meeting_time) existing.time = n.meeting_time;
        continue;
      }
      grouped.set(date, {
        id: stableId("meeting", `${n.meeting_topic} ${date} ${page.notebook} ${page.pageIndex}`),
        topic: n.meeting_topic,
        date,
        time: n.meeting_time,
        attendees: [...n.attendees],
        text: n.text,
        decisions: [...n.decisions],
        actions: pageTaskTexts,
        confidence: n.confidence,
        source,
      });
    }
    for (const m of grouped.values()) {
      if (state.meetings.some((x) => x.id === m.id)) continue;
      const dup = state.meetings.find((x) => x.date === m.date && similar(x.topic, m.topic) && x.source.notebook === m.source.notebook && x.source.pageIndex === m.source.pageIndex);
      if (dup) continue;
      state.meetings.push(m);
      newMeetings.push(m);
      changes.meetingsCreated++;
    }
  }

  // ---- 3. age carried items (once per local date) --------------------------------------
  for (const t of state.tasks) {
    if (t.status !== "open" && t.status !== "carried") continue;
    if (t.createdOn >= today) continue;
    if (t.lastAgedOn === today) continue;
    t.carriedCount += 1;
    t.status = "carried";
    t.lastAgedOn = today;
    changes.tasksCarried++;
  }

  // Inbox expiry.
  const expiry = opts.inboxExpiryDays ?? 7;
  for (const it of state.inbox) {
    if (it.status === "pending" && it.createdOn < addDays(today, -expiry)) {
      it.status = "expired";
      changes.inboxExpired++;
    }
  }

  state.tasks.sort((a, b) => compareActions(a, b));
  log.push(
    `checkboxes applied=${changes.checkboxApplied} unresolved=${changes.checkboxUnresolved}`,
    `tasks created=${changes.tasksCreated} merged=${changes.tasksMerged} done=${changes.tasksCompleted} dropped=${changes.tasksDropped} carried=${changes.tasksCarried}`,
    `events created=${changes.eventsCreated}; meeting requests created=${changes.meetingRequestsCreated} confirmed=${changes.meetingRequestsConfirmed}`,
    `inbox created=${changes.inboxCreated} accepted=${changes.inboxAccepted} dropped=${changes.inboxDropped} expired=${changes.inboxExpired}; meetings created=${changes.meetingsCreated}`,
  );
  return { state, changes, newMeetings, log };
}

function labelMatches(state: WorkingSet, p: PrintedItem, label: string): boolean {
  if (p.itemType === "task") {
    const t = state.tasks.find((x) => x.id === p.itemId);
    return !!t && similar(t.text, label, 0.6);
  }
  if (p.itemType === "inbox") {
    const it = state.inbox.find((x) => x.id === p.itemId);
    return !!it && similar(it.text, label, 0.6);
  }
  const m = state.meetingRequests.find((x) => x.id === p.itemId);
  return !!m && similar(`Invite: ${m.topic}`, label, 0.6);
}

/** The open Action List, canonical order: date then priority (rule 8). */
export function openActionList(state: WorkingSet): StoredTask[] {
  return state.tasks.filter((t) => t.status === "open" || t.status === "carried").sort(compareActions);
}

export function activeEvents(state: WorkingSet): StoredEvent[] {
  return state.events.filter((e) => e.status === "active");
}

export function pendingInbox(state: WorkingSet): StoredInboxItem[] {
  return state.inbox.filter((i) => i.status === "pending");
}

export function draftedMeetingRequests(state: WorkingSet): StoredMeetingRequest[] {
  return state.meetingRequests.filter((m) => m.state === "drafted");
}
