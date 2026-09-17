/**
 * Word search. Deterministic, no API, and the solution page is the same grid with the placements
 * marked — so the two pages are generated together and cannot disagree.
 *
 * Words come from the customer's own interests where they have given any, which is what makes it
 * theirs rather than generic. A topic like "broadband" or "cardiology" yields its own vocabulary;
 * with nothing to go on there is a general list.
 */
import { rng, shuffle } from "./schedule.js";

export interface Placement {
  word: string;
  /** Zero-based grid coordinates of the first letter. */
  row: number;
  col: number;
  dRow: number;
  dCol: number;
}

export interface WordSearch {
  size: number;
  grid: string[][];
  placed: Placement[];
  /** Words that would not fit. Reported rather than hidden, so a thin puzzle is visible. */
  skipped: string[];
}

/** Eight directions, including backwards and both diagonals — a word search is not a word list. */
const DIRECTIONS: ReadonlyArray<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [-1, 1],
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Letters and nothing else: a grid cell holds one character, so spaces and punctuation cannot go in. */
export function normalizeWord(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

export interface WordSearchOptions {
  size?: number;
  /** Most words to place. More than this and the grid is letters with no space between answers. */
  maxWords?: number;
  minLength?: number;
}

export function generateWordSearch(words: readonly string[], seed: number, options: WordSearchOptions = {}): WordSearch {
  const size = options.size ?? 15;
  const maxWords = options.maxWords ?? 14;
  const minLength = options.minLength ?? 4;
  const next = rng(seed);

  // Longest first: a long word placed into an empty grid is easy, and placed last is often
  // impossible. Deduplicated, because the same word twice is one answer and two frustrations.
  const candidates = [...new Set(words.map(normalizeWord).filter((w) => w.length >= minLength && w.length <= size))]
    .sort((a, b) => b.length - a.length)
    .slice(0, maxWords);

  const grid: (string | null)[][] = Array.from({ length: size }, () => new Array<string | null>(size).fill(null));
  const placed: Placement[] = [];
  const skipped: string[] = [];

  for (const word of candidates) {
    let done = false;
    // Try every direction from every square, in a seeded order, and take the first that fits.
    for (const [dRow, dCol] of shuffle(DIRECTIONS, next)) {
      const starts = shuffle(
        Array.from({ length: size * size }, (_, k) => k),
        next,
      );
      for (const start of starts) {
        const row = Math.floor(start / size);
        const col = start % size;
        if (!fits(grid, word, row, col, dRow, dCol, size)) continue;
        for (let i = 0; i < word.length; i++) grid[row + dRow * i]![col + dCol * i] = word[i]!;
        placed.push({ word, row, col, dRow, dCol });
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) skipped.push(word);
  }

  // Fill the rest. Seeded, so the same day always produces the same grid.
  const filled = grid.map((row) => row.map((cell) => cell ?? ALPHABET[Math.floor(next() * 26)]!));
  return { size, grid: filled, placed, skipped };
}

function fits(
  grid: ReadonlyArray<ReadonlyArray<string | null>>,
  word: string,
  row: number,
  col: number,
  dRow: number,
  dCol: number,
  size: number,
): boolean {
  const endRow = row + dRow * (word.length - 1);
  const endCol = col + dCol * (word.length - 1);
  if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) return false;
  for (let i = 0; i < word.length; i++) {
    const existing = grid[row + dRow * i]![col + dCol * i];
    // Crossing another word is fine, and good — but only where the letters agree.
    if (existing !== null && existing !== word[i]) return false;
  }
  return true;
}

/** Every cell a placed word occupies, for drawing the solution page. */
export function solutionCells(ws: WordSearch): Set<string> {
  const out = new Set<string>();
  for (const p of ws.placed) {
    for (let i = 0; i < p.word.length; i++) out.add(`${p.row + p.dRow * i},${p.col + p.dCol * i}`);
  }
  return out;
}

/**
 * A general list for an account that has told us nothing about itself. Deliberately plain words:
 * the puzzle should be solvable on a train, not a vocabulary exam.
 */
export const GENERAL_WORDS: readonly string[] = [
  "MORNING", "COFFEE", "NOTEBOOK", "PENCIL", "MARGIN", "CALENDAR", "MEETING", "PROJECT",
  "DEADLINE", "REMINDER", "SUMMARY", "OUTLINE", "AGENDA", "FOLDER", "ARCHIVE", "SIGNAL",
  "PATTERN", "ROUTINE", "PROGRESS", "BALANCE", "QUESTION", "DECISION", "PURPOSE", "CLARITY",
];
