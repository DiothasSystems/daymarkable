/**
 * Dates and due tags, as the rest of the product words them.
 *
 * `dueTag` is a deliberate copy of `apps/web/src/server/services.ts`, not an import. The obvious
 * home for it is `packages/core`, but core reaches for `node:crypto` (stableId), which Metro
 * cannot bundle — so a shared import would mean splitting core, which is a bigger change than
 * this repetition is worth today. `format.test.ts` pins the two together; if the web's copy
 * changes and this one does not, that test is what says so. Revisit if a second helper follows
 * it across.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** ISO dates are compared and built as strings throughout — never as local Date objects. */
export function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string): string {
  const d = parseIso(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return toIso(d);
}

export function addMonths(iso: string, n: number): string {
  const d = parseIso(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return toIso(d);
}

/** "September 2026", for the calendar header. */
export function monthTitle(iso: string): string {
  const d = parseIso(iso);
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${long[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mon 14 Sep", the day heading. */
export function dayTitle(iso: string): string {
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "14 Sep", compact enough for a row. */
export function shortDate(iso: string): string {
  const d = parseIso(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function dayOfMonth(iso: string): number {
  return parseIso(iso).getUTCDate();
}

/**
 * The six-week grid a month is drawn on, Monday first, padded with the neighbouring months'
 * days so every row is seven cells.
 */
export function monthGrid(anyDayInMonth: string): string[] {
  const first = monthStart(anyDayInMonth);
  // getUTCDay is Sunday-first; the grid is Monday-first, which is what the planner prints.
  const lead = (parseIso(first).getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * Due copy from the Web UI mock: TODAY / TOMORROW / THIS WEEK / THIS MONTH / a date.
 * Mirrors `dueTag` in apps/web/src/server/services.ts — see this file's header.
 */
export function dueTag(due: string | null, today: string): { label: string; soon: boolean } | null {
  if (!due) return null;
  const days = Math.round((parseIso(due).getTime() - parseIso(today).getTime()) / 86_400_000);
  if (days < 0) return { label: "OVERDUE", soon: true };
  if (days === 0) return { label: "TODAY", soon: true };
  if (days === 1) return { label: "TOMORROW", soon: true };
  if (days <= 7) return { label: "THIS WEEK", soon: false };
  if (due.slice(0, 7) === today.slice(0, 7)) return { label: "THIS MONTH", soon: false };
  return { label: shortDate(due).toUpperCase(), soon: false };
}

/** "NOTEBOOK · p.3", the provenance line under an item. A typed item has no page to cite. */
export function sourceLine(source: { notebook: string; pageIndex: number } | null | undefined): string | null {
  if (!source?.notebook) return null;
  return `${source.notebook.toUpperCase()} · p.${source.pageIndex + 1}`;
}
