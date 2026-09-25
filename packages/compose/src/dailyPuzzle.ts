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
import { BODY_BOTTOM, CONTENT_W, CONTENT_X, newDocument } from "./canvas.js";
import type { ComposedDocument } from "./planner.js";
import { MAIN_X, Section, generatedStamp, type ComposeContext } from "./section.js";

export interface SudokuPuzzleInput {
  kind: "sudoku";
  /** 81 cells, row-major. 0 is empty. */
  puzzle: number[];
  solution: number[];
  difficulty: string;
}

/** Where one word sits in the grid: a start square and a step, which is a line on the page. */
export interface WordSearchPlacement {
  word: string;
  row: number;
  col: number;
  dRow: number;
  dCol: number;
}

export interface WordSearchPuzzleInput {
  kind: "word_search";
  size: number;
  grid: string[][];
  words: string[];
  /**
   * Where each answer runs, not merely which squares it touches.
   *
   * The answer key used to shade the cells of found words, and shading is the wrong instrument: the
   * e-ink shade is #F1EFE7 against #FBFBF9 paper, a difference of four values that a reMarkable
   * screen does not resolve at all. The key looked identical to the puzzle. A loop round each answer
   * is what a word search answer key has always done, and it needs the direction, not just the set of
   * squares.
   */
  placements: WordSearchPlacement[];
}

export interface CrosswordClue {
  number: number;
  clue: string;
  answer: string;
}

export interface CrosswordPuzzleInput {
  kind: "crossword";
  cols: number;
  rows: number;
  /** Letters, or null for a black square. grid[row][col]. */
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
  // A crossword takes three pages: grid, clues, solution. Everything else takes two.
  const cluePage = input.puzzle.kind === "crossword";
  const s = new Section(
    ctx,
    "PUZZLE",
    (p) => (p === 1 ? name : cluePage && p === 2 ? `${name} · clues` : `${name} · solution`),
    () => `PUZZLE · ${generatedStamp(ctx)}`,
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
    // Deliberately no label: the 54px it costs is 54px off every square, and the clues that would
    // have explained it are overleaf anyway. The header already says what this is.
    drawCrossword(s, input.puzzle, false);
  } else {
    s.label("Find every word", `${input.puzzle.words.length} TO FIND`);
    drawWordGrid(s, input.puzzle.grid, input.puzzle.size, null);
    drawWordList(s, input.puzzle.words);
  }

  // ---- page two, crossword only: the clues
  if (input.puzzle.kind === "crossword") {
    s.newPage();
    const total = input.puzzle.across.length + input.puzzle.down.length;
    s.label("Across and down", `${total} CLUE${total === 1 ? "" : "S"}`);
    drawClues(s, input.puzzle);
  }

  // ---- last page: the solution
  s.newPage();
  s.label("Solution");
  if (input.puzzle.kind === "sudoku") {
    drawSudoku(s, input.puzzle.solution, input.puzzle.puzzle);
  } else if (input.puzzle.kind === "crossword") {
    drawCrossword(s, input.puzzle, true);
  } else {
    drawWordGrid(s, input.puzzle.grid, input.puzzle.size, input.puzzle.placements);
    drawWordList(s, input.puzzle.words);
  }

