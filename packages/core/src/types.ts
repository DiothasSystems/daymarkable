/** Domain types shared by core, compose, runner, and web. Pure data, no I/O. */

export type Priority = "high" | "normal" | "low";
export type TaskKind = "action" | "follow_up";

export interface ItemSource {
  notebook: string;
  pageIndex: number;
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
  source: "ink" | "external";
  confidence: number;
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
