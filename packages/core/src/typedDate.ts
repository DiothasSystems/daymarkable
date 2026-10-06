/**
 * A due date as a person types it into the website or the app: "10/14", "10/14/26", "Oct 14",
 * "14 October", "2026-10-14", "fri", "tomorrow". The answer is a YYYY-MM-DD, or null when the text
 * is not a date — the caller says so rather than guessing (rule 1: code decides, and a wrong date
 * is worse than none).
 *
 * A date with no year is the NEXT time it comes round, so "1/5" typed in December is January; a
 * weekday is the next one after today ("fri" on a Friday is a week on), matching what the decoder is
 * told for a handwritten one. Month-first, as written in the United States, where this ships first.
 */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Month and day with no year: this year's, unless that has passed, then next year's. */
function nextOccurrence(m: number, d: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = iso(year, m, d);
  if (thisYear === null) return iso(year + 1, m, d);
  return thisYear >= today ? thisYear : iso(year + 1, m, d);
}

/** "oct", "octo", "october" — the start of a month's name, three letters or more ("sept" too). */
function monthIndex(word: string): number | null {
  if (word.length < 3) return null;
  const i = MONTHS.findIndex((name) => name.startsWith(word));
  return i >= 0 ? i + 1 : null;
}

export function parseTypedDate(input: string, today: string): string | null {
  const s = input.trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s === "today") return today;
  if (s === "tomorrow" || s === "tmrw" || s === "tmw") return addDays(today, 1);

  // "fri", "frid", "friday" — the start of a day's name; "thurs" and "tues" are starts too.
  const weekday = s.length >= 3 ? DAYS.findIndex((name) => name.startsWith(s)) : -1;
  if (weekday >= 0) {
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    return addDays(today, (weekday - now + 7) % 7 || 7);
  }

  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(s))) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (!m[3]) return nextOccurrence(month, day, today);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(year, month, day);
  }
  // "oct 14", "october 14 2026", "14 oct", "14 october 2026"
  if ((m = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(s))) {
    const month = monthIndex(m[1]!);
    if (month === null) return null;
    return m[3] ? iso(Number(m[3]), month, Number(m[2])) : nextOccurrence(month, Number(m[2]), today);
  }
  if ((m = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(s))) {
    const month = monthIndex(m[2]!);
    if (month === null) return null;
    return m[3] ? iso(Number(m[3]), month, Number(m[1])) : nextOccurrence(month, Number(m[1]), today);
  }
  return null;
}
