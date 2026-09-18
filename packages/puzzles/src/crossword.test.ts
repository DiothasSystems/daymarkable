import { describe, expect, it } from "vitest";
import {
  BATCH_SIZE,
  BATCH_THEMES,
  CROSSWORD_SPECS,
  MAX_LENGTH,
  MIN_LENGTH,
  buildCrossword,
  canPlace,
  cluesByDirection,
  crosswordSystem,
  fillRatio,
  firstJsonObject,
  lengthBands,
  minPlaced,
  parseCrosswordWords,
  specFor,
  validateCrossword,
  type CrosswordWord,
  type Dims,
} from "./crossword.js";
import { GENERAL_KNOWLEDGE } from "./generalKnowledge.js";
import { isoWeekday, seedFor } from "./schedule.js";
import { seededCrossword } from "./seededWeeks.js";

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

/** A square scratch grid for the canPlace cases, where the shape is not what is being tested. */
const D: Dims = { cols: 15, rows: 15 };
const emptyGrid = () => Array.from({ length: 15 }, () => new Array<string | null>(15).fill(null));

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
    expect(canPlace(emptyGrid(), "ROUTER", 7, 4, "across", D)).toBe(true);
  });

  it("refuses a word that runs off the grid", () => {
    expect(canPlace(emptyGrid(), "BROADBAND", 0, 10, "across", D)).toBe(false);
    expect(canPlace(emptyGrid(), "BROADBAND", 10, 0, "down", D)).toBe(false);
    expect(canPlace(emptyGrid(), "ROUTER", -1, 0, "across", D)).toBe(false);
  });

  /** Rows and columns are not interchangeable once the grid is a rectangle. */
  it("respects width and height separately", () => {
    const wide: Dims = { cols: 12, rows: 6 };
    const grid = Array.from({ length: 6 }, () => new Array<string | null>(12).fill(null));
    expect(canPlace(grid, "ETHERNET", 2, 0, "across", wide)).toBe(true);
    expect(canPlace(grid, "ETHERNET", 0, 2, "down", wide)).toBe(false);
  });

  it("requires every word after the first to interlock", () => {
    const g = withWord("ROUTER", 7, 4);
    expect(canPlace(g, "MODEM", 0, 0, "across", D)).toBe(false);
    expect(canPlace(g, "REST", 7, 4, "down", D)).toBe(true);
  });

  it("refuses a conflicting letter at a crossing", () => {
    const g = withWord("MODEM", 7, 5);
    expect(canPlace(g, "XYZ", 7, 5, "down", D)).toBe(false);
  });

  /**
   * The condition that makes the grid valid by construction. Two words side by side create
   * perpendicular two-letter runs, and those are "words" a solver finds and we cannot clue.
   */
  it("refuses a placement that would invent words alongside an existing one", () => {
    const g = withWord("MODEM", 7, 5);
    expect(canPlace(g, "MESH", 8, 5, "across", D)).toBe(false);
    expect(canPlace(g, "MESH", 6, 5, "across", D)).toBe(false);
  });

  it("refuses a word that would butt against another end to end", () => {
    const g = withWord("MODEM", 7, 5);
    expect(canPlace(g, "CACHE", 7, 10, "across", D)).toBe(false);
  });
});

describe("buildCrossword", () => {
  const spec = { target: 14, cols: 15, rows: 15 };
  const cw = buildCrossword(WORDS, seedFor("2026-09-21", "crossword"), spec);

  it("places a usable number of words in both directions", () => {
    expect(cw.placed.length).toBeGreaterThanOrEqual(8);
    expect(cw.placed.length).toBeLessThanOrEqual(spec.target);
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
      const c = buildCrossword(WORDS, seed, spec);
      const v = validateCrossword(c);
      expect(v.ok, `seed ${seed} invented ${JSON.stringify(v.unclued)}`).toBe(true);
      expect(c.placed.length).toBeGreaterThan(3);
    }
  });

  /** A rectangular grid is where an off-by-one between rows and columns would show up. */
  it("holds it on a tall rectangle, at every day's real shape", () => {
    for (const weekday of [1, 3, 5]) {
      const s = specFor(weekday);
      for (let seed = 1; seed <= 10; seed++) {
        const c = buildCrossword(GENERAL_KNOWLEDGE, seed, s);
        expect(c.cols).toBe(s.cols);
        expect(c.rows).toBe(s.rows);
        expect(c.grid).toHaveLength(s.rows);
        expect(c.grid[0]).toHaveLength(s.cols);
        const v = validateCrossword(c);
        expect(v.ok, `weekday ${weekday} seed ${seed}: ${JSON.stringify(v.unclued)}`).toBe(true);
        expect(c.placed.length).toBeGreaterThanOrEqual(minPlaced(s));
      }
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
    expect(buildCrossword(WORDS, 3, spec).grid).toEqual(buildCrossword(WORDS, 3, spec).grid);
    expect(buildCrossword(WORDS, 3, spec).grid).not.toEqual(buildCrossword(WORDS, 4, spec).grid);
  });

  it("reports what it could not fit rather than dropping it silently", () => {
    const tiny = buildCrossword(WORDS, 1, { target: 14, cols: 9, rows: 9 });
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
      spec,
    );
    expect(only.placed.map((p) => p.answer)).toEqual(["ROUTER"]);
  });

  it("groups clues for printing, in number order", () => {
    const { across, down } = cluesByDirection(cw);
    expect(across.length + down.length).toBe(cw.placed.length);
    expect(across.map((a) => a.number)).toEqual([...across.map((a) => a.number)].sort((a, b) => a - b));
  });

  it("survives being given nothing", () => {
    const none = buildCrossword([], 1, spec);
    expect(none.placed).toEqual([]);
    expect(validateCrossword(none).ok).toBe(true);
    expect(fillRatio(none)).toBe(0);
  });
});

