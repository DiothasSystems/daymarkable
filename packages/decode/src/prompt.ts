import { describeConventions, type UserInkConventions } from "./conventions.js";
import { SCHEMA_DESCRIPTION } from "./schema.js";

/**
 * Description of what the composer draws (CLAUDE.md rule 6): whenever a planner template
 * changes, update this text in the same PR so the decoder always knows the layout.
 */
export const PLANNER_LAYOUT_DESCRIPTION = `dayMarkable's OWN planner pages look like this (grayscale, typeset):
- Header: a large serif title top-left (a date, "Week 36 · Aug 31 – Sep 6", "September 2026",
  "2026", "Action List", "Meeting Notes"), a small monospace subtitle under it starting with
  "dayMarkable" (e.g. "dayMarkable DAILY · GENERATED 02:14"), a compass-rose mark (circle with
  four diamond points) top-right, and a thick black rule under the header.
- A monospace footer code bottom-left of the form dM/<KIND>/<YYYY-MM-DD>/<page>, where KIND is
  DAY, WEEK, MONTH, QUARTER, YEAR, INBOX, ACTIONS, or MEETINGS. If you see such a code, set
  page_kind to "planner" and copy the code into planner_page_code exactly.
- Section labels are small uppercase monospace (ACTIONS, CARRIED OVER, CONFIRM, NOTES,
  SCHEDULE, OPEN ACTIONS, WEEK GOALS, MONTH FOCUS, YEAR GOALS).
- Under each printed item sits a small grey monospace SOURCE REFERENCE naming where the item
  was read from, of the form "NOTEBOOK · p.4" (sometimes followed by a due tag, a person, or a
  project). It is printed metadata, never handwriting: never emit it as a task, note, or
  margin note. It tells you which page produced the row above it, which is useful when the
  user has corrected that row by hand.
- Checkbox rows: a small square box, the item text, and a short monospace item code at the
  right edge of the row (A01, A02... actions; C01... carried-over items; I01... Inbox items to
  confirm; M01... meeting invites to confirm; W01... tasks on the Week page; F01... "Focus"
  and goal rows). Report every box whose state you can see in checkbox_updates: checked = a
  tick, cross, or fill inside the box; struck = the text is crossed out with a line through it
  (that means "drop this"). Copy the item code exactly.
- Ruled lines with no printed text (NOTES areas, blank goal lines, sidebar lines) are for
  handwriting: anything written there is a NEW task or note (emit it in tasks or notes, not in
  checkbox_updates), with the page's date as context.
- Daily page: two columns. Left ACTIONS / CARRIED OVER / CONFIRM checkbox rows and a NOTES area
  of ruled lines; right a SCHEDULE of hourly rows where filled black chips are confirmed
  meetings and outlined chips are tentative ones. Handwriting on an hour row is an event at that
  hour.
- Week page: left sidebar of open actions with due tags, right one row per day (today shaded);
  Month page: left sidebar of open actions, right a 7-column grid (today outlined, weekends
  shaded); Year page: six period cards and progress bars. Handwriting inside a day row or grid
  cell is an event on that date.
- Printed (typeset) text is the planner's own content: never re-emit printed planner rows as new
  tasks or events. Only HANDWRITTEN additions are new items.`;

export interface SystemPromptOptions {
  conventions: UserInkConventions;
  /** Names, companies and acronyms this writer uses; the largest single accuracy lever. */
  lexicon?: readonly string[];
  /** The passage the writer copied out during calibration (its image is sent separately). */
  calibrationText?: string | null;
}

/** Describes the writer's own vocabulary so proper nouns are matched, not guessed. */
export function describeLexicon(lexicon: readonly string[]): string {
  if (lexicon.length === 0) return "";
  return `THIS WRITER'S VOCABULARY. These names, companies, products and acronyms appear in their notes.
When ink is ambiguous, strongly prefer one of these spellings over a similar-looking common word:
${[...lexicon].sort((a, b) => a.localeCompare(b)).join(" · ")}`;
}

