import { describeConventions, type UserInkConventions } from "./conventions.js";
import { SCHEMA_DESCRIPTION } from "./schema.js";

/**
 * Description of what the composer draws (CLAUDE.md rule 6): whenever a planner template
 * changes, update this text in the same PR so the decoder always knows the layout.
 */
export const PLANNER_LAYOUT_DESCRIPTION = `dayMarkable's OWN planner pages look like this:
- Header: a small solid triangle mark and the word "dayMarkable" top-left; the date top-right.
- A monospace footer code bottom-left of the form dM/<KIND>/<YYYY-MM-DD>/<page>, where KIND is
  DAY, WEEK, MONTH, QUARTER, YEAR, INBOX, ACTIONS, or MEETINGS. If you see such a code, set
  page_kind to "planner" and copy the code into planner_page_code exactly.
- Checkbox rows: a square box, the item text, and a short monospace item code at the right edge
  (A01, A02... for actions; I01, I02... for Inbox items). Report every box whose state you can
  see in checkbox_updates: checked = a tick, cross, or fill inside the box; struck = the text is
  crossed out with a line through it (that means "drop this"). Copy the item code exactly.
- A ruled column on the right titled "Margin". Handwriting there is a margin_note attached to the
  nearest checkbox row (put the item code in item_code) or, when it is free-standing, a normal
  note/task with page context.
- Printed (typeset) text is the planner's own content: never re-emit printed planner rows as new
  tasks or events. Only HANDWRITTEN additions are new items.`;

export interface SystemPromptOptions {
  conventions: UserInkConventions;
}

/** Stable per user (conventions are the only variable part), so it prompt-caches across pages. */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
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
   Events: dated/timed commitments already agreed ("dentist Tue 2pm").
   Meeting requests: intent to SET UP a meeting ("set up 30 min with Priya next Tue").
   Notes: meeting-note content grouped by meeting topic; loose notes use meeting_topic null.
4. Confidence is about legibility AND interpretation. Below 0.7 means a human should confirm.
   Set needs_escalation true only if the page is so hard to read that a stronger model
   should retry it.
5. page_kind "blank" for empty pages; return empty arrays and transcription "".
6. Never invent names, dates, or numbers you cannot see. A misread name could email a stranger.

${describeConventions(opts.conventions)}

${PLANNER_LAYOUT_DESCRIPTION}

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
