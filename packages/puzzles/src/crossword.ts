/**
 * Crossword layout, and the prompt that supplies its words.
 *
 * The division of labour here is the point. A model is good at "give me fifty words with a clue
 * each" and demonstrably bad at drawing a grid: a hand-generated 5x5 tried during this feature's
 * design failed its own validator on two of ten runs, and looked fine. So the model supplies words
 * and clues, and this file — deterministic, seeded, pure — places them.
 *
 * The grid is correct BY CONSTRUCTION, which matters more than validating afterwards. `canPlace`
 * refuses any placement that would create a run of letters that is not a word we placed: a word
 * laid alongside another would make vertical two-letter runs out of the pair, and those are exactly
 * the "words" a solver finds and we cannot clue. `validateCrossword` then checks the finished grid
 * the same way the hand-generated attempt was checked, as a belt on top of the braces.
 *
 * That rule is also what sets the density ceiling, and the ceiling is worth knowing before asking
 * for more answers. A newspaper grid packs words tightly because parallel neighbours are legal
 * there — the runs between them are themselves clued answers. Here nothing may touch anything it
 * does not cross, so a finished grid fills 45-49% of its squares (measured, not assumed) and no
 * further. More answers therefore means more squares, and on a fixed page more squares means
 * smaller ones. See `CROSSWORD_SPECS` for where that trade was landed.
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

/**
 * Grid shape. Separate width and height because the page is portrait (1404x1872) and a square grid
 * throws the difference away — a taller grid is what buys answers without shrinking squares.
 */
export interface Dims {
  cols: number;
  rows: number;
}

export interface Crossword {
  cols: number;
  rows: number;
  /** Letters, or null for a black square. `grid[row][col]`: `rows` rows of `cols` columns. */
  grid: (string | null)[][];
  placed: PlacedWord[];
  /** Words that would not fit anywhere legal. Reported, never hidden. */
  skipped: string[];
}

/** A two-letter answer is not a crossword answer. */
export const MIN_LENGTH = 3;
/**
 * The longest answer worth having. The widest grid is 24 columns, so a longer word could in principle
 * go down — but it can only be placed one way, crosses awkwardly, and in practice a reply full of
 * 15-letter answers is a reply that has stopped following instructions. A real 130-word ask came back
 * with 1496 entries of which 108 were longer than this.
 */
export const MAX_LENGTH = 14;

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
  dims: Dims,
): boolean {
  const { cols, rows } = dims;
  const dRow = direction === "down" ? 1 : 0;
  const dCol = direction === "across" ? 1 : 0;
  const endRow = row + dRow * (word.length - 1);
  const endCol = col + dCol * (word.length - 1);
  if (row < 0 || col < 0 || endRow >= rows || endCol >= cols) return false;

  // The squares immediately before and after must be empty, or the answer runs into its neighbour.
  const beforeRow = row - dRow;
  const beforeCol = col - dCol;
  if (beforeRow >= 0 && beforeCol >= 0 && grid[beforeRow]![beforeCol] !== null) return false;
  const afterRow = endRow + dRow;
  const afterCol = endCol + dCol;
  if (afterRow < rows && afterCol < cols && grid[afterRow]![afterCol] !== null) return false;

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
      if (sr! >= 0 && sc! >= 0 && sr! < rows && sc! < cols && grid[sr!]![sc!] !== null) return false;
    }
  }
  // Every word after the first must interlock. A crossword is not a list of words on a page.
  return crossings > 0 || isEmpty(grid);
}

function isEmpty(grid: ReadonlyArray<ReadonlyArray<string | null>>): boolean {
  return grid.every((row) => row.every((cell) => cell === null));
}

export interface BuildOptions extends Dims {
  /** Stop after this many answers. A property of the day, not of the grid. */
  target: number;
}

/**
 * Greedy placement, longest word first, best crossing count wins.
 *
 * Longest first because a long word is easy to place into an empty grid and often impossible to
 * place last. Most crossings wins because a densely interlocked grid is a better puzzle — and
 * because a word hanging off a single letter is the one a solver cannot get a foothold on.
 */
