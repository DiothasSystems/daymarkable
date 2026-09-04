/**
 * Handwriting calibration: generate a short passage for this writer to copy by hand, then use
 * the captured page as a few-shot example of their letterforms.
 *
 * Claude's vision models cannot be fine-tuned, so "training" here means context: a known
 * ground-truth text paired with an image of this person writing it, plus the vocabulary they
 * actually use. Both ride in the cached system prompt, so they cost ~0.1x after the first page.
 */
import Anthropic from "@anthropic-ai/sdk";
import { costUsd, zeroUsage, type TokenUsage } from "./pricing.js";

export interface WriterProfile {
  /** e.g. "VP of Product" */
  role: string;
  /** e.g. "broadband / telecom hardware" */
  industry: string;
  /** Anything else: recurring people, products, customers, how they take notes. */
  context: string;
}

export interface CalibrationPassage {
  /** The text to copy out, ~half a page by hand. */
  text: string;
  /** Terms deliberately included; these seed the lexicon. */
  terms: string[];
  usage: TokenUsage;
  costUsd: number;
}

const GENERATE_SYSTEM = `You write short handwriting-calibration passages for dayMarkable, a service that reads
handwritten notes from a reMarkable tablet.

The user will copy your passage out by hand. The captured page teaches the decoder that
person's letterforms, so the passage must exercise everything the decoder will later meet in
their real notes.

Return ONLY a JSON object, no prose or fences:
{"lines": string[], "terms": string[]}

"lines" is the passage, one array entry per written line, in the order they should write it.
Rules for the passage:
1. Exactly 10 to 13 short lines: half a page of handwriting, no more. Keep each line under 46
   characters so it fits on one written line.
2. Written in the voice of THEIR OWN meeting notes, not prose about them. Fragments, dashes,
   arrows and abbreviations, the way people actually write notes.
3. Deliberately cover, spread naturally through the lines:
   - all ten digits 0-9, at least one 4-digit number and one decimal
   - a date in two forms (e.g. "9/14" and "Sep 14") and two times (e.g. "0930", "2:15pm")
   - the ink conventions: one line starting with an asterisk, one underlined phrase written
     as _like this_, one line starting with TODO
   - an arrow (->), an ampersand, a percentage, a dollar amount, parentheses, a slash
   - at least six proper nouns from their industry: companies, products, standards, or
     plausible colleague names
   - two or three acronyms typical of their field
   - one line with a struck-out word written as ~~word~~
4. Never include real private data, and never anything embarrassing or sensitive.
5. Vary letter shapes: include words with ascenders, descenders, doubled letters, and both
   upper and lower case.

"terms" lists the proper nouns and acronyms you used, exactly as spelled, for the decoder's
lexicon.`;

function fallbackPassage(profile: WriterProfile): CalibrationPassage {
  const who = profile.role || "the team";
  return {
    text: [
      `Weekly sync - ${who} - 9/14`,
      "Attendees: Dana Okafor, Priya Raman, Tom",
      "* send Q3 numbers to Dana by Sep 14",
      "_budget holds at $48,500_",
      "renewal rate 92.4% (up from 88%)",
      "TODO book the 0930 review & the 2:15pm call",
      "vendor -> shortlist 3 of 7 by Friday",
      "SLA breach on 12 Aug - root cause open",
      "~~postpone~~ keep the launch date",
      "escalation path: L1 / L2 / L3",
      "open items: 4 blockers, 6 risks",
      "next check-in 10/02 at 1600",
      "action: draft the one-pager (2 pages max)",
      "follow up with finance re: PO 2291",
    ].join("\n"),
    terms: ["Dana Okafor", "Priya Raman"],
    usage: zeroUsage(),
    costUsd: 0,
  };
}

/** Ask Claude for a passage in this writer's own vocabulary. Falls back to a generic one. */
export async function generateCalibrationPassage(profile: WriterProfile, client: Anthropic, model = "claude-sonnet-5"): Promise<CalibrationPassage> {
  const ask = [
    `Role: ${profile.role || "(not given)"}`,
    `Industry: ${profile.industry || "(not given)"}`,
    profile.context ? `Also: ${profile.context}` : "",
    "Write their calibration passage.",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const message = await client.messages.create({
      model,
      max_tokens: 1500,
      system: [{ type: "text", text: GENERATE_SYSTEM }],
      messages: [{ role: "user", content: ask }],
    });
    const raw = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON in reply");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { lines?: unknown; terms?: unknown };
    const lines = Array.isArray(parsed.lines) ? parsed.lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0) : [];
    if (lines.length < 6) throw new Error("passage too short");
    const usage: TokenUsage = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    return {
      text: lines.map((l) => l.trim()).join("\n"),
      terms: Array.isArray(parsed.terms) ? parsed.terms.filter((t): t is string => typeof t === "string") : [],
      usage,
      costUsd: costUsd(usage, model, false),
    };
  } catch {
    return fallbackPassage(profile);
  }
}

/**
 * Word-level accuracy of a transcription against the passage we asked for: the share of
 * expected words that appear, in a form robust to line-break and punctuation differences.
 */
export function transcriptionAccuracy(expected: string, actual: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[~_*]/g, "")
      .replace(/[^\p{L}\p{N}\s%$/.:-]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  const want = norm(expected);
  if (want.length === 0) return 0;
  const got = new Map<string, number>();
  for (const w of norm(actual)) got.set(w, (got.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want) {
    const n = got.get(w) ?? 0;
    if (n > 0) {
      hit++;
      got.set(w, n - 1);
    }
  }
  return hit / want.length;
}

/**
 * Terms the user corrected: words present in the corrected text but not the original. These
 * are exactly the proper nouns the decoder got wrong, so they belong in the lexicon.
 */
export function learnedTerms(original: string, corrected: string): string[] {
  const words = (s: string) => s.split(/[^\p{L}\p{N}'’&/-]+/u).filter((w) => w.length > 1);
  const before = new Set(words(original).map((w) => w.toLowerCase()));
  const out: string[] = [];
  for (const w of words(corrected)) {
    if (before.has(w.toLowerCase())) continue;
    // Keep proper nouns, acronyms and hyphenated product names; skip ordinary lower-case words.
    if (/^[A-Z]/.test(w) || /^[A-Z0-9-]{2,}$/.test(w) || w.includes("-")) out.push(w);
  }
  return [...new Set(out)];
}
