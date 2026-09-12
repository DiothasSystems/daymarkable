import { describe, expect, it } from "vitest";
import { AnthropicDecoder, parseExtraction, totalUsage, type DecodePageInput, type DecodePageResult, type DecodeStageUsage } from "./client.js";
import { STARTER_CONVENTIONS, describeConventions, validateConventions } from "./conventions.js";
import { buildSystemPrompt } from "./prompt.js";
import { costUsd, zeroUsage } from "./pricing.js";

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

  // Metering has to price the TTL actually sent, or a 1h cache silently under-reports.
  it("prices a 1h cache write at 2x input and a 5m one at 1.25x", () => {
    const w = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1_000_000 };
    expect(costUsd(w, "claude-haiku-4-5", false, "5m")).toBeCloseTo(1.25);
    expect(costUsd(w, "claude-haiku-4-5", false, "1h")).toBeCloseTo(2.0);
    expect(costUsd(w, "claude-haiku-4-5", false)).toBeCloseTo(1.25);
  });
});

// ---------------------------------------------------------------------------------------------
// A nightly run has to land before the user wakes up. The Batch API is allowed 24h, so the
// decoder must be able to give up on the discount rather than hold the run open all day.

const reply = (body: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(body) }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 20 },
});

function inputPage(key: string): DecodePageInput {
  return {
    key,
    images: [new Uint8Array([1, 2, 3])],
    context: { notebookName: "N", notebookPath: "/N", pageIndex: 0, pageCount: 1, todayIso: "2026-09-10", timezone: "UTC" },
  };
}

function decoderWith(client: unknown, batchTimeoutMinutes: number): AnthropicDecoder {
  return new AnthropicDecoder(
    {
      model: "claude-sonnet-5",
      escalationModel: null,
      confidenceThreshold: 0.7,
      conventions: STARTER_CONVENTIONS,
      batchTimeoutMinutes,
    },
    client as never,
  );
}

describe("totalUsage", () => {
  it("counts pages per model, so an escalation over three pages does not look like fifty", () => {
    const stage = (model: string, mode: "standard" | "batch"): DecodeStageUsage => ({
      ...zeroUsage(),
      model,
      mode,
      pages: 1,
      cost_usd: 0.01,
    });
    const results: DecodePageResult[] = [
      { key: "a", extraction: null, raw: "", error: null, escalated: true, usage: [stage("sonnet", "standard"), stage("opus", "standard")] },
      { key: "b", extraction: null, raw: "", error: null, escalated: false, usage: [stage("sonnet", "standard")] },
      { key: "c", extraction: null, raw: "", error: null, escalated: false, usage: [stage("sonnet", "standard")] },
    ];
    const byModel = totalUsage(results);
    expect(byModel.get("sonnet|standard")?.pages).toBe(3);
    expect(byModel.get("opus|standard")?.pages).toBe(1);
  });
});

describe("batch decoding", () => {
  it("cancels a batch that outlives its deadline and finishes on the standard API", async () => {
    let cancelled = 0;
    let standardCalls = 0;
    const client = {
      messages: {
        create: async () => {
          standardCalls++;
          return reply(good);
        },
        batches: {
          create: async () => ({ id: "msgbatch_stuck", processing_status: "in_progress", request_counts: {} }),
          retrieve: async () => {
            throw new Error("must not keep polling past the deadline");
          },
          cancel: async () => {
            cancelled++;
            return {};
          },
          results: async () => {
            throw new Error("must not read results of a cancelled batch");
          },
        },
      },
    };
    const results = await decoderWith(client, 0).decodePages([inputPage("a"), inputPage("b")], "batch");
    expect(cancelled).toBe(1);
    expect(standardCalls).toBe(2);
    expect(results.map((r) => r.extraction?.tasks[0]?.text)).toEqual(["call Steve", "call Steve"]);
    // Metering has to show the full price actually paid, not the discount that was abandoned.
    expect(results.flatMap((r) => r.usage.map((u) => u.mode))).toEqual(["standard", "standard"]);
  });

  it("reads the batch results when it ends in time", async () => {
    let cancelled = 0;
    const client = {
      messages: {
        create: async () => {
          throw new Error("must not fall back while the batch is healthy");
        },
        batches: {
          create: async () => ({ id: "msgbatch_ok", processing_status: "ended", request_counts: {} }),
          retrieve: async () => ({ id: "msgbatch_ok", processing_status: "ended", request_counts: {} }),
          cancel: async () => {
            cancelled++;
            return {};
          },
          results: async () => [
            { custom_id: "p0", result: { type: "succeeded", message: reply(good) } },
            { custom_id: "p1", result: { type: "succeeded", message: reply(good) } },
          ],
        },
      },
    };
    const results = await decoderWith(client, 45).decodePages([inputPage("a"), inputPage("b")], "batch");
    expect(cancelled).toBe(0);
    expect(results.map((r) => r.key)).toEqual(["a", "b"]);
    expect(results.flatMap((r) => r.usage.map((u) => u.mode))).toEqual(["batch", "batch"]);
  });
});
