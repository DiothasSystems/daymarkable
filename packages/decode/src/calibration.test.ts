import { describe, expect, it } from "vitest";
import { generateCalibrationPassage, learnedTerms, transcriptionAccuracy } from "./calibration.js";
import { buildSystemPrompt, describeCalibration, describeLexicon } from "./prompt.js";
import { STARTER_CONVENTIONS } from "./conventions.js";

describe("transcriptionAccuracy", () => {
  const expected = "* send vendor shortlist to Maya by Sep 14\n_budget holds at $48,500_";
  it("is 1 for an exact read and tolerates markup and line breaks", () => {
    expect(transcriptionAccuracy(expected, expected)).toBe(1);
    expect(transcriptionAccuracy(expected, "send vendor shortlist to Maya by Sep 14 budget holds at $48,500")).toBeCloseTo(1, 2);
  });
  it("falls as words are misread", () => {
    const half = transcriptionAccuracy(expected, "send vendor shortlist to Maria by Sep 14");
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.8);
    expect(transcriptionAccuracy(expected, "")).toBe(0);
    expect(transcriptionAccuracy("", "anything")).toBe(0);
  });
});

describe("learnedTerms", () => {
  it("keeps the proper nouns a correction introduced, not ordinary words", () => {
    expect(learnedTerms("call Joel Waterman about QoS", "call Joel Warburton about Q4")).toEqual(["Warburton", "Q4"]);
    expect(learnedTerms("send the deck", "send the slides")).toEqual([]);
    expect(learnedTerms("TR 369 based", "TR-369 based")).toEqual(["TR-369"]);
  });
});

describe("per-user prompt context", () => {
  it("names the writer's vocabulary and the calibration sample in the cached prompt", () => {
    const withBoth = buildSystemPrompt({ conventions: STARTER_CONVENTIONS, lexicon: ["Plume", "Optum"], calibrationText: "* call Steve" });
    expect(withBoth).toContain("Optum · Plume"); // sorted, so the prompt caches byte-stably
    expect(withBoth).toContain("HANDWRITING SAMPLE");
    expect(withBoth).toContain("* call Steve");
    const bare = buildSystemPrompt({ conventions: STARTER_CONVENTIONS });
    expect(bare).not.toContain("HANDWRITING SAMPLE");
    expect(bare).not.toContain("VOCABULARY");
    expect(describeLexicon([])).toBe("");
    expect(describeCalibration("x")).toContain("emit tasks, events, notes or checkbox updates from it");
  });
  it("is byte-stable for the same inputs in any order, so the cache is not busted", () => {
    const a = buildSystemPrompt({ conventions: STARTER_CONVENTIONS, lexicon: ["Zeta", "Alpha"] });
    const b = buildSystemPrompt({ conventions: STARTER_CONVENTIONS, lexicon: ["Alpha", "Zeta"] });
    expect(a).toBe(b);
  });
});

describe("generateCalibrationPassage", () => {
  const profile = { role: "VP Product", industry: "broadband", context: "" };
  it("returns the model's lines and terms", async () => {
    const fake = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: '{"lines":["Plume sync 9/14","* call Priya","TODO send PO 2291","_budget holds_","one","two","three"],"terms":["Plume","Priya"]}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: "end_turn",
        }),
      },
    } as never;
    const r = await generateCalibrationPassage(profile, fake, "claude-sonnet-5");
    expect(r.text.split("\n")).toHaveLength(7);
    expect(r.terms).toEqual(["Plume", "Priya"]);
    expect(r.costUsd).toBeGreaterThan(0);
  });
  it("falls back to a usable passage when the model misbehaves", async () => {
    const broken = { messages: { create: async () => { throw new Error("boom"); } } } as never;
    const r = await generateCalibrationPassage(profile, broken);
    expect(r.text.split("\n").length).toBeGreaterThan(8);
    // The fallback still exercises digits, money, the conventions and a strike-through.
    expect(r.text).toMatch(/\* /);
    expect(r.text).toContain("TODO");
    expect(r.text).toMatch(/_[^_]+_/);
    expect(r.text).toContain("~~");
    expect(r.text).toMatch(/\$\d/);
    expect(r.costUsd).toBe(0);
  });
});
