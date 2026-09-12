import { describe, expect, it } from "vitest";
import { drawingCaption, shouldReproduceInk, transcribedWordCount } from "./drawing.js";

const page = (over: Partial<Parameters<typeof shouldReproduceInk>[0]> = {}) => ({
  hasDrawing: false,
  words: 0,
  coverage: 0.4,
  ...over,
});

describe("deciding a page is a drawing", () => {
  it("reproduces a page the decoder called a diagram", () => {
    expect(shouldReproduceInk(page({ hasDrawing: true, words: 140 }))).toBe(true);
  });

  // The page the model could not read is exactly the page that most needs reproducing, and it
  // arrives here with an empty transcription rather than a caption.
  it("reproduces a page covered in ink that produced almost no words", () => {
    expect(shouldReproduceInk(page({ words: 0 }))).toBe(true);
    expect(shouldReproduceInk(page({ words: 12 }))).toBe(true);
  });

  it("leaves a page of writing alone", () => {
    expect(shouldReproduceInk(page({ words: 130 }))).toBe(false);
  });

  // A caption on a nearly bare page is a margin doodle; reproducing it wastes half a page.
  it("ignores a scribble, whatever the decoder called it", () => {
    expect(shouldReproduceInk(page({ hasDrawing: true, coverage: 0.01 }))).toBe(false);
    expect(shouldReproduceInk(page({ words: 0, coverage: 0.005 }))).toBe(false);
  });

  it("ignores a blank page", () => {
    expect(shouldReproduceInk(page({ coverage: 0 }))).toBe(false);
  });
});

describe("counting what was actually transcribed", () => {
  // The decoder writes "[diagram: ...]" into the transcription, and those words are its own.
  it("does not count the decoder's own bracketed asides as writing", () => {
    expect(transcribedWordCount("[diagram: three boxes joined by arrows and a cloud]")).toBe(0);
    expect(transcribedWordCount("Budget review\n[arrow to Q4]\nAsk Priya")).toBe(4);
  });

  it("counts words, not punctuation", () => {
    expect(transcribedWordCount("-- — · ...")).toBe(0);
    expect(transcribedWordCount("Q4 roadmap: 3 items")).toBe(4);
  });
});

describe("what is printed under the drawing", () => {
  it("names the page it came from, and what the decoder said it shows", () => {
    expect(drawingCaption("three boxes joined by arrows", "meeting-notes", 5)).toBe(
      "MEETING-NOTES · p.6 · three boxes joined by arrows",
    );
  });

  it("falls back to the page reference rather than guessing at the meaning", () => {
    expect(drawingCaption(null, "ideas", 0)).toBe("IDEAS · p.1");
    expect(drawingCaption("   ", "ideas", 0)).toBe("IDEAS · p.1");
  });
});
