/**
 * The Daily Puzzle notebook: page one the puzzle, page two its solution.
 *
 * Exactly two pages, always, because the solution must be a page turn away rather than something
 * to hunt for — and because a customer who wants to avoid the answer needs to know it is on page
 * two and nowhere else.
 *
 * Grids are drawn rather than typeset: an e-ink page is monochrome, and a letter or digit in the
 * middle of a cell is the whole design.
 */
import { INK, RULE, SECONDARY, SHADE } from "./brand.js";
import { CONTENT_W, CONTENT_X, newDocument } from "./canvas.js";
import type { ComposedDocument } from "./planner.js";
import { MAIN_X, Section, generatedStamp, type ComposeContext } from "./section.js";

export interface SudokuPuzzleInput {
  kind: "sudoku";
  /** 81 cells, row-major. 0 is empty. */
  puzzle: number[];
  solution: number[];
  difficulty: string;
}

export interface WordSearchPuzzleInput {
  kind: "word_search";
  size: number;
  grid: string[][];
  words: string[];
  /** "row,col" of every cell a placed word occupies. */
  solutionCells: Set<string>;
}

export interface CrosswordClue {
  number: number;
  clue: string;
  answer: string;
}

export interface CrosswordPuzzleInput {
  kind: "crossword";
  size: number;
  /** Letters, or null for a black square. */
  grid: (string | null)[][];
  /** "row,col" -> the number printed in that square's corner. */
  numbers: Map<string, number>;
  across: CrosswordClue[];
  down: CrosswordClue[];
}

export type PuzzleInput = SudokuPuzzleInput | WordSearchPuzzleInput | CrosswordPuzzleInput;

export interface DailyPuzzleInput {
  puzzle: PuzzleInput;
  date: string;
  generatedAt: string;
  runLabel: string;
  /** The kind the calendar asked for, when something else is printed in its place. */
  insteadOf?: string | null;
}

const TITLE: Record<PuzzleInput["kind"], string> = { sudoku: "Sudoku", word_search: "Word Search", crossword: "Crossword" };