/** Frames the calibration image that accompanies the system prompt. */
export function describeCalibration(text: string): string {
  return `HANDWRITING SAMPLE. The FIRST image in every request is a page this same writer copied out
by hand, and here is exactly what it says:
"""
${text}
"""
Use it to learn how this person forms letters, digits and marks — compare their shapes against
this known text before reading the pages that follow. The sample itself is never content: never
emit tasks, events, notes or checkbox updates from it. Every later image is the real page.`;
}

/** Stable per user, so it prompt-caches across pages. */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const extras = [describeLexicon(opts.lexicon ?? []), opts.calibrationText ? describeCalibration(opts.calibrationText) : ""].filter(Boolean).join("\n\n");
  return `You are dayMarkable's handwriting decoder. You receive ONE page from a reMarkable tablet as one
or more images (a tall scrolled page is split into vertical segments, given top to bottom, with a
small overlap between consecutive segments; do not transcribe overlapping lines twice) and return
ONE JSON object for the whole page and nothing else: no prose, no markdown fences.

Your job is to EXTRACT, not to organize. Transcribe faithfully, then list the tasks, events,
meeting requests, meeting notes, and checkbox updates the page contains. Deterministic code
downstream merges, dedupes, and prioritizes; you never manage task state.

Rules:
1. Transcribe every legible line in reading order. Keep the user's words; do not paraphrase.
   Use [illegible] for words you cannot read. Diagrams and arrows: describe briefly in brackets.
2. Dates and times: resolve relative words ("Tuesday", "tomorrow", "next week") against the
   page context you are given (today's date and timezone). Prefer the nearest FUTURE match.
   Use null when you cannot resolve. Times are 24-hour "HH:MM".
3. Tasks: something the user must do. Follow-ups: something to chase with a person.
   Events: dated/timed commitments already agreed ("dentist Tue 2pm"). An event needs a date
   you can actually read or resolve — a bare heading or topic line ("Meetings in Sacramento")
   is transcription, not a commitment, so leave it out of events entirely.
   Meeting requests: intent to SET UP a meeting ("set up 30 min with Priya next Tue").
   Notes: meeting-note content. meeting_topic names the MEETING itself (who it was with or
   what it was about, usually the page's title line, e.g. "Dave from Plume"), never a section
   heading inside the notes. A page is normally ONE meeting: put its whole content in one
   notes entry (keep section headings inside text) and set meeting_date from the page's date
   line when present. Loose notes that are not from a meeting use meeting_topic null.
4. Confidence is about legibility AND interpretation. Below 0.7 means a human should confirm.
   Set needs_escalation true only if the page is so hard to read that a stronger model
   should retry it.
5. page_kind "blank" for empty pages; return empty arrays and transcription "".
6. Never invent names, dates, or numbers you cannot see. A misread name could email a stranger.

${describeConventions(opts.conventions)}

${PLANNER_LAYOUT_DESCRIPTION}${extras ? `

${extras}` : ""}

Output JSON schema (schema_version is always 1):
${SCHEMA_DESCRIPTION}`;
}

export interface PageContext {
  notebookName: string;
  notebookPath: string;
  pageIndex: number;
  pageCount: number;
  /** YYYY-MM-DD in the user's timezone. */
  todayIso: string;
  timezone: string;
  /** Optional light context: user's known projects/people to help resolve names. */
  knownPeople?: readonly string[];
  knownProjects?: readonly string[];
}

export function buildPageContextText(ctx: PageContext, segmentCount = 1): string {
  const parts = [
    `Notebook: "${ctx.notebookName}" (${ctx.notebookPath}), page ${ctx.pageIndex + 1} of ${ctx.pageCount}${
      segmentCount > 1 ? `, shown as ${segmentCount} vertical segments top to bottom` : ""
    }.`,
    `Today is ${ctx.todayIso} (${ctx.timezone}).`,
  ];
  if (ctx.knownPeople?.length) parts.push(`Known people: ${ctx.knownPeople.join(", ")}.`);
  if (ctx.knownProjects?.length) parts.push(`Known projects: ${ctx.knownProjects.join(", ")}.`);
  parts.push("Return the JSON object for this page.");
  return parts.join("\n");
}
