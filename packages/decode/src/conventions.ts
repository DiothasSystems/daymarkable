/**
 * Ink conventions are per-user config (CLAUDE.md rule 9). This is the ONE module that
 * knows what a markup can mean; it is injected into the extraction prompt. Nothing in
 * packages/core may hardcode a convention's meaning.
 */

export type ConventionMeaning = "action" | "follow_up" | "priority" | "schedule" | "note";

export type ConventionId =
  | "asterisk"
  | "underline"
  | "highlight"
  | "circle"
  | "box"
  | "exclamation"
  | "margin_star"
  | "keyword";

export interface ConventionCatalogEntry {
  id: ConventionId;
  label: string;
  /** How it looks on the page — what the model should look for. */
  visual: string;
  /** Whether this convention carries a user-supplied keyword (e.g. "TODO"). */
  takesKeyword: boolean;
}

export const CONVENTION_CATALOG: readonly ConventionCatalogEntry[] = [
  { id: "asterisk", label: "Asterisk", visual: "an asterisk (*) or star drawn at the start of, or next to, a line", takesKeyword: false },
  { id: "underline", label: "Underline", visual: "a hand-drawn line under a word, phrase, or whole line", takesKeyword: false },
  { id: "highlight", label: "Highlighter stroke", visual: "a thick translucent highlighter stroke over text", takesKeyword: false },
  { id: "circle", label: "Circled text", visual: "a loop or oval drawn around a word or phrase", takesKeyword: false },
  { id: "box", label: "Boxed text", visual: "a rectangle drawn around a word or phrase", takesKeyword: false },
  { id: "exclamation", label: "Exclamation mark", visual: "an exclamation mark (!) written near a line, often in the margin", takesKeyword: false },
  { id: "margin_star", label: "Margin star", visual: "a star drawn in the left or right margin beside a line", takesKeyword: false },
  // Repeatable: a writer may register several of their own marks, each meaning something
  // different. Identity is the keyword, not the id — see conventionKey.
  { id: "keyword", label: "Your own mark or word", visual: "a symbol or word you write yourself, such as * , > , TODO or F/U", takesKeyword: true },
];

export interface ActiveConvention {
  id: ConventionId;
  meaning: ConventionMeaning;
  /**
   * Required when id === "keyword". Matched case-insensitively, and may be a single symbol as
   * readily as a word — ">" or "→" are marks like any other. Several keyword conventions may be
   * active at once, each with its own meaning; they are told apart by this value, not by the id.
   */
  keyword?: string;
}

/** A keyword may be one symbol or a short word; long enough for "FOLLOW UP", short enough to write. */
export const MAX_KEYWORD_LENGTH = 24;

export interface UserInkConventions {
  active: ActiveConvention[];
}

/** Starter set from BUILD_PLAN Phase 0 item 5: asterisk = action, underline = follow-up, "TODO" = action. */
export const STARTER_CONVENTIONS: UserInkConventions = {
  active: [
    { id: "asterisk", meaning: "action" },
    { id: "underline", meaning: "follow_up" },
    { id: "keyword", meaning: "action", keyword: "TODO" },
  ],
};

const MEANING_TEXT: Record<ConventionMeaning, string> = {
  action: "an ACTION the user must do (emit a task with kind \"action\")",
  follow_up: "a FOLLOW-UP the user must chase with someone (emit a task with kind \"follow_up\")",
  priority: "HIGH PRIORITY (set priority \"high\" on the task or event it marks)",
  schedule: "something to SCHEDULE (emit a meeting_request or event)",
  note: "a NOTE worth keeping but not a task (include the marked text in notes[], and do NOT emit a task for it)",
};

/** Stable identifier for a convention inside prompts and extraction output. */
export function conventionKey(c: ActiveConvention): string {
  return c.id === "keyword" ? `keyword:${(c.keyword ?? "").toUpperCase()}` : c.id;
}

/** Prompt fragment. Deterministic ordering so the cached system prompt stays byte-stable. */
export function describeConventions(conventions: UserInkConventions): string {
  const active = [...conventions.active].sort((a, b) => conventionKey(a).localeCompare(conventionKey(b)));
  if (active.length === 0) {
    return "The user has registered NO ink conventions. Only wording (\"call\", \"send\", \"book\", \"remind me\") signals a task.";
  }
  const lines = active.map((c) => {
    const entry = CONVENTION_CATALOG.find((e) => e.id === c.id);
    const visual =
      c.id === "keyword"
        ? `the mark or word "${c.keyword ?? ""}" written at the start of a line, or immediately before the text it marks (matched case-insensitively)`
        : (entry?.visual ?? c.id);
    return `- id "${conventionKey(c)}": ${visual} => ${MEANING_TEXT[c.meaning]}.`;
  });
  return [
    "The user's REGISTERED INK CONVENTIONS (only these markups carry meaning; ignore markups not listed):",
    ...lines,
    "When a convention flags an item, set source_convention to its id. Plain lines with obvious task wording may still become tasks with source_convention null and lower confidence.",
  ].join("\n");
}

export function validateConventions(input: unknown): UserInkConventions {
  const ids = new Set(CONVENTION_CATALOG.map((c) => c.id));
  const meanings = new Set<ConventionMeaning>(["action", "follow_up", "priority", "schedule", "note"]);
  const active: ActiveConvention[] = [];
  const seen = new Set<string>();
  const raw = (input as { active?: unknown })?.active;
  if (!Array.isArray(raw)) throw new Error("conventions.active must be an array");
  for (const item of raw as Array<Record<string, unknown>>) {
    const id = item.id as ConventionId;
    const meaning = item.meaning as ConventionMeaning;
    if (!ids.has(id)) throw new Error(`unknown convention id ${String(item.id)}`);
    if (!meanings.has(meaning)) throw new Error(`unknown meaning ${String(item.meaning)}`);
    let entry: ActiveConvention;
    if (id === "keyword") {
      const keyword = String(item.keyword ?? "").trim();
      if (!keyword) throw new Error("a mark of your own needs a symbol or word");
      if (keyword.length > MAX_KEYWORD_LENGTH) throw new Error(`"${keyword.slice(0, 30)}" is too long to write on a page`);
      entry = { id, meaning, keyword };
    } else {
      entry = { id, meaning };
    }
    // Two rules for the same mark would make the prompt contradict itself, and the writer would
    // have no way to tell which one won. Keyword conventions are told apart by their keyword, so
    // several can be active at once — which is the whole point of them being repeatable.
    const key = conventionKey(entry);
    if (seen.has(key)) throw new Error(`"${id === "keyword" ? entry.keyword : id}" is listed twice with different meanings`);
    seen.add(key);
    active.push(entry);
  }
  return { active };
}
