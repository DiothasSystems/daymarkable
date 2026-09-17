import { PDFDocument } from "pdf-lib";
import { generateSudoku, generateWordSearch, solutionCells } from "@daymarkable/puzzles";
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
});
