/**
 * Ink conventions are per-user config (CLAUDE.md rule 9). This is the ONE module that
 * knows what a markup can mean; it is injected into the extraction prompt. Nothing in
 * packages/core may hardcode a convention's meaning.
 */

export type ConventionMeaning = "action" | "follow_up" | "priority" | "schedule";

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
  { id: "keyword", label: "Keyword", visual: "a written keyword such as TODO or F/U at the start of a line", takesKeyword: true },
];

export interface ActiveConvention {
  id: ConventionId;
  meaning: ConventionMeaning;
  /** Required when id === "keyword". Matched case-insensitively. */
  keyword?: string;
}

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
        ? `the keyword "${(c.keyword ?? "").toUpperCase()}" written at the start of a line (case-insensitive)`
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
  const meanings = new Set<ConventionMeaning>(["action", "follow_up", "priority", "schedule"]);
  const active: ActiveConvention[] = [];
  const raw = (input as { active?: unknown })?.active;
  if (!Array.isArray(raw)) throw new Error("conventions.active must be an array");
  for (const item of raw as Array<Record<string, unknown>>) {
    const id = item.id as ConventionId;
    const meaning = item.meaning as ConventionMeaning;
    if (!ids.has(id)) throw new Error(`unknown convention id ${String(item.id)}`);
    if (!meanings.has(meaning)) throw new Error(`unknown meaning ${String(item.meaning)}`);
    if (id === "keyword") {
      const keyword = String(item.keyword ?? "").trim();
      if (!keyword) throw new Error("keyword convention needs a keyword");
      active.push({ id, meaning, keyword });
    } else {
      active.push({ id, meaning });
    }
  }
  return { active };
}
