/**
 * Crossword layout, and the prompt that supplies its words.
 *
 * The division of labour here is the point. A model is good at "give me twenty words about
 * broadband with a clue each" and demonstrably bad at drawing a grid: a hand-generated 5x5 tried
 * during this feature's design failed its own validator on two of ten runs, and looked fine. So the
 * model supplies words and clues, and this file — deterministic, seeded, pure — places them.
 *
 * The grid is correct BY CONSTRUCTION, which matters more than validating afterwards. `canPlace`
 * refuses any placement that would create a run of letters that is not a word we placed: a word
 * laid alongside another would make vertical two-letter runs out of the pair, and those are exactly
 * the "words" a solver finds and we cannot clue. `validateCrossword` then checks the finished grid
 * the same way the hand-generated attempt was checked, as a belt on top of the braces.
 */
import { rng, shuffle } from "./schedule.js";

export interface CrosswordWord {
  answer: string;
  clue: string;
}

export type Direction = "across" | "down";

export interface PlacedWord {
  answer: string;
  clue: string;
  row: number;
  col: number;
  direction: Direction;
  /** Clue number, assigned after placement in reading order. */
  number: number;
}

export interface Crossword {
  size: number;
  /** Letters, or null for a black square. */
  grid: (string | null)[][];
  placed: PlacedWord[];
  /** Words that would not fit anywhere legal. Reported, never hidden. */
  skipped: string[];
}

/** Grid side. Big enough for a dozen interlocking words, small enough to read on a tablet page. */
export const GRID = 15;
/** Most words placed. Beyond this the clue lists stop fitting beside the grid. */
export const MAX_PLACED = 14;
/** A two-letter answer is not a crossword answer. */
export const MIN_LENGTH = 3;