  doc.setTitle(`Daily Puzzle ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}


/** One loop on the answer key: where it sits, how big, and which way it is turned. */
export interface WordLoop {
  cx: number;
  cy: number;
  /** Half-length along the word, including the overhang past the first and last letters. */
  a: number;
  /** Half-height across it. */
  b: number;
  /** Radians, in the page's frame — x right, y DOWN. */
  angle: number;
}

/**
 * The loops for an answer key, as geometry.
 *
 * Separated from the drawing so it can be checked: whether a loop is centred on its word and turned
 * to match is arithmetic, and arithmetic is testable, whereas "did a curve reach the PDF" is an
 * archaeology exercise against a compressed content stream.
 */
export function wordLoops(placements: readonly WordSearchPlacement[], left: number, top: number, cell: number): WordLoop[] {
  const centre = (row: number, col: number) => ({ x: left + (col + 0.5) * cell, y: top + (row + 0.5) * cell });
  return placements.map((p) => {
    const a0 = centre(p.row, p.col);
    const a1 = centre(p.row + p.dRow * (p.word.length - 1), p.col + p.dCol * (p.word.length - 1));
    const dx = a1.x - a0.x;
    const dy = a1.y - a0.y;
    return {
      cx: (a0.x + a1.x) / 2,
      cy: (a0.y + a1.y) / 2,
      a: Math.hypot(dx, dy) / 2 + cell * 0.42,
      b: cell * 0.42,
      // A one-letter word has no direction; atan2(0, 0) is 0, which draws a circle round it.
      angle: Math.atan2(dy, dx),
    };
  });
}

/**
 * The crossword grid, filling the page. A square with no letter is black — a crossword's black
 * squares are the shape of the puzzle, not absent content, so they are filled rather than left as
 * paper.
 *
 * The square is as large as the page allows, because the solver has to write a letter inside it by
 * hand. `cell` is fitted to BOTH dimensions: the page is portrait and the grids are taller than
 * they are wide, so which of the two binds depends on the day's shape, and taking only the width
 * would run Wednesday's 26 rows off the bottom.
 *
 * Nothing else goes on this page, which is why there is no `ensure` call to make and no clue list
 * to leave room for. The clues are overleaf.
 */
function drawCrossword(s: Section, cw: CrosswordPuzzleInput, solved: boolean): void {
  const availH = BODY_BOTTOM - s.y;
  const cell = Math.min(CONTENT_W / cw.cols, availH / cw.rows);
  const width = cell * cw.cols;
  const left = CONTENT_X + (CONTENT_W - width) / 2;
  const top = s.y;

  for (let r = 0; r < cw.rows; r++) {
    for (let c = 0; c < cw.cols; c++) {
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
        s.canvas.text(String(n), x + cell * 0.08, y + cell * 0.28, { font: s.canvas.fonts.mono, size: cell * 0.22, color: SECONDARY });
      }
      if (solved) {
        const size = cell * 0.5;
        const w = s.canvas.textWidth(letter, s.canvas.fonts.uiSemibold, size);
        s.canvas.text(letter, x + (cell - w) / 2, y + cell * 0.84, { font: s.canvas.fonts.uiSemibold, size, color: INK });
      }
    }
  }
  s.y = top + cell * cw.rows;
}

/** Across on the left, down on the right. No `ensure`: the clues have a page to themselves. */
function drawClues(s: Section, cw: CrosswordPuzzleInput): void {
  const colW = CONTENT_W / 2 - 20;
  const top = s.y;
  const columns: Array<[string, CrosswordClue[]]> = [
    ["ACROSS", cw.across],
    ["DOWN", cw.down],
  ];
  // The line height is fitted to the longer list rather than fixed at a comfortable 34px. Fifty
  // clues divide roughly evenly and fit at 34; an unlucky grid that puts forty of them in one
  // direction would not, and a clue that runs off the bottom of the page is a clue the solver
  // cannot answer. The type shrinks with the line so it never crowds the line below.
  const longest = Math.max(cw.across.length, cw.down.length, 1);
  const lineH = Math.min(34, (BODY_BOTTOM - top - 30) / (longest + 1));
  const fontSize = Math.min(26, lineH * 0.76);
  const numberSize = Math.min(24, lineH * 0.7);
  const gutter = numberSize * 1.9;

  let deepest = 0;
  columns.forEach(([heading, clues], i) => {
    const x = MAIN_X + i * (colW + 40);
    s.canvas.text(heading, x, top + 22, { font: s.canvas.fonts.mono, size: 22, color: SECONDARY, tracking: 0.16 });
    clues.forEach((clue, j) => {
      const y = top + 22 + (j + 1) * lineH;
      s.canvas.text(String(clue.number), x, y, { font: s.canvas.fonts.mono, size: numberSize, color: SECONDARY });
      s.canvas.text(s.canvas.fit(clue.clue, s.canvas.fonts.ui, fontSize, colW - gutter - 6), x + gutter, y, { font: s.canvas.fonts.ui, size: fontSize, color: INK });
    });
    deepest = Math.max(deepest, 22 + (clues.length + 1) * lineH);
  });
  s.y = top + deepest + 10;
}

/**
 * `givens` marks which cells were printed on the puzzle page. On the solution those digits are set in
 * grey and the solved ones in ink, so the answer reads as the answer rather than as a second,
 * identical-looking puzzle.
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
        // On the answer key the digits the solver had to WORK OUT are the ones worth seeing, so the
        // givens step back to grey. The shading behind them says the same thing, but #F1EFE7 against
        // #FBFBF9 paper is four values apart and a reMarkable does not resolve it — the same reason
        // the word search key needed loops rather than shaded cells.
        s.canvas.text(text, x + (cell - w) / 2, y + cell * 0.72, {
          font: s.canvas.fonts.uiSemibold,
          size: fontSize,
          color: isGiven ? SECONDARY : INK,
        });
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

/**
 * The grid, and on the answer key a loop round every word.
 *
 * `placements` null means the puzzle page: letters only, nothing marked. Given placements this is the
 * answer key, and each word gets an ellipse drawn round it at whatever angle it runs — the eight
 * directions include both diagonals and backwards, so the loops are not all horizontal.
 */
function drawWordGrid(s: Section, grid: string[][], size: number, placements: WordSearchPlacement[] | null): void {
  // Smaller than the sudoku's grid on purpose: this page also carries the word list, and two
  // pages is the whole contract of this document.
  const width = Math.min(CONTENT_W, 980);
  const cell = width / size;
  const left = CONTENT_X + (CONTENT_W - width) / 2;
  const top = s.y + 40;
  s.ensure(width + 120);

  // Every square in an answer, so a letter that is part of one reads as ink and the filler does not.
  const inAnswer = new Set<string>();
  for (const p of placements ?? []) {
    for (let i = 0; i < p.word.length; i++) inAnswer.add(`${p.row + p.dRow * i},${p.col + p.dCol * i}`);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = left + c * cell;
      const y = top + r * cell;
      const letter = grid[r]![c]!;
      const fontSize = cell * 0.52;
      const w = s.canvas.textWidth(letter, s.canvas.fonts.uiSemibold, fontSize);
      s.canvas.text(letter, x + (cell - w) / 2, y + cell * 0.7, {
        font: s.canvas.fonts.uiSemibold,
        size: fontSize,
        color: inAnswer.has(`${r},${c}`) ? INK : SECONDARY,
      });
    }
  }

  // Loops last, over the letters, so a line never has a letter sitting on top of it.
  for (const loop of wordLoops(placements ?? [], left, top, cell)) {
    s.canvas.oval(loop.cx, loop.cy, loop.a, loop.b, loop.angle, { stroke: INK, thickness: 4 });
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
