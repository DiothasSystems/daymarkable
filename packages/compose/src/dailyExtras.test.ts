import { PDFDocument } from "pdf-lib";
import { ASK_FOR_WORDS, MAX_PLACED, buildCrossword, cluesByDirection, generateSudoku, generateWordSearch, solutionCells, type CrosswordWord } from "@daymarkable/puzzles";
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
   * The crossword carries a grid AND two clue lists on page one, so it is the page most likely to
   * spill. Tested at the most answers the layout will ever place, with long clues, and then again
   * with every clue in one column — the pathological shape, where nothing balances the lists.
   */
  it("is exactly two pages for a crossword at the maximum number of answers", async () => {
    // Seed 42 fills the grid to the cap. Measured over sixty seeds at this word count the layout
    // places a median of 13 and a maximum of 14, so this is the deepest clue list the page ever
    // carries — and the page must hold it without asking for a third.
    const cw = buildCrossword(CROSSWORD_WORDS, 42);
    expect(CROSSWORD_WORDS).toHaveLength(ASK_FOR_WORDS);
    expect(cw.placed.length).toBe(MAX_PLACED);
    const { across, down } = cluesByDirection(cw);
    const numbers = new Map(cw.placed.map((p) => [`${p.row},${p.col}`, p.number] as const));
    const out = await composeDailyPuzzle({
      ...when,
      puzzle: {
        kind: "crossword",
        size: cw.size,
        grid: cw.grid,
        numbers,
        across: across.map((p) => ({ number: p.number, clue: p.clue, answer: p.answer })),
        down: down.map((p) => ({ number: p.number, clue: p.clue, answer: p.answer })),
      },
    });
    expect(out.pageCount).toBe(2);
    expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(2);
  });

  it("is still two pages when every clue lands in one column", async () => {
    const cw = buildCrossword(CROSSWORD_WORDS, 42);
    const all = cw.placed.map((p, i) => ({ number: i + 1, clue: p.clue, answer: p.answer }));
    const out = await composeDailyPuzzle({
      ...when,
      puzzle: { kind: "crossword", size: cw.size, grid: cw.grid, numbers: new Map(), across: all, down: [] },
    });
    expect(out.pageCount).toBe(2);
  });
});

/** Long clues on purpose: a clue is fitted to its column, and the count is what decides the height. */
const CROSSWORD_WORDS: CrosswordWord[] = [
  { answer: "BROADBAND", clue: "The fast connection everybody buys by its advertised speed rather than its delay" },
  { answer: "LATENCY", clue: "The delay you actually feel, as opposed to the number on the box" },
  { answer: "SPECTRUM", clue: "What regulators auction off in bands, and operators fight over" },
  { answer: "ETHERNET", clue: "The cable that still beats wireless when it matters" },
  { answer: "PROTOCOL", clue: "Agreed manners between two machines that have never met" },
  { answer: "GATEWAY", clue: "The box that is the way in and, on a bad day, the way nowhere" },
  { answer: "ANTENNA", clue: "It listens, and its placement matters more than its specification" },
  { answer: "TELEMETRY", clue: "Measurements a device sends home about itself" },
  { answer: "ROUTER", clue: "Box with rather too many blinking lights" },
  { answer: "PACKET", clue: "The small parcel a network actually carries" },
  { answer: "SIGNAL", clue: "Bars on a phone, roughly speaking" },
  { answer: "SUBNET", clue: "A deliberately carved slice of an address space" },
  { answer: "DOMAIN", clue: "A name you only ever rent, by the year" },
  { answer: "TUNNEL", clue: "A private path taken through a decidedly public place" },
  { answer: "UPLINK", clue: "The direction almost nobody advertises" },
  { answer: "FIRMWARE", clue: "Software that thinks it is hardware" },
  { answer: "MODEM", clue: "It used to scream before it worked" },
  { answer: "CACHE", clue: "Kept close by, to save the trouble of asking twice" },
  { answer: "MESH", clue: "Several boxes pretending, with some success, to be one" },
  { answer: "FIBRE", clue: "Glass drawn thin enough to carry light around a corner" },
  { answer: "BANDWIDTH", clue: "Capacity, sold as though it were speed" },
  { answer: "PASSPOINT", clue: "The standard that lets a phone join a network without being asked" },
  { answer: "CHANNEL", clue: "Pick the wrong one and the neighbours ruin your evening" },
  { answer: "ROAMING", clue: "Moving between them without noticing, ideally" },
  { answer: "BRIDGE", clue: "It joins two segments and pretends they were always one" },
  { answer: "SWITCH", clue: "It forwards by address rather than shouting to everyone" },
  { answer: "BEACON", clue: "The regular announcement a network makes about itself" },
  { answer: "HANDOFF", clue: "The moment one radio gives you to another" },
];
