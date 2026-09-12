/** The persisted working set the merge operates on. Mirrors packages/db rows, but pure data. */
import type { ActionItem, CalendarItem, InboxItem, InboxKind, ItemSource, MeetingRequestItem } from "./types.js";

export type TaskStatus = "open" | "carried" | "done" | "dropped";
export interface StoredTask extends ActionItem {
  status: TaskStatus;
  sourceConvention: string | null;
  lastAgedOn: string | null;
  completedOn: string | null;
}

export interface StoredEvent extends CalendarItem {
  status: "active" | "dropped";
}

export type MeetingRequestState = "drafted" | "confirmed" | "sent" | "dropped";
export interface StoredMeetingRequest extends MeetingRequestItem {
  state: MeetingRequestState;
  confirmedOn: string | null;
}

export type InboxStatus = "pending" | "accepted" | "dropped" | "expired";
export interface StoredInboxItem extends InboxItem {
  status: InboxStatus;
  /** The extracted item to promote verbatim on accept. */
  payload: Record<string, unknown>;
  createdOn: string;
}

/** One pen stroke, as an SVG path in the drawing's own coordinate space. */
export interface InkStroke {
  d: string;
  width: number;
}

/**
 * A page's ink, kept as strokes so it can be reproduced at any size without blurring. This is
 * the drawing itself, not a description of it: the ink is the authority, and a diagram redrawn
 * by a model is not the customer's diagram.
 */
export interface InkDrawing {
  strokes: InkStroke[];
  /** The strokes' coordinate space, taken from the renderer's viewBox. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Meeting {
  id: string;
  topic: string;
  date: string | null;
  time: string | null;
  attendees: string[];
  text: string;
  decisions: string[];
  /** Task texts extracted from the same page, for the notes email/notebook. */
  actions: string[];
  confidence: number;
  source: ItemSource;
  /** The page's ink, when the page is a drawing rather than writing. Reproduced under the notes. */
  drawing?: InkDrawing | null;
  /** One line saying what the drawing is, for the reader and for search. Never the drawing itself. */
  drawingCaption?: string | null;
}

export type PrintedItemType = "task" | "inbox" | "meeting_request";
export interface PrintedItem {
  pageCode: string;
  itemCode: string;
  itemType: PrintedItemType;
  itemId: string;
}

export interface WorkingSet {
  tasks: StoredTask[];
  events: StoredEvent[];
  meetingRequests: StoredMeetingRequest[];
  inbox: StoredInboxItem[];
  meetings: Meeting[];
  /** Items printed by the PREVIOUS run's outputs (what the user could have ticked). */
  printed: PrintedItem[];
}

export function emptyWorkingSet(): WorkingSet {
  return { tasks: [], events: [], meetingRequests: [], inbox: [], meetings: [], printed: [] };
}

export type { InboxKind };