describe("the week's specs", () => {
  /** The counts asked for: 25 on Monday, 35 on Wednesday, 50 on Friday. */
  it("targets 25, 35 and 50 answers on the three crossword days", () => {
    expect(specFor(1).target).toBe(25);
    expect(specFor(3).target).toBe(35);
    expect(specFor(5).target).toBe(50);
  });

  it("asks a model for far more words than it will place, because most will not fit", () => {
    for (const weekday of [1, 3, 5]) {
      const s = specFor(weekday);
      expect(s.ask).toBeGreaterThan(s.target * 2);
      expect(crosswordSystem(s.ask)).toContain(String(s.ask));
    }
  });

  /**
   * The grid is fitted to the page, so `cell = min(1200/cols, 1484/rows)`. These assertions are what
   * stops a future word-count change quietly shrinking the squares below what the first version had
   * — the whole point of the change was more room to write a letter in.
   */
  it("keeps every square at least as large as the 15x15 version's 50px", () => {
    for (const weekday of [1, 3, 5]) {
      const s = specFor(weekday);
      const cell = Math.min(1200 / s.cols, 1484 / s.rows);
      expect(cell, `weekday ${weekday} cell ${cell.toFixed(1)}px`).toBeGreaterThanOrEqual(49.9);
      // And it must still fit the page in both directions.
      expect(cell * s.cols).toBeLessThanOrEqual(1200.5);
      expect(cell * s.rows).toBeLessThanOrEqual(1484.5);
    }
  });

  it("gives Monday the biggest squares, since it has the fewest answers", () => {
    const cell = (w: number) => Math.min(1200 / specFor(w).cols, 1484 / specFor(w).rows);
    expect(cell(1)).toBeGreaterThan(cell(3));
    expect(cell(3)).toBeGreaterThan(cell(5));
  });

  it("falls back to Monday's spec for a day that is not a crossword day", () => {
    expect(specFor(2)).toBe(CROSSWORD_SPECS[1]);
    expect(specFor(7)).toBe(CROSSWORD_SPECS[1]);
  });

  it("requires four fifths of the target before it will print", () => {
    expect(minPlaced(specFor(1))).toBe(20);
    expect(minPlaced(specFor(5))).toBe(40);
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

  it("tells the model it is not drawing the grid, and that the puzzle is shared", () => {
    expect(crosswordSystem(70)).toContain("You do NOT draw the grid");
    expect(crosswordSystem(70)).toContain("every subscriber");
  });
});

describe("the built-in pool", () => {
  it("is big enough to fill Friday's grid on its own", () => {
    expect(GENERAL_KNOWLEDGE.length).toBeGreaterThan(specFor(5).ask);
  });

  it("has no duplicate answers", () => {
    const seen = new Set(GENERAL_KNOWLEDGE.map((w) => w.answer));
    expect(seen.size).toBe(GENERAL_KNOWLEDGE.length);
  });

  it("never gives an answer away in its own clue, and is letters only", () => {
    for (const w of GENERAL_KNOWLEDGE) {
      expect(w.answer, `${w.answer} is not letters only`).toMatch(/^[A-Z]+$/);
      expect(w.answer.length).toBeGreaterThanOrEqual(MIN_LENGTH);
      expect(w.clue.toUpperCase().includes(w.answer), `"${w.clue}" contains ${w.answer}`).toBe(false);
      expect(w.clue.length).toBeLessThanOrEqual(80);
    }
  });

  /** Weighted short on purpose: short answers are what let a grid interlock. */
  it("is weighted towards short answers", () => {
    const short = GENERAL_KNOWLEDGE.filter((w) => w.answer.length <= 5).length;
    expect(short / GENERAL_KNOWLEDGE.length).toBeGreaterThan(0.3);
  });
});

/**
 * Every case here came from a real reply during the first live generation of the week of 20 September
 * 2026, not from imagination. The model is the input this code cannot control, and these are the
 * shapes it actually produced.
 */
describe("what real replies did", () => {
  it("takes the first object when a note follows it, rather than running to the last brace", () => {
    // A reply ended with a tally of the lengths it had used. first-{ to last-} spanned both and failed
    // to parse at character 11321.
    const text = '{"words":[{"answer":"ROUTER","clue":"Box with lights"}]}\n\nCounts: {3-5: 40, 6-8: 20}';
    const r = parseCrosswordWords(text);
    expect(r.error).toBeNull();
    expect(r.words).toHaveLength(1);
  });

  it("is not fooled by a brace inside a clue", () => {
    const r = parseCrosswordWords('{"words":[{"answer":"BRACE","clue":"A } is one, in print"}]}');
    expect(r.words.map((w) => w.answer)).toEqual(["BRACE"]);
  });

  it("returns null for an object that never closes, which is what truncation looks like", () => {
    expect(firstJsonObject('{"words":[{"answer":"ROUTER"')).toBeNull();
    expect(parseCrosswordWords('{"words":[{"answer":"ROUTER"').error).toMatch(/no JSON/);
  });

  /** One reply offered 1496 entries for an ask of 130, degenerating as it went. */
  it("caps what it keeps at twice the ask", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ answer: `WORD${String(i).padStart(3, "0")}`, clue: `clue ${i}` }));
    const r = parseCrosswordWords(JSON.stringify({ words: many }), 40);
    expect(r.words.length).toBeLessThanOrEqual(80);
    expect(r.offered).toBe(400);
  });

  /** 108 of those 1496 were longer than any answer we can use. */
  it("rejects answers longer than the longest usable one", () => {
    const r = parseCrosswordWords(
      JSON.stringify({ words: [{ answer: "INCOMPREHENSIBILITY", clue: "far too long" }, { answer: "CAT", clue: "Small tiger" }] }),
    );
    expect(r.words.map((w) => w.answer)).toEqual(["CAT"]);
    expect(r.rejected).toBe(1);
    expect(MAX_LENGTH).toBe(14);
  });

  it("keeps one of a repeated answer", () => {
    const r = parseCrosswordWords(
      JSON.stringify({ words: [{ answer: "SALT", clue: "On the table" }, { answer: "salt", clue: "From the sea" }, { answer: "OAK", clue: "Acorn tree" }] }),
    );
    expect(r.words.map((w) => w.answer)).toEqual(["SALT", "OAK"]);
  });

  /**
   * The batching rule. A single call for 130 answers was unreliable in both directions — 1496 entries
   * once, unparseable output the next time — so no batch asks for more than this.
   */
  it("keeps every day's batch size inside what a single call answers reliably", () => {
    expect(BATCH_SIZE).toBeLessThanOrEqual(40);
    for (const weekday of [1, 3, 5]) {
      const spec = specFor(weekday);
      const batches = Math.ceil(spec.ask / BATCH_SIZE);
      expect(Math.ceil(spec.ask / batches)).toBeLessThanOrEqual(BATCH_SIZE);
    }
    // Enough themes that Friday's batches do not repeat one, which would make them overlap.
    expect(BATCH_THEMES.length).toBeGreaterThanOrEqual(Math.ceil(specFor(5).ask / BATCH_SIZE));
  });

  it("asks for a length mix weighted short, since that is what decides whether a grid builds", () => {
    const b = lengthBands(100);
    expect(b.short + b.mid + b.long).toBe(100);
    expect(b.short).toBeGreaterThan(b.mid + b.long);
  });
});