export function buildCrossword(words: readonly CrosswordWord[], seed: number, options: BuildOptions): Crossword {
  const { cols, rows, target } = options;
  const dims: Dims = { cols, rows };
  const longest = Math.max(cols, rows);
  const next = rng(seed);
  const seen = new Set<string>();
  const candidates: CrosswordWord[] = [];
  for (const w of words) {
    const answer = normalizeAnswer(w.answer);
    const clue = w.clue.trim();
    if (answer.length < MIN_LENGTH || answer.length > longest || !clue || seen.has(answer)) continue;
    seen.add(answer);
    candidates.push({ answer, clue });
  }
  candidates.sort((a, b) => b.answer.length - a.answer.length);

  const grid: (string | null)[][] = Array.from({ length: rows }, () => new Array<string | null>(cols).fill(null));
  const placed: Omit<PlacedWord, "number">[] = [];
  const skipped: string[] = [];

  for (const candidate of candidates) {
    if (placed.length >= target) {
      skipped.push(candidate.answer);
      continue;
    }
    const spot = bestSpot(grid, candidate.answer, dims, next, placed.length === 0);
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

  return { cols, rows, grid, placed: numberWords(placed), skipped };
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
  dims: Dims,
  next: () => number,
  first: boolean,
): Spot | null {
  if (first) {
    // Centre the first word, so the grid grows outward rather than off one edge.
    const row = Math.floor(dims.rows / 2);
    const col = Math.max(0, Math.floor((dims.cols - word.length) / 2));
    return { row, col, direction: "across", crossings: 0 };
  }
  const spots: Spot[] = [];
  for (const direction of ["across", "down"] as const) {
    for (let row = 0; row < dims.rows; row++) {
      for (let col = 0; col < dims.cols; col++) {
        if (!canPlace(grid, word, row, col, direction, dims)) continue;
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
    // Across walks each row along the columns; down walks each column down the rows.
    const outer = direction === "across" ? cw.rows : cw.cols;
    const inner = direction === "across" ? cw.cols : cw.rows;
    for (let a = 0; a < outer; a++) {
      let run = "";
      let startB = 0;
      for (let b = 0; b <= inner; b++) {
        const cell = b < inner ? (direction === "across" ? cw.grid[a]![b] : cw.grid[b]![a]) : null;
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

/** How many squares of the grid hold a letter. The density figure the doc comment refers to. */
export function fillRatio(cw: Crossword): number {
  const filled = cw.grid.reduce((n, row) => n + row.filter((c) => c !== null).length, 0);
  return filled / (cw.cols * cw.rows);
}

// ---------------------------------------------------------------- the week

/** What a given crossword day prints: how many answers, in a grid of what shape. */
export interface CrosswordSpec extends BuildOptions {
  /** How many candidates to ask a model for. Far more than `target`; most will not place. */
  ask: number;
}

/**
 * Monday, Wednesday, Friday: 25, 35 and 50 answers, each in the SMALLEST grid that reliably holds
 * them. Smallest, because the grid is fitted to the page and `cell = min(1200/cols, 1484/rows)` —
 * so every column and row spent is square size given away, and square size is the room the solver
 * has to write a letter.
 *
 * Measured over 40 seeds each, against the 273-word pool in `generalKnowledge.ts` and again against
 * subsets the size a model is asked for:
 *
 *   25 answers  18x22  cell 66.7px  exact target 37/40, at least 80% 40/40
 *   35 answers  21x26  cell 57.1px  exact target 40/40
 *   50 answers  24x29  cell 50.0px  exact target 40/40
 *
 * No invalid grid in any of those runs. The generator fills 45-49% of its squares, which is what
 * sets these shapes; a newspaper grid packs tighter because parallel neighbours are legal there.
 *
 * Against the first version's 15x15 at 50.7px, Monday's squares are 32% wider and Wednesday's 13%.
 * Friday's are the same size — fifty interlocking answers need about 700 squares, and 700 squares on
 * a 1200px page cannot also be big ones. That is the real trade: the word count and the square size
 * pull against each other on a fixed page, and Friday is where they meet.
 */
export const CROSSWORD_SPECS: Record<number, CrosswordSpec> = {
  1: { target: 25, cols: 18, rows: 22, ask: 70 },
  3: { target: 35, cols: 21, rows: 26, ask: 95 },
  5: { target: 50, cols: 24, rows: 29, ask: 130 },
};

/** The spec for an ISO weekday, falling back to Monday's for a day that is not a crossword day. */
export function specFor(isoWeekday: number): CrosswordSpec {
  return CROSSWORD_SPECS[isoWeekday] ?? CROSSWORD_SPECS[1]!;
}

/**
 * Below this share of the target, the puzzle is too thin to print and the day falls back to a word
 * search. Four fifths rather than a fixed count: missing five of fifty is a full grid, missing five
 * of twenty-five is a visibly empty one.
 */
export const MIN_PLACED_RATIO = 0.8;

export function minPlaced(spec: CrosswordSpec): number {
  return Math.ceil(spec.target * MIN_PLACED_RATIO);
}

// ---------------------------------------------------------------- the words, from a model

/**
 * How many answers of each length to demand.
 *
 * Stated as exact counts rather than proportions because proportions did not work: asked for "about
 * half of 3-5 letters", a real reply came back with 92 words of which the layout could place only 13
 * of a 35-answer target. The length mix is not a stylistic preference — it decides whether a grid can
 * be built at all, since short words are what interlock. Weighted harder towards short than the
 * built-in pool (which is 44% short and lays out well) to leave room for the model to drift.
 */
export function lengthBands(ask: number): { short: number; mid: number; long: number } {
  const short = Math.round(ask * 0.6);
  const mid = Math.round(ask * 0.28);
  return { short, mid, long: Math.max(0, ask - short - mid) };
}

/**
 * Most answers to request in one call.
 *
 * Small on purpose. A single call asking for 130 answers is not reliable: one attempt returned 1496
 * entries, degenerating into short repetitions as it went, and the next produced 32,600 tokens with no
 * parseable JSON at all. Asks of 40 and under came back well-formed and close to the number requested
 * every time, so a big day is several small calls rather than one large one.
 */
export const BATCH_SIZE = 40;

/**
 * Subject hints, one per batch. They diversify the puzzle — four batches with the same prompt overlap
 * heavily and the duplicates are then thrown away, which wastes the call — and they keep each batch
 * inside a domain the clues can stay plain in.
 */
export const BATCH_THEMES: readonly string[] = [
  "nature, weather, plants, animals and the seasons",
  "food, cooking, drink and things found in a kitchen",
  "geography, landscape, water, travel and the sky",
  "the house, tools, clothes, materials and making things",
  "music, sport, games, reading and everyday pastimes",
  "plain English vocabulary: ordinary verbs, adjectives and objects",
];

export function crosswordSystem(ask: number, theme?: string): string {
  const { short, mid, long } = lengthBands(ask);
  return `You supply the words and clues for a general-knowledge crossword that will be printed on an e-ink tablet.

You do NOT draw the grid. Grid layout is done afterwards by a program, and it needs many more words than it will use.

Return ONLY a JSON object, no prose and no code fences, and nothing after the closing brace:
{"words":[{"answer":"<letters only, ${MIN_LENGTH} to ${MAX_LENGTH} characters>","clue":"<one line>"}]}

Rules:
1. ${ask} entries.
2. Answers are single words or a run-together phrase, letters only — no spaces, digits, hyphens or punctuation. UPPERCASE. Never shorter than ${MIN_LENGTH} letters or longer than ${MAX_LENGTH}.
3. Lengths, because short words are what let a grid interlock: about ${short} of 3 to 5 letters, ${mid} of 6 to 8, and ${long} of 9 to ${MAX_LENGTH}. A list weighted towards long answers lays out badly and leaves most of the page empty.
4. Use common letters where you can. An answer full of J, Q, X and Z crosses nothing.
5. One clue per answer, under 80 characters, no leading "clue:" or numbering. A clue must not contain its own answer.
6. General knowledge only, and the same puzzle goes to every subscriber: nothing that needs a particular country, profession, generation or subculture to solve.
7. Never use a proper noun the solver could not reasonably know, and never anything cruel about a real person.
8. No duplicate answers, and no two answers where one contains the other.${theme ? `\n9. Draw this set from ${theme}.` : ""}`;
}

/**
 * The first balanced JSON object in a reply.
 *
 * Not `indexOf("{")` to `lastIndexOf("}")`, which is what this was and which broke on a real reply:
 * the model returned the object and then a short note tallying the lengths it had used, so the slice
 * ran from the opening brace past the end of the object and failed to parse at character 11321.
 * Counting depth — and ignoring braces inside strings — takes the object and leaves whatever follows.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export interface ParsedWords {
  words: CrosswordWord[];
  error: string | null;
  /** How many entries the reply offered, before any were rejected. */
  offered?: number;
  /** How many were thrown away: wrong length, duplicate, or a clue containing its answer. */
  rejected?: number;
}

/** `limit` is the day's `ask`; entries beyond twice that are dropped. Omit it to keep everything. */
export function parseCrosswordWords(text: string, limit?: number): ParsedWords {
  const json = firstJsonObject(text);
  if (json === null) return { words: [], error: "no JSON in reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return { words: [], error: `JSON parse failed: ${(err as Error).message}` };
  }
  const list = (raw as { words?: unknown }).words;
  if (!Array.isArray(list)) return { words: [], error: "reply has no words array" };
  // A ceiling on what is kept, because a reply is not always the length it was asked for: one real
  // 130-word ask returned 1496 entries, degenerating as it went. The layout only ever needs a few
  // times the target, and keeping the rest would bloat the stored row for no gain.
  const cap = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(limit * 2, 40);
  const words: CrosswordWord[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const w of list as Array<Record<string, unknown>>) {
    if (words.length >= cap) break;
    const answer = normalizeAnswer(String(w.answer ?? ""));
    const clue = String(w.clue ?? "").trim().slice(0, 120);
    if (answer.length < MIN_LENGTH || answer.length > MAX_LENGTH || !clue) {
      rejected++;
      continue;
    }
    // A clue containing its own answer is not a clue. The model is told; this enforces it.
    if (clue.toUpperCase().includes(answer)) {
      rejected++;
      continue;
    }
    if (seen.has(answer)) {
      rejected++;
      continue;
    }
    seen.add(answer);
    words.push({ answer, clue });
  }
  if (words.length === 0) return { words: [], error: "no usable words in reply" };
  return { words, error: null, offered: list.length, rejected };
}
