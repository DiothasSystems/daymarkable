import type { PageExtraction } from "@daymarkable/decode";
import { similar, stableId } from "./text.js";
import type {
  ActionItem,
  CalendarItem,
  DailySheetModel,
  InboxItem,
  ItemSource,
  MeetingRequestItem,
  Priority,
} from "./types.js";

export interface DecodedPage {
  notebook: string;
  pageIndex: number;
  extraction: PageExtraction;
}

export interface AssembleDailyOptions {
  date: string;
  timezone: string;
  generatedAt: string;
  runLabel: string;
  confidenceThreshold: number;
  /** Items already on the living Action List (Milestone 2 feeds these in). */
  existingActions?: readonly ActionItem[];
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function compareActions(a: ActionItem, b: ActionItem): number {
  if (a.due !== b.due) {
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  }
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  if (a.createdOn !== b.createdOn) return a.createdOn < b.createdOn ? -1 : 1;
  return a.text.localeCompare(b.text);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic assembly of a Daily Sheet from decoded pages (CLAUDE.md rule 1: code organizes).
 * - dedupes tasks by fuzzy text match ("call dentist" twice = one task)
 * - routes items under the confidence threshold to the Inbox (rule 3)
 * - orders actions by date, then priority (rule 8 ordering)
 */
export function assembleDailySheet(pages: readonly DecodedPage[], opts: AssembleDailyOptions): DailySheetModel {
  const actions: ActionItem[] = [...(opts.existingActions ?? [])];
  const inbox: InboxItem[] = [];
  const events: CalendarItem[] = [];
  const meetingRequests: MeetingRequestItem[] = [];
  const stats = { pagesRead: pages.length, tasksFound: 0, eventsFound: 0, meetingRequestsFound: 0, notesFound: 0 };

  const pushAction = (candidate: ActionItem) => {
    const dup = actions.find((a) => similar(a.text, candidate.text));
    if (dup) {
      // Keep the earlier item; upgrade priority/due if the new ink is more specific.
      if (PRIORITY_RANK[candidate.priority] < PRIORITY_RANK[dup.priority]) dup.priority = candidate.priority;
      if (!dup.due && candidate.due) {
        dup.due = candidate.due;
        dup.dueTime = candidate.dueTime;
      }
      return;
    }
    actions.push(candidate);
  };

  for (const page of pages) {
    const ex = page.extraction;
    const source: ItemSource = { notebook: page.notebook, pageIndex: page.pageIndex };
    stats.tasksFound += ex.tasks.length;
    stats.eventsFound += ex.events.length;
    stats.meetingRequestsFound += ex.meeting_requests.length;
    stats.notesFound += ex.notes.length;

    for (const t of ex.tasks) {
      if (t.confidence < opts.confidenceThreshold) {
        inbox.push({
          id: stableId("inbox:task", t.text),
          kind: "task",
          text: t.text,
          detail: t.due ? `due ${t.due}${t.due_time ? ` ${t.due_time}` : ""}` : null,
          confidence: t.confidence,
          source,
        });
        continue;
      }
      pushAction({
        id: stableId("task", t.text),
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
        createdOn: opts.date,
      });
    }

    for (const e of ex.events) {
      if (e.confidence < opts.confidenceThreshold) {
        inbox.push({
          id: stableId("inbox:event", `${e.title} ${e.date ?? ""} ${e.start_time ?? ""}`),
          kind: "event",
          text: e.title,
          detail: [e.date, e.start_time].filter(Boolean).join(" ") || null,
          confidence: e.confidence,
          source,
        });
        continue;
      }
      const id = stableId("event", `${e.title} ${e.date ?? ""} ${e.start_time ?? ""}`);
      if (events.some((x) => x.id === id)) continue;
      events.push({
        id,
        title: e.title,
        date: e.date,
        startTime: e.start_time,
        endTime: e.end_time,
        location: e.location,
        people: e.people,
        source: "ink",
        confidence: e.confidence,
      });
    }

    for (const m of ex.meeting_requests) {
      const id = stableId("meeting_request", `${m.topic} ${m.proposed_date ?? ""} ${m.attendees.join(",")}`);
      if (m.confidence < opts.confidenceThreshold) {
        inbox.push({
          id: `inbox:${id}`,
          kind: "meeting_request",
          text: `Set up: ${m.topic}`,
          detail: [m.proposed_date, m.proposed_time, m.attendees.length ? `with ${m.attendees.join(", ")}` : null]
            .filter(Boolean)
            .join(" ") || null,
          confidence: m.confidence,
          source,
        });
        continue;
      }
      if (meetingRequests.some((x) => x.id === id)) continue;
      meetingRequests.push({
        id,
        topic: m.topic,
        proposedDate: m.proposed_date,
        proposedTime: m.proposed_time,
        durationMinutes: m.duration_minutes,
        attendees: m.attendees,
        confidence: m.confidence,
        source,
      });
    }
  }

  actions.sort(compareActions);
  const horizon = addDays(opts.date, 7);
  const today = events.filter((e) => e.date === opts.date || e.date === null);
  const upcoming = events.filter((e) => e.date !== null && e.date > opts.date && e.date <= horizon);
  const byTime = (a: CalendarItem, b: CalendarItem) =>
    (a.date ?? "").localeCompare(b.date ?? "") || (a.startTime ?? "99").localeCompare(b.startTime ?? "99");
  today.sort(byTime);
  upcoming.sort(byTime);
  // Inbox: dedupe by id, keep insertion order (page order) for a stable read.
  const seen = new Set<string>();
  const inboxUnique = inbox.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));

  return {
    date: opts.date,
    timezone: opts.timezone,
    generatedAt: opts.generatedAt,
    runLabel: opts.runLabel,
    events: today,
    upcoming,
    actions,
    inbox: inboxUnique,
    meetingRequests,
    stats,
  };
}
