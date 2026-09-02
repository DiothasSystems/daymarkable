import { describe, expect, it } from "vitest";
import { parseExtraction } from "./client.js";
import { STARTER_CONVENTIONS, describeConventions, validateConventions } from "./conventions.js";
import { buildSystemPrompt } from "./prompt.js";
import { costUsd } from "./pricing.js";

const good = {
  schema_version: 1,
  page_kind: "notes",
  planner_page_code: null,
  transcription: "* call Steve Tuesday 2pm",
  tasks: [
    {
      text: "call Steve",
      due: "2026-09-08",
      due_time: "14:00",
      priority: "normal",
      kind: "action",
      project: null,
      people: ["Steve"],
      source_convention: "asterisk",
      confidence: 0.92,
    },
  ],
  events: [],
  meeting_requests: [],
  notes: [],
  checkbox_updates: [],
  overall_confidence: 0.9,
  needs_escalation: false,
};

describe("parseExtraction", () => {
  it("accepts a bare JSON object", () => {
    const r = parseExtraction(JSON.stringify(good));
    expect(r.error).toBeNull();
    expect(r.extraction?.tasks[0]?.text).toBe("call Steve");
  });
  it("tolerates fences and prose", () => {
    const r = parseExtraction("Here you go:\n```json\n" + JSON.stringify(good) + "\n```");
    expect(r.extraction?.tasks).toHaveLength(1);
  });
  it("rejects schema violations", () => {
    const r = parseExtraction(JSON.stringify({ ...good, tasks: [{ text: "x" }] }));
    expect(r.extraction).toBeNull();
    expect(r.error).toMatch(/schema validation/);
  });
});

describe("conventions", () => {
  it("starter set is described in the prompt, deterministically", () => {
    const a = buildSystemPrompt({ conventions: STARTER_CONVENTIONS });
    const b = buildSystemPrompt({ conventions: { active: [...STARTER_CONVENTIONS.active].reverse() } });
    expect(a).toBe(b);
    expect(a).toContain("keyword:TODO");
    expect(a).toContain("dM/<KIND>");
  });
  it("validates user config", () => {
    expect(() => validateConventions({ active: [{ id: "nope", meaning: "action" }] })).toThrow();
    expect(validateConventions({ active: [{ id: "keyword", meaning: "action", keyword: "F/U" }] }).active[0]).toEqual({
      id: "keyword",
      meaning: "action",
      keyword: "F/U",
    });
    expect(describeConventions({ active: [] })).toContain("NO ink conventions");
  });
});

describe("pricing", () => {
  it("halves for batch and discounts cache reads", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 };
    expect(costUsd(u, "claude-haiku-4-5", false)).toBeCloseTo(1.1);
    expect(costUsd(u, "claude-haiku-4-5", true)).toBeCloseTo(0.55);
    expect(costUsd(u, "unknown-model", false)).toBe(0);
  });
});