export function normalizeAnswer(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

/**
 * Can `word` sit at (row, col) going `direction` without inventing a word?
 *
 * Three conditions, and the third is the one that is easy to miss: a cell we fill must not sit
 * beside an existing letter in the PERPENDICULAR direction unless this is a crossing, because that
 * pair would read as a two-letter word nobody wrote a clue for.
 */
export function canPlace(
  grid: ReadonlyArray<ReadonlyArray<string | null>>,
  word: string,
  row: number,
  col: number,
  direction: Direction,
  size = GRID,
): boolean {
  const dRow = direction === "down" ? 1 : 0;
  const dCol = direction === "across" ? 1 : 0;
  const endRow = row + dRow * (word.length - 1);
  const endCol = col + dCol * (word.length - 1);
  if (row < 0 || col < 0 || endRow >= size || endCol >= size) return false;

  // The squares immediately before and after must be empty, or the answer runs into its neighbour.
  const beforeRow = row - dRow;
  const beforeCol = col - dCol;
  if (beforeRow >= 0 && beforeCol >= 0 && grid[beforeRow]![beforeCol] !== null) return false;
  const afterRow = endRow + dRow;
  const afterCol = endCol + dCol;
  if (afterRow < size && afterCol < size && grid[afterRow]![afterCol] !== null) return false;

  let crossings = 0;
  for (let i = 0; i < word.length; i++) {
    const r = row + dRow * i;
    const c = col + dCol * i;
    const existing = grid[r]![c];
    if (existing !== null) {
      if (existing !== word[i]) return false; // conflicting letter
      crossings++;
      continue;
    }
    // Empty square: its perpendicular neighbours must be empty too, or we create a run.
    const sideA = direction === "across" ? [r - 1, c] : [r, c - 1];
    const sideB = direction === "across" ? [r + 1, c] : [r, c + 1];
    for (const [sr, sc] of [sideA, sideB]) {
      if (sr! >= 0 && sc! >= 0 && sr! < size && sc! < size && grid[sr!]![sc!] !== null) return false;
    }
  }
  // Every word after the first must interlock. A crossword is not a list of words on a page.
  return crossings > 0 || isEmpty(grid);
}

function isEmpty(grid: ReadonlyArray<ReadonlyArray<string | null>>): boolean {
  return grid.every((row) => row.every((cell) => cell === null));
}

/**
 * Greedy placement, longest word first, best crossing count wins.
 *
 * Longest first because a long word is easy to place into an empty grid and often impossible to
 * place last. Most crossings wins because a densely interlocked grid is a better puzzle — and
 * because a word hanging off a single letter is the one a solver cannot get a foothold on.
 */
export function buildCrossword(words: readonly CrosswordWord[], seed: number, size = GRID): Crossword {
  const next = rng(seed);
  const seen = new Set<string>();
  const candidates: CrosswordWord[] = [];
  for (const w of words) {
    const answer = normalizeAnswer(w.answer);
    const clue = w.clue.trim();
    if (answer.length < MIN_LENGTH || answer.length > size || !clue || seen.has(answer)) continue;
    seen.add(answer);
    candidates.push({ answer, clue });
  }
  candidates.sort((a, b) => b.answer.length - a.answer.length);

  const grid: (string | null)[][] = Array.from({ length: size }, () => new Array<string | null>(size).fill(null));
  const placed: Omit<PlacedWord, "number">[] = [];
  const skipped: string[] = [];

  for (const candidate of candidates) {
    if (placed.length >= MAX_PLACED) {
      skipped.push(candidate.answer);
      continue;
    }
    const spot = bestSpot(grid, candidate.answer, size, next, placed.length === 0);
    if (!spot) {
      skipped.push(candidate.answer);
      continue;
    }
    const dRow = spot.direction === "down" ? 1 : 0;
    const dCol = spot.direction === "across" ? 1 : 0;
    for (let i = 0; i < candidate.answer.length; i++) {
      grid[spot.row + dRow * i]![spot.col + dCol * i] = candidate.answer[i]!;
    }
    placed.push({ ...candidate, row: spot.row, col: spot.col, direction: spot.direction });
  }

  return { size, grid, placed: numberWords(placed), skipped };
}

interface Spot {
  row: number;
  col: number;
  direction: Direction;
  crossings: number;
}

function bestSpot(
  grid: ReadonlyArray<ReadonlyArray<string | null>>,
  word: string,
  size: number,
  next: () => number,
  first: boolean,
): Spot | null {
  if (first) {
    // Centre the first word, so the grid grows outward rather than off one edge.
    const row = Math.floor(size / 2);
    const col = Math.max(0, Math.floor((size - word.length) / 2));
    return { row, col, direction: "across", crossings: 0 };
  }
  const spots: Spot[] = [];
  for (const direction of ["across", "down"] as const) {
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (!canPlace(grid, word, row, col, direction, size)) continue;
        spots.push({ row, col, direction, crossings: countCrossings(grid, word, row, col, direction) });
      }
    }
  }
  if (spots.length === 0) return null;
  const most = Math.max(...spots.map((s) => s.crossings));
  // Shuffled among equally good spots, seeded — so the same day always draws the same grid.
  return shuffle(spots.filter((s) => s.crossings === most), next)[0]!;
}

function countCrossings(
  grid: ReadonlyArray<ReadonlyArray<string | null>>,
  word: string,
  row: number,
  col: number,
  direction: Direction,
): number {
  const dRow = direction === "down" ? 1 : 0;
  const dCol = direction === "across" ? 1 : 0;
  let n = 0;
  for (let i = 0; i < word.length; i++) if (grid[row + dRow * i]![col + dCol * i] !== null) n++;
  return n;
}

/** Standard numbering: reading order, one number per square that starts an answer. */
export function numberWords(placed: ReadonlyArray<Omit<PlacedWord, "number">>): PlacedWord[] {
  const starts = new Map<string, number>();
  const ordered = [...placed].sort((a, b) => a.row - b.row || a.col - b.col);
  let n = 0;
  for (const w of ordered) {
    const key = `${w.row},${w.col}`;
    if (!starts.has(key)) starts.set(key, ++n);
  }
  return placed.map((w) => ({ ...w, number: starts.get(`${w.row},${w.col}`)! }));
}

