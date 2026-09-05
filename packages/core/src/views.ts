/**
 * View models for the nightly document set (ARCHITECTURE §6), built from the working set.
 * Pure date math on YYYY-MM-DD strings; the caller supplies "today" in the user's timezone.
 */
import { compareActions } from "./daily.js";
import { activeEvents, draftedMeetingRequests, openActionList, pendingInbox } from "./merge.js";
import type { Meeting, StoredEvent, StoredInboxItem, StoredMeetingRequest, StoredTask, WorkingSet } from "./state.js";
import type { DailySheetModel } from "./types.js";

export interface ViewOptions {
  today: string;
  timezone: string;
  generatedAt: string;
  runLabel: string;
  /** 1 = Monday (default), 0 = Sunday. */
  weekStartsOn?: 0 | 1;
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
  label: string;
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
  return events.filter((e) => e.date === date).sort((a, b) => (a.startTime ?? "99").localeCompare(b.startTime ?? "99"));
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
  const meetings = state.meetings.filter((m) => thisYear(m.date)).length;
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
  const todayEvents = events.filter((e) => e.date === opts.today);
  const upcoming = events.filter((e) => e.date !== null && e.date > opts.today && e.date <= horizon);
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

export function buildActionList(state: WorkingSet, opts: ViewOptions): ActionListModel {
  const tasks = openActionList(state);
  const groups: ActionListGroup[] = [];
  const overdue = tasks.filter((t) => t.due !== null && t.due < opts.today);
  if (overdue.length) groups.push({ label: "Overdue", date: null, tasks: overdue.sort(compareActions) });
  const dated = new Map<string, StoredTask[]>();
  for (const t of tasks) {
    if (t.due === null || t.due < opts.today) continue;
    dated.set(t.due, [...(dated.get(t.due) ?? []), t]);
  }
  for (const [date, list] of [...dated.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    groups.push({ label: date === opts.today ? "Today" : date, date, tasks: list.sort(compareActions) });
  }
  const undated = tasks.filter((t) => t.due === null);
  if (undated.length) groups.push({ label: "No date", date: null, tasks: undated.sort(compareActions) });
  const completedRecently = state.tasks
    .filter((t) => t.status === "done" && t.completedOn !== null && t.completedOn >= addDays(opts.today, -1))
    .sort((a, b) => a.text.localeCompare(b.text));
  return { groups, openCount: tasks.length, completedRecently };
}

export function buildMeetingNotes(state: WorkingSet): MeetingNotesModel {
  const meetings = [...state.meetings].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.time ?? "").localeCompare(b.time ?? "") || a.topic.localeCompare(b.topic));
  return { meetings };
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
    meetingNotes: buildMeetingNotes(state),
  };
}
