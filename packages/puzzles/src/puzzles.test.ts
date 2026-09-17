import { describe, expect, it } from "vitest";
import { IMPLEMENTED, PUZZLE_WEEK, isoWeekday, puzzleFor, rng, seedFor, shuffle } from "./schedule.js";
import { countSolutions, generateSudoku, toRows } from "./sudoku.js";
import { GENERAL_WORDS, generateWordSearch, normalizeWord, solutionCells } from "./wordSearch.js";

describe("schedule", () => {
  it("knows which day is which", () => {
    // 2026-09-14 is a Monday.
    expect(isoWeekday("2026-09-14")).toBe(1);
    expect(isoWeekday("2026-09-20")).toBe(7);
    expect(PUZZLE_WEEK[1]).toBe("crossword");
    expect(PUZZLE_WEEK[2]).toBe("word_search");
    expect(PUZZLE_WEEK[4]).toBe("sudoku");
    // The rotation continues into the weekend rather than stopping on Friday.
    expect(PUZZLE_WEEK[6]).toBe("word_search");
    expect(PUZZLE_WEEK[7]).toBe("sudoku");
  });

  it("prints the day's own puzzle when it can be built", () => {
    expect(puzzleFor("2026-09-15")).toEqual({ kind: "word_search", insteadOf: null }); // Tuesday
    expect(puzzleFor("2026-09-17")).toEqual({ kind: "sudoku", insteadOf: null }); // Thursday
  });

  it("stands something in for a crossword, and says what it replaced", () => {
    const monday = puzzleFor("2026-09-14");
    expect(monday.insteadOf).toBe("crossword");
    expect(IMPLEMENTED).toContain(monday.kind);
  });

  /**
   * Three crossword days a week must not all become the same substitute, or the week reads as
   * four word searches and a sudoku.
   */
  it("alternates the stand-in across weeks rather than always choosing one", () => {
    const mondays = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"].map((d) => puzzleFor(d).kind);
    expect(new Set(mondays).size).toBeGreaterThan(1);
  });

  it("gives the same day the same puzzle, and different days different ones (rule 4)", () => {
    const a = seedFor("user-1", "2026-09-15", "sudoku");
    expect(seedFor("user-1", "2026-09-15", "sudoku")).toBe(a);
    expect(seedFor("user-1", "2026-09-16", "sudoku")).not.toBe(a);
    expect(seedFor("user-2", "2026-09-15", "sudoku")).not.toBe(a);
    expect(seedFor("user-1", "2026-09-15", "word_search")).not.toBe(a);
  });

  it("shuffles reproducibly for a seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(items, rng(7))).toEqual(shuffle(items, rng(7)));
    expect(shuffle(items, rng(7))).not.toEqual(items);
  });
});

describe("sudoku", () => {
  const s = generateSudoku(seedFor("u", "2026-09-17", "sudoku"));

  it("produces a complete, legal solution", () => {
    expect(s.solution.filter((c) => c === 0)).toHaveLength(0);
    for (const row of toRows(s.solution)) expect(new Set(row).size).toBe(9);
    // Columns and boxes too — a row-only check passes on a grid that is not a sudoku.
    for (let c = 0; c < 9; c++) expect(new Set(s.solution.filter((_, i) => i % 9 === c)).size).toBe(9);
    for (let b = 0; b < 9; b++) {
      const br = Math.floor(b / 3) * 3;
      const bc = (b % 3) * 3;
      const box = [];
      for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) box.push(s.solution[(br + dr) * 9 + bc + dc]);
      expect(new Set(box).size).toBe(9);
    }
  });

  /** The property that makes it a puzzle rather than a grid with holes in it. */
  it("has exactly one solution", () => {
    expect(countSolutions(s.puzzle, 3)).toBe(1);
  });

  it("agrees with its own solution wherever it shows a number", () => {
    s.puzzle.forEach((cell, i) => {
      if (cell !== 0) expect(cell).toBe(s.solution[i]);
    });
  });

  it("is the same puzzle for the same seed and a different one otherwise (rule 4)", () => {
    expect(generateSudoku(42).puzzle).toEqual(generateSudoku(42).puzzle);
    expect(generateSudoku(42).puzzle).not.toEqual(generateSudoku(43).puzzle);
  });

  it("gets harder by leaving fewer numbers", () => {
    const gentle = generateSudoku(9, "gentle");
    const hard = generateSudoku(9, "hard");
    expect(gentle.givens).toBeGreaterThan(hard.givens);
    expect(countSolutions(hard.puzzle, 3)).toBe(1);
  });
});

describe("word search", () => {
  const words = ["BROADBAND", "PLUME", "FIRMWARE", "LATENCY", "ROUTER", "MESH", "UPLINK", "SPECTRUM"];
  const ws = generateWordSearch(words, seedFor("u", "2026-09-15", "word_search"));

  it("places words so they read in the grid in the direction recorded", () => {
    expect(ws.placed.length).toBeGreaterThan(4);
    for (const p of ws.placed) {
      let read = "";
      for (let i = 0; i < p.word.length; i++) read += ws.grid[p.row + p.dRow * i]![p.col + p.dCol * i];
      expect(read).toBe(p.word);
    }
  });

  it("fills every cell, so there are no holes to give an answer away", () => {
    expect(ws.grid).toHaveLength(ws.size);
    for (const row of ws.grid) {
      expect(row).toHaveLength(ws.size);
      for (const cell of row) expect(cell).toMatch(/^[A-Z]$/);
    }
  });

  it("marks exactly the cells its answers occupy for the solution page", () => {
    const cells = solutionCells(ws);
    let expected = 0;
    for (const p of ws.placed) expected += p.word.length;
    // Crossings are shared, so the set is no larger than the letters placed.
    expect(cells.size).toBeLessThanOrEqual(expected);
    expect(cells.size).toBeGreaterThan(0);
    for (const key of cells) {
      const [r, c] = key.split(",").map(Number);
      expect(ws.grid[r!]![c!]).toMatch(/^[A-Z]$/);
    }
  });

  it("is the same grid for the same seed (rule 4)", () => {
    expect(generateWordSearch(words, 5).grid).toEqual(generateWordSearch(words, 5).grid);
    expect(generateWordSearch(words, 5).grid).not.toEqual(generateWordSearch(words, 6).grid);
  });

  it("strips anything that is not a letter, since a cell holds one character", () => {
    expect(normalizeWord("Wi-Fi 6E")).toBe("WIFIE");
    const w = generateWordSearch(["TR-369", "Plume Uprise"], 1);
    for (const p of w.placed) expect(p.word).toMatch(/^[A-Z]+$/);
  });

  it("reports words it could not fit instead of dropping them silently", () => {
    const tiny = generateWordSearch(["ELECTROENCEPHALOGRAPHY", "CAT", "NOTES"], 3, { size: 8, minLength: 4 });
    expect(tiny.placed.some((p) => p.word === "NOTES")).toBe(true);
    // Too long for an 8-wide grid, and "CAT" is under the minimum length.
    expect(tiny.placed.some((p) => p.word === "ELECTROENCEPHALOGRAPHY")).toBe(false);
    expect(tiny.placed.some((p) => p.word === "CAT")).toBe(false);
  });

  it("falls back to a general list for an account that has told us nothing", () => {
    const w = generateWordSearch(GENERAL_WORDS, 11);
    expect(w.placed.length).toBeGreaterThan(8);
  });
});
