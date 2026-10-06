/**
 * View models for the nightly document set (ARCHITECTURE §6), built from the working set.
 * Pure date math on YYYY-MM-DD strings; the caller supplies "today" in the user's timezone.
 */
import { actionBuckets, type ActionBucketKey } from "./actionBuckets.js";
import { activeEvents, draftedMeetingRequests, openActionList, pendingInbox } from "./merge.js";
import { eventsOnDate, occurrencesInRange } from "./recurrence.js";
import type { Meeting, StoredEvent, StoredInboxItem, StoredMeetingRequest, StoredTask, WorkingSet } from "./state.js";
import type { DailySheetModel } from "./types.js";

export interface ViewOptions {
  today: string;
  timezone: string;
  generatedAt: string;
  runLabel: string;
  /** 1 = Monday (default), 0 = Sunday. */
  weekStartsOn?: 0 | 1;
  /**
   * When set, the live Notes notebook carries only notes from this week onward; earlier ones
   * have been archived to the tablet. Null keeps every note in one notebook.
   */
  notesWeekStart?: string | null;
  stats?: DailySheetModel["stats"];
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function startOfWeek(iso: string, weekStartsOn: 0 | 1 = 1): string {
  const wd = weekday(iso);
  const back = (wd - weekStartsOn + 7) % 7;
  return addDays(iso, -back);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function ymd(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface DayCell {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  events: StoredEvent[];
  tasksDue: StoredTask[];
}

export interface WeekModel {
  start: string;
  end: string;
  days: DayCell[];
  /** Overdue and undated high-priority items. */
  focus: StoredTask[];
  /** Open actions for the sidebar: due this week first, then the rest in canonical order. */
  open: StoredTask[];
}

export interface MonthModel {
  year: number;
  month: number;
  weeks: DayCell[][];
  eventCount: number;
}

export interface QuarterModel {
  year: number;
  quarter: number;
  months: MonthModel[];
}

export interface ProgressBar {
  label: string;
  /** 0..1 */
  value: number;
  /** Mono text at the right, e.g. "70%" or "6/9". */
  text: string;
}

export interface YearModel {
  year: number;
  months: MonthModel[];
  /** "YEAR GOALS · PROGRESS" bars, computed from the working set (no LLM prose). */
  progress: ProgressBar[];
}

export interface InboxPageModel {
  items: StoredInboxItem[];
  meetingRequests: StoredMeetingRequest[];
}

export interface ActionListGroup {
  /** When these are due: "Overdue", "Today", "Next 7 days", "Later", "No date yet" (actionBuckets.ts). */
  key: ActionBucketKey;
  label: string;
  /** Unused since the list is grouped by due date; each row names its own notebook and page. */
  subtitle: string | null;
  date: string | null;
  tasks: StoredTask[];
}

export interface ActionListModel {
  groups: ActionListGroup[];
  openCount: number;
  completedRecently: StoredTask[];
}

export interface MeetingNotesModel {
  meetings: Meeting[];
}

export interface PlannerModel {
  daily: DailySheetModel;
  week: WeekModel;
  month: MonthModel;
  quarter: QuarterModel;
  year: YearModel;
  inbox: InboxPageModel;
}

export interface OutputSet {
  planner: PlannerModel;
  actionList: ActionListModel;
  meetingNotes: MeetingNotesModel;
}

function eventsOn(events: StoredEvent[], date: string): StoredEvent[] {
  // Expands repeating series, so a weekly meeting appears on every page it falls on.
  return eventsOnDate(events, date);
}

function cell(date: string, opts: ViewOptions, events: StoredEvent[], tasks: StoredTask[], inMonth: boolean): DayCell {
  return { date, inMonth, isToday: date === opts.today, events: eventsOn(events, date), tasksDue: tasks.filter((t) => t.due === date) };
}

export function buildWeek(state: WorkingSet, opts: ViewOptions): WeekModel {
  const events = activeEvents(state);
  const tasks = openActionList(state);
  const start = startOfWeek(opts.today, opts.weekStartsOn ?? 1);
  const days = Array.from({ length: 7 }, (_, i) => cell(addDays(start, i), opts, events, tasks, true));
  const end = addDays(start, 6);
  const focus = tasks.filter((t) => (t.due === null && t.priority === "high") || (t.due !== null && t.due < start)).slice(0, 8);
  const thisWeek = tasks.filter((t) => t.due !== null && t.due >= start && t.due <= end);
  const open = [...thisWeek, ...tasks.filter((t) => !thisWeek.includes(t))].slice(0, 12);
  return { start, end, days, focus, open };
}

export function buildMonth(state: WorkingSet, year: number, month: number, opts: ViewOptions): MonthModel {
  const events = activeEvents(state);
  const tasks = openActionList(state);
  const first = ymd(year, month, 1);
  const gridStart = startOfWeek(first, opts.weekStartsOn ?? 1);
  const total = daysInMonth(year, month);
  const weeks: DayCell[][] = [];
  let cursor = gridStart;
  let eventCount = 0;
  for (let w = 0; w < 6; w++) {
    const row: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const inMonth = cursor.startsWith(`${year}-${String(month).padStart(2, "0")}`);
      const c = cell(cursor, opts, events, tasks, inMonth);
      if (inMonth) eventCount += c.events.length;
      row.push(c);
      cursor = addDays(cursor, 1);
    }
    weeks.push(row);
    if (cursor > ymd(year, month, total) && weekday(cursor) === (opts.weekStartsOn ?? 1)) break;
  }
  return { year, month, weeks, eventCount };
}

export function buildQuarter(state: WorkingSet, opts: ViewOptions): QuarterModel {
  const year = Number(opts.today.slice(0, 4));
  const month = Number(opts.today.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  const months = [0, 1, 2].map((i) => buildMonth(state, year, (quarter - 1) * 3 + i + 1, opts));
  return { year, quarter, months };
}

export function buildYear(state: WorkingSet, opts: ViewOptions): YearModel {
  const year = Number(opts.today.slice(0, 4));
  const thisYear = (d: string | null) => d !== null && d.startsWith(`${year}-`);
  const tasks = state.tasks.filter((t) => thisYear(t.createdOn));
  const done = tasks.filter((t) => t.status === "done").length;
  const open = tasks.filter((t) => t.status === "open" || t.status === "carried").length;
  const inbox = state.inbox.filter((i) => thisYear(i.createdOn));
  const confirmed = inbox.filter((i) => i.status === "accepted").length;
  const decided = inbox.filter((i) => i.status !== "pending").length;
  const meetings = state.meetings.filter((m) => !m.deleted && thisYear(m.date)).length;
  const progress: ProgressBar[] = [
    { label: "Actions closed", value: done + open ? done / (done + open) : 0, text: `${done}/${done + open}` },
    { label: "Inbox confirmed", value: decided ? confirmed / decided : 0, text: decided ? `${Math.round((confirmed / decided) * 100)}%` : "—" },
    { label: "Meetings captured", value: Math.min(1, meetings / 100), text: String(meetings) },
  ];
  return { year, months: Array.from({ length: 12 }, (_, i) => buildMonth(state, year, i + 1, opts)), progress };
}

export function buildDaily(state: WorkingSet, opts: ViewOptions): DailySheetModel {
  const events = activeEvents(state);
  const tasks = openActionList(state);
  const horizon = addDays(opts.today, 7);
  // Occurrences, not stored rows: a weekly meeting shows on today's page and on each of the
  // next seven days it falls on, each carrying its own date.
  const todayEvents = eventsOnDate(events, opts.today);
  const upcoming = occurrencesInRange(events, addDays(opts.today, 1), horizon);
  const byTime = (a: StoredEvent, b: StoredEvent) => (a.date ?? "").localeCompare(b.date ?? "") || (a.startTime ?? "99").localeCompare(b.startTime ?? "99");
  todayEvents.sort(byTime);
  upcoming.sort(byTime);
  // The Daily Sheet shows what matters today: overdue + due today/soon + high priority + newest, capped.
  const focus = tasks.filter((t) => (t.due !== null && t.due <= horizon) || t.priority === "high" || t.createdOn === opts.today).slice(0, 14);
  return {
    date: opts.today,
    timezone: opts.timezone,
    generatedAt: opts.generatedAt,
    runLabel: opts.runLabel,
    events: todayEvents,
    upcoming,
    actions: focus,
    inbox: pendingInbox(state).slice(0, 8),
    meetingRequests: draftedMeetingRequests(state),
    stats: opts.stats ?? { pagesRead: 0, tasksFound: 0, eventsFound: 0, meetingRequestsFound: 0, notesFound: 0 },
  };
}

/**
 * The Action List: every open action grouped by when it is due, highest priority first within each
 * group, with the undated ones last (actionBuckets.ts). Each row names the notebook and page it came
 * from, which is what grouping by page used to say for a whole group.
 */
export function buildActionList(state: WorkingSet, opts: ViewOptions): ActionListModel {
  const tasks = openActionList(state);
  // By when each is due, then priority (actionBuckets.ts); every row carries its own source.
  const groups: ActionListGroup[] = actionBuckets(tasks, opts.today).map((g) => {
    const dues = g.tasks.map((t) => t.due).filter((d): d is string => d !== null);
    return { key: g.key, label: g.label, subtitle: null, date: dues.length ? dues.reduce((a, c) => (a < c ? a : c)) : null, tasks: g.tasks };
  });
  const completedRecently = state.tasks
    .filter((t) => t.status === "done" && t.completedOn !== null && t.completedOn >= addDays(opts.today, -1))
    .sort((a, b) => a.text.localeCompare(b.text));
  return { groups, openCount: tasks.length, completedRecently };
}

/** Notes weeks run Sunday to Saturday: the Sunday run closes the week that just ended. */
export function notesWeekStart(iso: string): string {
  return startOfWeek(iso, 0);
}

/** Newest first — today's notes are what you open the notebook for. */
function newestFirst(a: Meeting, b: Meeting): number {
  return (b.date ?? "").localeCompare(a.date ?? "") || (b.time ?? "").localeCompare(a.time ?? "") || a.topic.localeCompare(b.topic);
}

export interface MeetingNotesOptions {
  /** Keep only this week's notes in the live notebook; earlier ones are archived. */
  weekStart?: string | null;
}

export function buildMeetingNotes(state: WorkingSet, opts: MeetingNotesOptions = {}): MeetingNotesModel {
  const from = opts.weekStart ?? null;
  // An undated note has no week to belong to, so it stays in the live notebook rather than
  // being filed into a week it may not have happened in.
  //
  // A note whose notebook or page has been deleted from the tablet leaves the LIVE notebook: the
  // customer took its source away, and reprinting it every night is what they asked us to stop.
  // buildWeekNotes below keeps it — it was captured, and the archive is the record.
  const meetings = state.meetings
    .filter((m) => !m.deleted && !m.sourceGone)
    .filter((m) => from === null || m.date === null || m.date >= from)
    .sort(newestFirst);
  return { meetings };
}

/** The notes belonging to one Sunday-to-Saturday week, for the archived notebook. */
export function buildWeekNotes(state: WorkingSet, weekStart: string): MeetingNotesModel {
  const end = addDays(weekStart, 6);
  return { meetings: state.meetings.filter((m) => !m.deleted && m.date !== null && m.date >= weekStart && m.date <= end).sort(newestFirst) };
}

export function buildOutputSet(state: WorkingSet, opts: ViewOptions): OutputSet {
  const year = Number(opts.today.slice(0, 4));
  const month = Number(opts.today.slice(5, 7));
  return {
    planner: {
      daily: buildDaily(state, opts),
      week: buildWeek(state, opts),
      month: buildMonth(state, year, month, opts),
      quarter: buildQuarter(state, opts),
      year: buildYear(state, opts),
      inbox: { items: pendingInbox(state), meetingRequests: draftedMeetingRequests(state) },
    },
    actionList: buildActionList(state, opts),
    meetingNotes: buildMeetingNotes(state, { weekStart: opts.notesWeekStart ?? null }),
  };
}
