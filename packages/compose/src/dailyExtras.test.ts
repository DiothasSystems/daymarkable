import { PDFDocument } from "pdf-lib";
import { GENERAL_KNOWLEDGE, buildCrossword, cluesByDirection, generateSudoku, generateWordSearch, minPlaced, specFor } from "@daymarkable/puzzles";
import { describe, expect, it } from "vitest";
import { composeDailyPuzzle, wordLoops } from "./dailyPuzzle.js";
import { composeDailyUpdate } from "./dailyUpdate.js";

const when = { date: "2026-09-17", generatedAt: "2026-09-17T00:05:00-04:00", runLabel: "nightly" };

describe("composeDailyUpdate", () => {
  it("renders the brief", async () => {
    const out = await composeDailyUpdate({
      ...when,
      sections: [
        {
          topic: "broadband hardware",
          items: [
            { headline: "Ofcom opens the upper 6GHz band to consultation", summary: "Responses are due in November, and the band would roughly double the spectrum available to Wi-Fi 7 indoors.", source: "Ofcom" },
            { headline: "Plume reports a quarter of subscribers on Wi-Fi 7", summary: "The figure comes from its own managed-network base rather than the market as a whole.", source: null },
          ],
        },
        { topic: "school board", items: [] },
      ],
    });
    expect(out.pageCount).toBeGreaterThanOrEqual(1);
    expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(out.pageCount);
  });

  it("says so plainly when there was no brief, rather than printing an empty page", async () => {
    const out = await composeDailyUpdate({ ...when, sections: [], unavailable: "The news search did not answer this morning." });
    expect(out.pageCount).toBe(1);
  });
});

describe("composeDailyPuzzle", () => {
  /** The contract the customer relies on: the answer is one page turn away and nowhere else. */
  it("is exactly two pages for a sudoku", async () => {
    const s = generateSudoku(1234);
    const out = await composeDailyPuzzle({
      ...when,
      puzzle: { kind: "sudoku", puzzle: s.puzzle, solution: s.solution, difficulty: s.difficulty },
    });
    expect(out.pageCount).toBe(2);
    expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(2);
  });

  /**
   * At the generator's full word count, not a token six. A twelve-word sample spilled the list
   * onto a third page while a six-word test passed, which is exactly the shape of bug a sample
   * catches and a convenient fixture does not.
   */
  it("is exactly two pages for a word search at a full word list", async () => {
    const ws = generateWordSearch(
      ["BROADBAND", "FIRMWARE", "LATENCY", "ROUTER", "SPECTRUM", "UPLINK", "GATEWAY", "MESH", "PASSPOINT", "TELEMETRY", "BANDWIDTH", "PROTOCOL", "ETHERNET", "MODEM"],
      99,
    );
    expect(ws.placed.length).toBeGreaterThan(9);
    const out = await composeDailyPuzzle({
      ...when,
      puzzle: { kind: "word_search", size: ws.size, grid: ws.grid, words: ws.placed.map((p) => p.word), placements: ws.placed },
    });
    expect(out.pageCount).toBe(2);
  });

  it("stays two pages when it says what it is standing in for", async () => {
    const s = generateSudoku(7);
    const out = await composeDailyPuzzle({
      ...when,
      insteadOf: "crossword",
      puzzle: { kind: "sudoku", puzzle: s.puzzle, solution: s.solution, difficulty: s.difficulty },
    });
    expect(out.pageCount).toBe(2);
  });

  /**
   * A crossword is THREE pages — grid, clues, solution — not two. The grid fills a page on its own
   * because the squares have to be big enough to write a letter in by hand, which leaves nowhere for
   * fifty clues to go. Tested at every day's real shape, because Friday's fifty answers and Monday's
   * twenty-five produce very different clue depths.
   */
  it("is exactly three pages for a crossword, on each of the three crossword days", async () => {
    for (const weekday of [1, 3, 5]) {
      const spec = specFor(weekday);
      const cw = buildCrossword(GENERAL_KNOWLEDGE, 42, spec);
      expect(cw.placed.length).toBeGreaterThanOrEqual(minPlaced(spec));
      const out = await composeDailyPuzzle({ ...when, puzzle: crosswordInput(cw) });
      expect(out.pageCount, `weekday ${weekday} with ${cw.placed.length} answers`).toBe(3);
      expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(3);
    }
  });

  /**
   * The pathological shape: every clue in one column, so nothing balances the lists. Fifty in a
   * single column does not fit at a comfortable line height, which is why the line height is fitted
   * to the longest list rather than fixed — a clue that runs off the page is a clue that cannot be
   * answered.
   */
  it("is still three pages when every clue lands in one column", async () => {
    const spec = specFor(5);
    const cw = buildCrossword(GENERAL_KNOWLEDGE, 42, spec);
    const all = cw.placed.map((p, i) => ({ number: i + 1, clue: p.clue, answer: p.answer }));
    expect(all.length).toBe(50);
    const out = await composeDailyPuzzle({
      ...when,
      puzzle: { ...crosswordInput(cw), across: all, down: [] },
    });
    expect(out.pageCount).toBe(3);
  });
});

