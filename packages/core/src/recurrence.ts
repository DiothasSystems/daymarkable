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

/**
 * Does this event fall on `date`?
 *
 * The event's own date anchors the series: a weekly meeting written on a Monday lands on
 * Mondays, and never before the day it was written.
 */
export function occursOn(event: Pick<CalendarItem, "date" | "recurrence">, date: string): boolean {
  const anchor = event.date;
  if (!anchor) return false;
  if (anchor === date) return true;
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
export function nextOccurrence(event: Pick<CalendarItem, "date" | "recurrence">, from: string): string | null {
  if (!event.date) return null;
  if (!event.recurrence) return event.date >= from ? event.date : null;
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