export async function composeDailyPuzzle(input: DailyPuzzleInput): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: input.date, generatedAt: input.generatedAt, runLabel: input.runLabel, printed: [] };
  const name = TITLE[input.puzzle.kind];
  const s = new Section(
    ctx,
    "PUZZLE",
    (p) => (p === 1 ? name : `${name} · solution`),
    () => `dayMarkable PUZZLE · ${generatedStamp(ctx)}`,
  );

  // ---- page one: the puzzle
  s.newPage();
  if (input.insteadOf) {
    s.note(`Standing in for today's ${input.insteadOf.replace("_", " ")}.`);
    s.y += 8;
  }
  if (input.puzzle.kind === "sudoku") {
    s.label("Fill every row, column and box with 1 to 9", input.puzzle.difficulty.toUpperCase());
    drawSudoku(s, input.puzzle.puzzle, null);
  } else if (input.puzzle.kind === "crossword") {
    const total = input.puzzle.across.length + input.puzzle.down.length;
    s.label("Across and down", `${total} CLUE${total === 1 ? "" : "S"}`);
    drawCrossword(s, input.puzzle, false);
    drawClues(s, input.puzzle);
  } else {
    s.label("Find every word", `${input.puzzle.words.length} TO FIND`);
    drawWordGrid(s, input.puzzle.grid, input.puzzle.size, null);
    drawWordList(s, input.puzzle.words);
  }

  // ---- page two: the solution
  s.newPage();
  s.label("Solution");
  if (input.puzzle.kind === "sudoku") {
    drawSudoku(s, input.puzzle.solution, input.puzzle.puzzle);
  } else if (input.puzzle.kind === "crossword") {
    drawCrossword(s, input.puzzle, true);
  } else {
    drawWordGrid(s, input.puzzle.grid, input.puzzle.size, input.puzzle.solutionCells);
    drawWordList(s, input.puzzle.words);
  }

  doc.setTitle(`dayMarkable Daily Puzzle ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}


/**
 * The crossword grid. A square with no letter is black — a crossword's black squares are the shape
 * of the puzzle, not absent content, so they are filled rather than left as paper.
 *
 * Smaller than the sudoku's grid because the clue lists share the page with it, and two pages is
 * the whole contract of this document.
 */
function drawCrossword(s: Section, cw: CrosswordPuzzleInput, solved: boolean): void {
  const width = Math.min(CONTENT_W, 760);
  const cell = width / cw.size;
  const left = CONTENT_X + (CONTENT_W - width) / 2;
  const top = s.y + 30;

  for (let r = 0; r < cw.size; r++) {
    for (let c = 0; c < cw.size; c++) {
      const x = left + c * cell;
      const y = top + r * cell;
      // A cell off the end of a short row is a black square like any other: the grid is the
      // puzzle's shape, and absent content and a blocked square are the same thing here.
      const letter = cw.grid[r]![c] ?? null;
      if (letter === null) {
        s.canvas.rect(x, y, cell, cell, { fill: INK });
        continue;
      }
      s.canvas.rect(x, y, cell, cell, { stroke: INK, thickness: 2 });
      const n = cw.numbers.get(`${r},${c}`);
      if (n !== undefined) {
        s.canvas.text(String(n), x + cell * 0.1, y + cell * 0.32, { font: s.canvas.fonts.mono, size: cell * 0.26, color: SECONDARY });
      }
      if (solved) {
        const size = cell * 0.5;
        const w = s.canvas.textWidth(letter, s.canvas.fonts.uiSemibold, size);
        s.canvas.text(letter, x + (cell - w) / 2, y + cell * 0.82, { font: s.canvas.fonts.uiSemibold, size, color: INK });
      }
    }
  }
  s.y = top + width + 34;
}

/** Across on the left, down on the right. No `ensure`: this page is one page by contract. */
function drawClues(s: Section, cw: CrosswordPuzzleInput): void {
  const colW = CONTENT_W / 2 - 20;
  const top = s.y;
  const lineH = 34;
  const columns: Array<[string, CrosswordClue[]]> = [
    ["ACROSS", cw.across],
    ["DOWN", cw.down],
  ];
  let deepest = 0;
  columns.forEach(([heading, clues], i) => {
    const x = MAIN_X + i * (colW + 40);
    s.canvas.text(heading, x, top + 22, { font: s.canvas.fonts.mono, size: 22, color: SECONDARY, tracking: 0.16 });
    clues.forEach((clue, j) => {
      const y = top + 22 + (j + 1) * lineH;
      s.canvas.text(String(clue.number), x, y, { font: s.canvas.fonts.mono, size: 24, color: SECONDARY });
      s.canvas.text(s.canvas.fit(clue.clue, s.canvas.fonts.ui, 26, colW - 52), x + 46, y, { font: s.canvas.fonts.ui, size: 26, color: INK });
    });
    deepest = Math.max(deepest, 22 + (clues.length + 1) * lineH);
  });
  s.y = top + deepest + 10;
}

/**
 * `givens` marks which cells were printed on the puzzle page. On the solution they are shaded, so
 * the answer reads as the answer rather than as a second, different puzzle.
 */
function drawSudoku(s: Section, grid: number[], givens: number[] | null): void {
  const size = Math.min(CONTENT_W, 1100);
  const cell = size / 9;
  const left = CONTENT_X + (CONTENT_W - size) / 2;
  const top = s.y + 40;
  s.ensure(size + 120);

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const i = r * 9 + c;
      const x = left + c * cell;
      const y = top + r * cell;
      const isGiven = givens ? givens[i] !== 0 : false;
      s.canvas.rect(x, y, cell, cell, { ...(isGiven ? { fill: SHADE } : {}), stroke: RULE, thickness: 2 });
      const value = grid[i]!;
      if (value !== 0) {
        const text = String(value);
        const fontSize = cell * 0.55;
        const w = s.canvas.textWidth(text, s.canvas.fonts.uiSemibold, fontSize);
        s.canvas.text(text, x + (cell - w) / 2, y + cell * 0.72, { font: s.canvas.fonts.uiSemibold, size: fontSize, color: INK });
      }
    }
  }
  // The 3x3 boxes, drawn over the cell grid so the block structure reads at a glance.
  for (let b = 0; b <= 3; b++) {
    const t = 6;
    s.canvas.rect(left + b * cell * 3 - t / 2, top, t, size, { fill: INK });
    s.canvas.rect(left, top + b * cell * 3 - t / 2, size, t, { fill: INK });
  }
  s.y = top + size + 40;
}

function drawWordGrid(s: Section, grid: string[][], size: number, found: Set<string> | null): void {
  // Smaller than the sudoku's grid on purpose: this page also carries the word list, and two
  // pages is the whole contract of this document.
  const width = Math.min(CONTENT_W, 980);
  const cell = width / size;
  const left = CONTENT_X + (CONTENT_W - width) / 2;
  const top = s.y + 40;
  s.ensure(width + 120);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = left + c * cell;
      const y = top + r * cell;
      const inAnswer = found?.has(`${r},${c}`) ?? false;
      if (inAnswer) s.canvas.rect(x, y, cell, cell, { fill: SHADE });
      const letter = grid[r]![c]!;
      const fontSize = cell * 0.52;
      const w = s.canvas.textWidth(letter, s.canvas.fonts.uiSemibold, fontSize);
      s.canvas.text(letter, x + (cell - w) / 2, y + cell * 0.7, {
        font: s.canvas.fonts.uiSemibold,
        size: fontSize,
        color: inAnswer ? INK : SECONDARY,
      });
    }
  }
  s.y = top + width + 40;
}

/**
 * Four columns, and deliberately NOT calling `ensure`. Everything on this page is one page by
 * contract; asking for space here is asking for a third page, which is the bug a twelve-word
 * sample found after a six-word test passed.
 */
function drawWordList(s: Section, words: readonly string[]): void {
  const columns = 4;
  const colW = CONTENT_W / columns;
  const rows = Math.ceil(words.length / columns);
  const top = s.y;
  words.forEach((word, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    s.canvas.text(word, MAIN_X + col * colW, top + row * 40 + 28, {
      font: s.canvas.fonts.mono,
      size: 25,
      color: INK,
      tracking: 0.04,
    });
  });
  s.y = top + rows * 40 + 20;
}
