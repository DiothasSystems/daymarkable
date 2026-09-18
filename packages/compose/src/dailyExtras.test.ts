import { PDFDocument } from "pdf-lib";
import { GENERAL_KNOWLEDGE, buildCrossword, cluesByDirection, generateSudoku, generateWordSearch, minPlaced, solutionCells, specFor } from "@daymarkable/puzzles";
import { describe, expect, it } from "vitest";
import { composeDailyPuzzle } from "./dailyPuzzle.js";
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
      puzzle: { kind: "word_search", size: ws.size, grid: ws.grid, words: ws.placed.map((p) => p.word), solutionCells: solutionCells(ws) },
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
