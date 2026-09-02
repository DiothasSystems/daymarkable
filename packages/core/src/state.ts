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