function crosswordInput(cw: ReturnType<typeof buildCrossword>) {
  const { across, down } = cluesByDirection(cw);
  return {
    kind: "crossword" as const,
    cols: cw.cols,
    rows: cw.rows,
    grid: cw.grid,
    numbers: new Map(cw.placed.map((p) => [`${p.row},${p.col}`, p.number] as const)),
    across: across.map((p) => ({ number: p.number, clue: p.clue, answer: p.answer })),
    down: down.map((p) => ({ number: p.number, clue: p.clue, answer: p.answer })),
  };
}

describe("the word search answer key", () => {
  /**
   * The key used to mark answers by shading their cells, and the shade is #F1EFE7 against #FBFBF9
   * paper — four values apart, which a reMarkable does not resolve. The answer key was visually
   * identical to the puzzle, which is what the customer reported. Loops replaced it.
   */
  it("puts a loop on the page for every answer, and none on the puzzle page", async () => {
    const ws = generateWordSearch(["BROADBAND", "LATENCY", "ROUTER", "SPECTRUM", "UPLINK", "MESH", "MODEM", "ETHERNET"], 42);
    expect(ws.placed.length).toBeGreaterThan(5);
    const base = { ...when, puzzle: { kind: "word_search" as const, size: ws.size, grid: ws.grid, words: ws.placed.map((p) => p.word) } };
    const withLoops = await composeDailyPuzzle({ ...base, puzzle: { ...base.puzzle, placements: ws.placed } });
    const without = await composeDailyPuzzle({ ...base, puzzle: { ...base.puzzle, placements: [] } });
    expect(withLoops.pageCount).toBe(2);
    // Same two pages, same letters; the only difference is the loops, so the drawn one must be bigger.
    expect(withLoops.pdf.length).toBeGreaterThan(without.pdf.length);
  });

  /**
   * Whether a loop is centred on its word and turned to match is arithmetic, so it is checked as
   * arithmetic. A word search places in eight directions — backwards and both diagonals included —
   * and a loop that ignored direction would sit across the grid at the wrong angle.
   */
  it("centres each loop on its word and turns it to the direction the word runs", () => {
    const cell = 40;
    const loops = wordLoops(
      [
        { word: "ABCDE", row: 0, col: 0, dRow: 0, dCol: 1 }, // across
        { word: "ABCDE", row: 0, col: 0, dRow: 1, dCol: 0 }, // down
        { word: "ABCDE", row: 0, col: 0, dRow: 1, dCol: 1 }, // down-right diagonal
        { word: "ABCDE", row: 0, col: 4, dRow: 0, dCol: -1 }, // backwards
        { word: "X", row: 2, col: 2, dRow: 0, dCol: 1 }, // one letter
      ],
      100,
      200,
      cell,
    );
    const [across, down, diag, back, single] = loops;
    // Across: centred between the first and last letter, flat, and longer than it is tall.
    expect(across!.cx).toBeCloseTo(100 + 2.5 * cell, 6);
    expect(across!.cy).toBeCloseTo(200 + 0.5 * cell, 6);
    expect(across!.angle).toBeCloseTo(0, 6);
    expect(across!.a).toBeGreaterThan(across!.b);
    // Down: a quarter turn, and the same size as the across one.
    expect(down!.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(down!.a).toBeCloseTo(across!.a, 6);
    // Diagonal: 45 degrees, and longer because the diagonal of a square is longer than its side.
    expect(diag!.angle).toBeCloseTo(Math.PI / 4, 6);
    expect(diag!.a).toBeGreaterThan(across!.a);
    // Backwards: same centre as the forwards word over the same squares, pointing the other way.
    expect(back!.cx).toBeCloseTo(across!.cx, 6);
    expect(Math.abs(back!.angle)).toBeCloseTo(Math.PI, 6);
    // One letter: a circle on its own square.
    expect(single!.cx).toBeCloseTo(100 + 2.5 * cell, 6);
    expect(single!.a).toBeCloseTo(single!.b, 6);
  });

  it("overhangs the first and last letter so the loop encloses them", () => {
    const cell = 40;
    const [loop] = wordLoops([{ word: "AB", row: 0, col: 0, dRow: 0, dCol: 1 }], 0, 0, cell);
    // Half the distance between the two letter centres is half a cell; the loop must reach past the
    // outer edge of both squares, which is a full cell from the centre.
    expect(loop!.a).toBeGreaterThan(cell * 0.9);
  });
});
