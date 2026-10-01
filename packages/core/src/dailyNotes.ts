/**
 * The daily Notes document: everything written that day, under the name of the notebook it was
 * written in.
 *
 * Until October 2026 the Notes notebook held meetings only — a page became a note when the decoder
 * found a meeting title on it — and a day of ordinary writing produced an empty notebook while the
 * same pages filled the Action List. Now every page of handwriting read is reported, and only what is
 * NEW on it: a page is read whole every time it changes, so the lines already reported on an earlier
 * day are taken off by comparing tonight's reading with the last one (`newLines`).
 *
 * Pure: the pipeline stores the readings and decides the date; this decides what is new and how the
 * day is laid out.
 */
import { normalizeText } from "./text.js";

/** A line counts as already reported when its words mostly match one, allowing a re-read's small wobble. */
const SAME_LINE = 0.6;

/** The written lines of a page, in order, blank lines and trailing spaces dropped. */
export function pageLines(text: string): string[] {
  return text
    .split("\n") // a trailing CR goes with the trailing spaces below
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => normalizeText(l) !== "");
}

/**
 * A line as the set of its words, normalised. This — not the text — is what is kept between nights
 * to recognise a line already reported: the pipeline passes each word through a keyed fingerprint
 * first, so the store holds no readable transcription (rule 5) and the comparison is unchanged.
 */
export function lineTokens(line: string): string[] {
  return normalizeText(line).split(" ").filter(Boolean);
}

function overlap(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * The lines of `current` that were not on the page at its last reading, given that reading as one
 * word list per line.
 *
 * Each earlier line can account for one line now, so a line written twice is new the second time.
 * Matching allows a re-read to differ a little — the model does not transcribe the same ink
 * identically every night — so a line already reported is not reported again because one word came
 * out differently. Very short lines are where one word is most of the line, and those can come back
 * as new: the safer mistake. No earlier reading means the page is new to us and all of it is new.
 */
export function newLines(
  previous: ReadonlyArray<readonly string[]> | null,
  current: readonly string[],
  tokensOf: (line: string) => string[] = lineTokens,
): string[] {
  if (!previous || previous.length === 0) return [...current];
  const unused = [...previous];
  const out: string[] = [];
  for (const line of current) {
    const tokens = tokensOf(line);
    let best = -1;
    let bestScore = SAME_LINE;
    unused.forEach((p, i) => {
      const score = overlap(p, tokens);
      if (score >= bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) unused.splice(best, 1);
    else out.push(line);
  }
  return out;
}

/** Lines already on today's entry for a page, plus those found since, without repeating any. */
export function appendLines(existing: readonly string[], added: readonly string[]): string[] {
  return [...existing, ...newLines(existing.map(lineTokens), added)];
}

export interface DailyNoteEntry {
  /** The local date the writing was done on. */
  date: string;
  docId: string;
  pageId: string;
  notebook: string;
  pageIndex: number;
  lines: string[];
}

export interface DailyNotesModel {
  date: string;
  /** One section per notebook, in name order; its pages in page order. */
  notebooks: Array<{ notebook: string; pages: Array<{ pageIndex: number; lines: string[] }> }>;
  lineCount: number;
}

export function buildDailyNotes(date: string, entries: readonly DailyNoteEntry[]): DailyNotesModel {
  const byNotebook = new Map<string, Array<{ pageIndex: number; lines: string[] }>>();
  let lineCount = 0;
  for (const e of entries) {
    if (e.date !== date || e.lines.length === 0) continue;
    const pages = byNotebook.get(e.notebook) ?? [];
    pages.push({ pageIndex: e.pageIndex, lines: e.lines });
    byNotebook.set(e.notebook, pages);
    lineCount += e.lines.length;
  }
  const notebooks = [...byNotebook.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([notebook, pages]) => ({ notebook, pages: pages.sort((a, b) => a.pageIndex - b.pageIndex) }));
  return { date, notebooks, lineCount };
}

/** The tablet name: "Notes - 10-01-2026", month first and dashed like the weekly archive's names. */
export function dailyNotesName(date: string): string {
  const [y, m, d] = date.split("-");
  return `Notes - ${m}-${d}-${y}`;
}

/** The date a daily Notes name stands for, or null when the name is not one. */
export function dailyNotesDate(name: string): string | null {
  const m = /^Notes - (\d{2})-(\d{2})-(\d{4})$/.exec(name);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}