export interface ValidationResult {
  ok: boolean;
  /** Runs of two or more letters in the grid that are not one of the placed answers. */
  unclued: Array<{ direction: Direction; row: number; col: number; word: string }>;
}

/**
 * Every run of two or more letters must be an answer we have a clue for.
 *
 * This is the check a hand-generated grid failed during design, and it is cheap, so it runs on
 * every generated puzzle rather than only in tests.
 */
export function validateCrossword(cw: Crossword): ValidationResult {
  const answers = new Set(cw.placed.map((p) => p.answer));
  const unclued: ValidationResult["unclued"] = [];
  const scan = (direction: Direction): void => {
    for (let a = 0; a < cw.size; a++) {
      let run = "";
      let startB = 0;
      for (let b = 0; b <= cw.size; b++) {
        const cell = b < cw.size ? (direction === "across" ? cw.grid[a]![b] : cw.grid[b]![a]) : null;
        if (cell === null) {
          if (run.length > 1 && !answers.has(run)) {
            unclued.push(direction === "across" ? { direction, row: a, col: startB, word: run } : { direction, row: startB, col: a, word: run });
          }
          run = "";
          startB = b + 1;
        } else {
          run += cell;
        }
      }
    }
  };
  scan("across");
  scan("down");
  return { ok: unclued.length === 0, unclued };
}

/** Clues grouped the way they are printed. */
export function cluesByDirection(cw: Crossword): { across: PlacedWord[]; down: PlacedWord[] } {
  const by = (d: Direction) => cw.placed.filter((p) => p.direction === d).sort((a, b) => a.number - b.number);
  return { across: by("across"), down: by("down") };
}

// ---------------------------------------------------------------- the words, from a model

/** How many to ask for. Far more than fit, because most will not place. */
export const ASK_FOR_WORDS = 28;
/** Below this many placed, the puzzle is too thin to print and the day falls back. */
export const MIN_PLACED = 8;

export const CROSSWORD_SYSTEM = `You supply the words and clues for a small crossword that will be printed on an e-ink tablet.

You do NOT draw the grid. Grid layout is done afterwards by a program, and it needs many more words than it will use.

Return ONLY a JSON object, no prose and no code fences:
{"words":[{"answer":"<letters only, 3 to 12 characters>","clue":"<one line>"}]}

Rules:
1. Exactly ${ASK_FOR_WORDS} entries.
2. Answers are single words or a run-together phrase, letters only — no spaces, digits, hyphens or punctuation. UPPERCASE.
3. Spread the lengths: roughly a third of 3-5 letters, a third of 6-8, a third of 9-12. Short words are what let a grid interlock, and a list of only long words lays out badly.
4. Use common letters where you can. An answer full of J, Q, X and Z crosses nothing.
5. One clue per answer, under 80 characters, no leading "clue:" or numbering. A clue must not contain its own answer.
6. Mix the user's topics with general knowledge, roughly half and half, so the puzzle is solvable by someone having a bad morning.
7. Never use a proper noun the solver could not reasonably know, and never anything cruel about a real person.`;

export function parseCrosswordWords(text: string): { words: CrosswordWord[]; error: string | null } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { words: [], error: "no JSON in reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return { words: [], error: `JSON parse failed: ${(err as Error).message}` };
  }
  const list = (raw as { words?: unknown }).words;
  if (!Array.isArray(list)) return { words: [], error: "reply has no words array" };
  const words: CrosswordWord[] = [];
  for (const w of list as Array<Record<string, unknown>>) {
    const answer = normalizeAnswer(String(w.answer ?? ""));
    const clue = String(w.clue ?? "").trim().slice(0, 120);
    if (answer.length < MIN_LENGTH || !clue) continue;
    // A clue containing its own answer is not a clue. The model is told; this enforces it.
    if (clue.toUpperCase().includes(answer)) continue;
    words.push({ answer, clue });
  }
  if (words.length === 0) return { words: [], error: "no usable words in reply" };
  return { words, error: null };
}
