import { describe, expect, it } from "vitest";
import {
  ASK_FOR_WORDS,
  CROSSWORD_SYSTEM,
  MAX_PLACED,
  MIN_LENGTH,
  buildCrossword,
  canPlace,
  cluesByDirection,
  parseCrosswordWords,
  validateCrossword,
  type CrosswordWord,
} from "./crossword.js";
import { seedFor } from "./schedule.js";

const WORDS: CrosswordWord[] = [
  { answer: "BROADBAND", clue: "Fast internet, generically" },
  { answer: "LATENCY", clue: "The delay you feel, not the speed you bought" },
  { answer: "ROUTER", clue: "Box with too many lights" },
  { answer: "SPECTRUM", clue: "What regulators auction" },
  { answer: "UPLINK", clue: "The direction nobody advertises" },
  { answer: "MESH", clue: "Several boxes pretending to be one" },
  { answer: "MODEM", clue: "It used to scream" },
  { answer: "ETHERNET", clue: "Cable that still wins" },
  { answer: "GATEWAY", clue: "Way in" },
  { answer: "PACKET", clue: "What the network carries" },
  { answer: "SIGNAL", clue: "Bars on a phone" },
  { answer: "ANTENNA", clue: "It listens" },
  { answer: "FIBRE", clue: "Glass that carries light" },
  { answer: "CACHE", clue: "Kept close, to save asking twice" },
  { answer: "SUBNET", clue: "A slice of an address space" },
  { answer: "PROTOCOL", clue: "Agreed manners" },
  { answer: "TUNNEL", clue: "A private path through a public place" },
  { answer: "DOMAIN", clue: "Name you rent by the year" },
];

const emptyGrid = () => Array.from({ length: 15 }, () => new Array<string | null>(15).fill(null));

/** Write a word into a scratch grid, for the canPlace cases. */
function withWord(word: string, row: number, col: number, across = true): (string | null)[][] {
  const g = emptyGrid();
  for (let i = 0; i < word.length; i++) {
    if (across) g[row]![col + i] = word[i]!;
    else g[row + i]![col] = word[i]!;
  }
  return g;
}

describe("canPlace", () => {
  it("allows the first word anywhere it fits", () => {
    expect(canPlace(emptyGrid(), "ROUTER", 7, 4, "across")).toBe(true);
  });

  it("refuses a word that runs off the grid", () => {
    expect(canPlace(emptyGrid(), "BROADBAND", 0, 10, "across")).toBe(false);
    expect(canPlace(emptyGrid(), "BROADBAND", 10, 0, "down")).toBe(false);
    expect(canPlace(emptyGrid(), "ROUTER", -1, 0, "across")).toBe(false);
  });

  it("requires every word after the first to interlock", () => {
    const g = withWord("ROUTER", 7, 4);
    expect(canPlace(g, "MODEM", 0, 0, "across")).toBe(false);
    expect(canPlace(g, "REST", 7, 4, "down")).toBe(true);
  });

  it("refuses a conflicting letter at a crossing", () => {
    const g = withWord("MODEM", 7, 5);
    expect(canPlace(g, "XYZ", 7, 5, "down")).toBe(false);
  });

  /**
   * The condition that makes the grid valid by construction. Two words side by side create
   * perpendicular two-letter runs, and those are "words" a solver finds and we cannot clue.
   */
  it("refuses a placement that would invent words alongside an existing one", () => {
    const g = withWord("MODEM", 7, 5);
    expect(canPlace(g, "MESH", 8, 5, "across")).toBe(false);
    expect(canPlace(g, "MESH", 6, 5, "across")).toBe(false);
  });

  it("refuses a word that would butt against another end to end", () => {
    const g = withWord("MODEM", 7, 5);
    expect(canPlace(g, "CACHE", 7, 10, "across")).toBe(false);
  });
});

