/**
 * Which puzzle lands on which day, and the seeded randomness that makes a day's puzzle stable.
 *
 * Both matter for rule 4: a run is keyed by (user, local-date) and re-running it must produce the
 * same output, not a different one. A puzzle drawn from `Math.random()` would give the customer a
 * new grid every time a night was retried, and a solution page that no longer matched the puzzle
 * page already on their tablet.
 */

export type PuzzleKind = "crossword" | "word_search" | "sudoku";

/**
 * The week, as specified: crossword Monday, Wednesday and Friday; word search Tuesday; sudoku
 * Thursday; and the rotation continuing into the weekend, so Saturday takes the word search and
 * Sunday the sudoku. Indexed by the ISO weekday Luxon gives (1 = Monday).
 */
export const PUZZLE_WEEK: Record<number, PuzzleKind> = {
  1: "crossword",
  2: "word_search",
  3: "crossword",
  4: "sudoku",
  5: "crossword",
  6: "word_search",
  7: "sudoku",
};

/** Kinds that can actually be generated today. Crossword needs a layout engine and is not built. */
export const IMPLEMENTED: readonly PuzzleKind[] = ["word_search", "sudoku"];

/**
 * What to print for a local date.
 *
 * `fallback` says the day's kind is not available yet, so something else was substituted. It
 * alternates rather than always picking one, so the crossword days do not all become word
 * searches — a week of Monday, Wednesday and Friday word searches would be worse than the
 * rotation it stands in for.
 */
export interface PuzzleChoice {
  kind: PuzzleKind;
  /** The kind the calendar asked for, when it differs from what is being printed. */
  insteadOf: PuzzleKind | null;
}

export function puzzleFor(localDate: string, implemented: readonly PuzzleKind[] = IMPLEMENTED): PuzzleChoice {
  const asked = PUZZLE_WEEK[isoWeekday(localDate)] ?? "sudoku";
  if (implemented.includes(asked)) return { kind: asked, insteadOf: null };
  const stand = implemented.length ? implemented[weekOfYear(localDate) % implemented.length]! : asked;
  return { kind: stand, insteadOf: asked };
}

/** ISO weekday for a YYYY-MM-DD date, 1 = Monday .. 7 = Sunday. No timezone: the date IS the day. */
export function isoWeekday(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** Weeks since the epoch. Only used to alternate the stand-in, so any stable counter would do. */
export function weekOfYear(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / (7 * 86_400_000));
}

/**
 * A small deterministic generator. Mulberry32: thirty-two bits of state, good enough for shuffling
 * a word list and laying out a grid, and — the point — identical on every machine and every rerun
 * for the same seed.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed from the things that should decide a puzzle: who it is for, and which day. */
export function seedFor(userId: string, localDate: string, kind: PuzzleKind): number {
  let h = 2166136261;
  for (const ch of `${userId}|${localDate}|${kind}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fisher-Yates against a seeded generator, so a shuffle is reproducible. */
export function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
