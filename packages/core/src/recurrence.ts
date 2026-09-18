/**
 * Repeating commitments.
 *
 * The user writes a meeting once — "team meeting 9-10, weekly" — and expects to see it on every
 * page from then on. The decoder reports only what it read ("weekly"); which dates that lands on
 * is computed here, deterministically (rule 1).
 *
 * A series is stored ONCE, as the event the user wrote, and expanded when a view asks for a
 * date. Nothing is materialised into the working set: a series that is dropped stops appearing
 * everywhere at once, and there is no drift between what was written and what is shown.
 */
import ICAL from "ical.js";
import type { CalendarItem } from "./types.js";

export type Recurrence = "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";

export const RECURRENCES: readonly Recurrence[] = ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];

/** How it reads on a page: "Team meeting · WEEKLY". */
export function recurrenceLabel(r: Recurrence): string {
  return r === "weekdays" ? "WEEKDAYS" : r.toUpperCase();
}

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function daysBetween(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86400000);
}


/** What `occursOn` needs: the anchor, and whichever description of repetition the event carries. */
export type RecurringItem = Pick<CalendarItem, "date" | "startTime" | "recurrence" | "rrule" | "exdates">;

/**
 * How far a rule with no end is followed. A series with neither UNTIL nor COUNT repeats forever, and
 * forever does not fit in a Set — 2000 is over five years of a daily meeting, which is further ahead
 * than any planner page reaches.
 */
export const MAX_OCCURRENCES = 2000;

interface Expansion {
  dates: Set<string>;
  /** The furthest date reached. A query beyond it cannot be answered and is treated as no. */
  lastDate: string;
  capped: boolean;
}

/**
 * Expanded once per rule and remembered.
 *
 * `eventsOnDate` is called for every day a view covers, so without this a daily series over a year
 * would walk its own rule 365 times — 133,000 iterations to draw one month. The cache is keyed by
 * the rule and its anchor, both immutable, so it cannot go stale: the same key always describes the
 * same set of dates. That keeps this module deterministic, which is the property the whole planner
 * rests on (rule 1).
 */
const expansions = new Map<string, Expansion>();

function expand(anchor: string, startTime: string | null, rrule: string): Expansion {
  const key = `${anchor}|${startTime ?? ""}|${rrule}`;
  const hit = expansions.get(key);
  if (hit) return hit;

  const dates = new Set<string>([anchor]);
  let lastDate = anchor;
  let capped = false;
  try {
    const [y, m, d] = anchor.split("-").map(Number);
    // The TIME is part of the expansion, not decoration. UNTIL is an instant, so a 09:30 meeting on
    // the closing day falls after `UNTIL=...T000000Z` and a midnight one does not — expanding from
    // midnight silently granted every series one extra meeting.
    //
    // Built in UTC rather than the machine's zone, because this module has to give the same answer on
    // every machine (rule 1) and `localTimezone` would make the planner depend on where it ran. The
    // wall time is treated as UTC, which can differ from the truth only for an occurrence within the
    // originating zone's offset of an UNTIL boundary — a meeting just after midnight in a series
    // ending at midnight UTC.
    const [hh, mm] = (startTime ?? "").split(":").map(Number);
    const timed = Number.isFinite(hh) && Number.isFinite(mm);
    const start = new ICAL.Time(
      { year: y!, month: m!, day: d!, hour: timed ? hh! : 0, minute: timed ? mm! : 0, second: 0, isDate: !timed },
      ICAL.Timezone.utcTimezone,
    );
    const iterator = ICAL.Recur.fromString(rrule).iterator(start);
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const next = iterator.next();
      if (!next) break;
      lastDate = `${next.year}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;
      dates.add(lastDate);
      if (i === MAX_OCCURRENCES - 1) capped = true;
    }
  } catch {
    // An unparseable rule leaves just the anchor. A meeting on the day it was sent is a better
    // answer than no meeting, and better than a thrown error in the middle of composing a page.
    capped = false;
  }
  const result: Expansion = { dates, lastDate, capped };
  expansions.set(key, result);
  return result;
}

/**
 * Does this event fall on `date`?
 *
 * The event's own date anchors the series: a weekly meeting written on a Monday lands on
 * Mondays, and never before the day it was written.
 */
export function occursOn(event: RecurringItem, date: string): boolean {
  const anchor = event.date;
  if (!anchor) return false;
  // EXDATE first: the organiser removing one meeting from a series has to beat every other rule,
  // including the anchor being its own first occurrence.
  if (event.exdates && event.exdates.includes(date)) return false;
  if (anchor === date) return true;
  // A full RRULE, straight off an invite, answers for itself. Checked before the written-shorthand
  // enum because an event can carry both: a series ingested from a calendar keeps its rule, and the
  // enum is only ever a lossy summary of it for printing.
  if (event.rrule) {
    if (date < anchor) return false;
    return expand(anchor, event.startTime ?? null, event.rrule).dates.has(date);
  }
  const rule = event.recurrence;
  if (!rule) return false;
  if (date < anchor) return false;

  const from = utc(anchor);
  const on = utc(date);
  if (Number.isNaN(from.getTime()) || Number.isNaN(on.getTime())) return false;

  switch (rule) {
    case "daily":
      return true;
    case "weekdays":
      return on.getUTCDay() >= 1 && on.getUTCDay() <= 5;
    case "weekly":
      return on.getUTCDay() === from.getUTCDay();
    case "biweekly":
      return on.getUTCDay() === from.getUTCDay() && daysBetween(anchor, date) % 14 === 0;
    case "monthly":
      // No clamping: a meeting written on the 31st simply has no February occurrence, which is
      // truer to "the 31st" than silently moving it to the 28th.
      return on.getUTCDate() === from.getUTCDate();
    case "yearly":
      return on.getUTCMonth() === from.getUTCMonth() && on.getUTCDate() === from.getUTCDate();
  }
}

/**
 * The events falling on `date`, each carrying that date rather than the series anchor — so a
 * view can print an occurrence without knowing whether it repeats.
 */
export function eventsOnDate<T extends CalendarItem>(events: readonly T[], date: string): T[] {
  return events
    .filter((e) => occursOn(e, date))
    .map((e) => (e.date === date ? e : { ...e, date }))
    .sort((a, b) => (a.startTime ?? "99").localeCompare(b.startTime ?? "99"));
}

/**
 * The first date on or after `from` that this event falls on, or null if it never does again.
 * A series is stored at its anchor, so "what's next" is the only sensible thing to show a
 * reader looking at a list rather than a day.
 */
export function nextOccurrence(event: RecurringItem, from: string): string | null {
  if (!event.date) return null;
  if (!event.recurrence && !event.rrule) return event.date >= from ? event.date : null;
  const start = event.date > from ? event.date : from;
  // A year is far past any rule's period, so failing to match inside it means it never matches.
  let d = start;
  for (let i = 0; i < 366; i++) {
    if (occursOn(event, d)) return d;
    d = addDay(d);
  }
  return null;
}

/** Every occurrence in [from, to], in date then time order. One entry per event per day. */
export function occurrencesInRange<T extends CalendarItem>(events: readonly T[], from: string, to: string): T[] {
  if (to < from) return [];
  const out: T[] = [];
  for (let d = from; d <= to; d = addDay(d)) out.push(...eventsOnDate(events, d));
  return out;
}

function addDay(iso: string): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