describe("buildCrossword", () => {
  const cw = buildCrossword(WORDS, seedFor("u", "2026-09-21", "crossword"));

  it("places a usable number of words in both directions", () => {
    expect(cw.placed.length).toBeGreaterThanOrEqual(8);
    expect(cw.placed.length).toBeLessThanOrEqual(MAX_PLACED);
    expect(cw.placed.some((p) => p.direction === "across")).toBe(true);
    expect(cw.placed.some((p) => p.direction === "down")).toBe(true);
  });

  it("writes every placed word into the grid where it says it is", () => {
    for (const p of cw.placed) {
      let read = "";
      for (let i = 0; i < p.answer.length; i++) {
        read += p.direction === "across" ? cw.grid[p.row]![p.col + i] : cw.grid[p.row + i]![p.col];
      }
      expect(read).toBe(p.answer);
    }
  });

  /**
   * The check a hand-generated 5x5 failed on two of ten runs during this feature's design. Here it
   * must hold by construction.
   */
  it("invents no words: every run of two or more letters is a clued answer", () => {
    expect(validateCrossword(cw).unclued).toEqual([]);
  });

  it("holds that property across many different seeds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const c = buildCrossword(WORDS, seed);
      const v = validateCrossword(c);
      expect(v.ok, `seed ${seed} invented ${JSON.stringify(v.unclued)}`).toBe(true);
      expect(c.placed.length).toBeGreaterThan(3);
    }
  });

  it("numbers answers in reading order, sharing a number where two answers start in one square", () => {
    expect(Math.min(...cw.placed.map((p) => p.number))).toBe(1);
    const byStart = new Map<string, Set<number>>();
    for (const p of cw.placed) {
      const key = `${p.row},${p.col}`;
      byStart.set(key, (byStart.get(key) ?? new Set<number>()).add(p.number));
    }
    for (const set of byStart.values()) expect(set.size).toBe(1);
  });

  it("is the same grid for the same seed and a different one otherwise (rule 4)", () => {
    expect(buildCrossword(WORDS, 3).grid).toEqual(buildCrossword(WORDS, 3).grid);
    expect(buildCrossword(WORDS, 3).grid).not.toEqual(buildCrossword(WORDS, 4).grid);
  });

  it("reports what it could not fit rather than dropping it silently", () => {
    const tiny = buildCrossword(WORDS, 1, 9);
    expect(tiny.skipped.length).toBeGreaterThan(0);
    expect(validateCrossword(tiny).ok).toBe(true);
  });

  it("ignores answers too short, duplicated, or unclued", () => {
    const only = buildCrossword(
      [
        { answer: "AT", clue: "too short" },
        { answer: "ROUTER", clue: "first" },
        { answer: "router", clue: "the same word again" },
        { answer: "MODEM", clue: "" },
      ],
      7,
    );
    expect(only.placed.map((p) => p.answer)).toEqual(["ROUTER"]);
  });

  it("groups clues for printing, in number order", () => {
    const { across, down } = cluesByDirection(cw);
    expect(across.length + down.length).toBe(cw.placed.length);
    expect(across.map((a) => a.number)).toEqual([...across.map((a) => a.number)].sort((a, b) => a - b));
  });

  it("survives being given nothing", () => {
    const none = buildCrossword([], 1);
    expect(none.placed).toEqual([]);
    expect(validateCrossword(none).ok).toBe(true);
  });
});

describe("validateCrossword", () => {
  it("catches an invented word, which is the whole reason it exists", () => {
    const cw = buildCrossword(WORDS, 5);
    const forged = { ...cw, grid: cw.grid.map((r) => [...r]) };
    let planted = false;
    for (let r = 1; r < forged.size && !planted; r++) {
      for (let c = 0; c < forged.size; c++) {
        if (forged.grid[r]![c] === null && forged.grid[r - 1]![c] !== null) {
          forged.grid[r]![c] = "Z";
          planted = true;
          break;
        }
      }
    }
    expect(planted).toBe(true);
    const v = validateCrossword(forged);
    expect(v.ok).toBe(false);
    expect(v.unclued.length).toBeGreaterThan(0);
  });
});

describe("parseCrosswordWords", () => {
  it("reads answers and clues, normalising the answer", () => {
    const r = parseCrosswordWords('{"words":[{"answer":"Wi-Fi","clue":"Wireless, informally"},{"answer":"ROUTER","clue":"Box with lights"}]}');
    expect(r.error).toBeNull();
    expect(r.words.map((w) => w.answer)).toEqual(["WIFI", "ROUTER"]);
  });

  it("tolerates fences and prose around the JSON", () => {
    const text = 'Here you go:\n```json\n{"words":[{"answer":"MODEM","clue":"It screamed"}]}\n```';
    expect(parseCrosswordWords(text).words).toHaveLength(1);
  });

  /** A clue containing its own answer is not a clue. The model is told; this enforces it. */
  it("drops a clue that gives away its answer", () => {
    const r = parseCrosswordWords('{"words":[{"answer":"ROUTER","clue":"A router, essentially"},{"answer":"MODEM","clue":"It screamed"}]}');
    expect(r.words.map((w) => w.answer)).toEqual(["MODEM"]);
  });

  it("drops answers shorter than a crossword answer", () => {
    const r = parseCrosswordWords('{"words":[{"answer":"AT","clue":"x"},{"answer":"CAT","clue":"Small tiger"}]}');
    expect(r.words.map((w) => w.answer)).toEqual(["CAT"]);
    expect(MIN_LENGTH).toBe(3);
  });

  it("reports a reply it could not read rather than returning nothing as success", () => {
    expect(parseCrosswordWords("").error).toMatch(/no JSON/);
    expect(parseCrosswordWords('{"ok":1}').error).toMatch(/no words array/);
    expect(parseCrosswordWords('{"words":[{"answer":"A","clue":"x"}]}').error).toMatch(/no usable words/);
  });

  it("asks for far more words than it can place, because most will not fit", () => {
    expect(ASK_FOR_WORDS).toBeGreaterThan(MAX_PLACED * 1.5);
    expect(CROSSWORD_SYSTEM).toContain(String(ASK_FOR_WORDS));
    expect(CROSSWORD_SYSTEM).toContain("You do NOT draw the grid");
  });
});