describe("the committed week", () => {
  const dates = ["2026-09-21", "2026-09-23", "2026-09-25"];

  it("has words for the week of 20 September, on its three crossword days", () => {
    for (const d of dates) expect(seededCrossword(d), d).not.toBeNull();
    expect(seededCrossword("2026-09-22")).toBeNull(); // a word search day
    expect(seededCrossword("2027-01-04")).toBeNull();
  });

  /**
   * The point of committing them: what those mornings print is knowable now. If this fails, the seed
   * file was regenerated into something that no longer lays out, and the night would fall back to a
   * word search.
   */
  it("lays out to a full, valid grid on every one of those days", () => {
    for (const date of dates) {
      const spec = specFor(isoWeekday(date));
      const cw = buildCrossword(seededCrossword(date)!, seedFor(date, "crossword"), spec);
      expect(cw.placed.length, `${date} placed`).toBe(spec.target);
      const v = validateCrossword(cw);
      expect(v.ok, `${date}: ${JSON.stringify(v.unclued)}`).toBe(true);
      expect(cw.placed.some((p) => p.direction === "across")).toBe(true);
      expect(cw.placed.some((p) => p.direction === "down")).toBe(true);
    }
  });

  it("holds clues that pass the same rules as the built-in pool", () => {
    for (const date of dates) {
      for (const w of seededCrossword(date)!) {
        expect(w.answer).toMatch(/^[A-Z]+$/);
        expect(w.answer.length).toBeGreaterThanOrEqual(MIN_LENGTH);
        expect(w.answer.length).toBeLessThanOrEqual(MAX_LENGTH);
        expect(w.clue.toUpperCase().includes(w.answer), `"${w.clue}" gives away ${w.answer}`).toBe(false);
      }
    }
  });
});
