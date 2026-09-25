/** Domain types shared by core, compose, runner, and web. Pure data, no I/O. */

export type Priority = "high" | "normal" | "low";
export type TaskKind = "action" | "follow_up";

export interface ItemSource {
  notebook: string;
  pageIndex: number;
  /**
   * The tablet's own ids for the notebook and page, when the run knew them. Stable where the name
   * and position are not; what lets a note leave the live Notes notebook once its page is deleted.
   */
  docId?: string;
  pageId?: string;
  /** The date written on the page itself, when the writer dated it. Never today's date. */
  pageDate?: string | null;
}

export interface ActionItem {
  /** Stable id derived from normalized text (idempotent across re-runs). */
  id: string;
  text: string;
  due: string | null;
  dueTime: string | null;
  priority: Priority;
  kind: TaskKind;
  project: string | null;
  people: string[];
  confidence: number;
  source: ItemSource;
  /** How many nights this item has rolled over unfinished. */
  carriedCount: number;
  /** YYYY-MM-DD the item first appeared. */
  createdOn: string;
}

export interface CalendarItem {
  id: string;
  title: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  people: string[];
  /** "ink" off a page, "external" from a connected calendar, "app" typed by the user. */
  source: "ink" | "external" | "app";
  confidence: number;
  /**
   * Set when the writer marked the entry as repeating ("weekly", "every Tuesday"). The event is
   * stored once and expanded per date by packages/core/recurrence.ts; `date` is the series
   * anchor, and an expanded occurrence carries the date it falls on.
   */
  recurrence?: import("./recurrence.js").Recurrence | null;
  /**
   * A full RFC 5545 RRULE, as it arrived on a calendar invite — "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3".
   *
   * Kept raw and expanded by packages/core/recurrence.ts, because the `recurrence` enum above cannot
   * say "the third Thursday until March": storing the nearest enum value instead would put meetings
   * on the wrong days and there would be nothing left to tell that it had happened.
   */
  rrule?: string | null;
  /** Dates the organiser removed from the series (EXDATE), as local YYYY-MM-DD. */
  exdates?: string[] | null;
}

export type InboxKind = "task" | "event" | "meeting_request" | "margin_note";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  text: string;
  detail: string | null;
  confidence: number;
  source: ItemSource;
}

export interface MeetingRequestItem {
  id: string;
  topic: string;
  proposedDate: string | null;
  proposedTime: string | null;
  durationMinutes: number | null;
  attendees: string[];
  confidence: number;
  source: ItemSource;
}

export interface DailySheetModel {
  /** YYYY-MM-DD the sheet is for. */
  date: string;
  timezone: string;
  generatedAt: string;
  /** Printed in the footer next to the page code, e.g. "nightly" or "on-demand 2". */
  runLabel: string;
  events: CalendarItem[];
  upcoming: CalendarItem[];
  actions: ActionItem[];
  inbox: InboxItem[];
  meetingRequests: MeetingRequestItem[];
  stats: {
    pagesRead: number;
    tasksFound: number;
    eventsFound: number;
    meetingRequestsFound: number;
    notesFound: number;
  };
}
