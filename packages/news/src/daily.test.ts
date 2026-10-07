import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ITEMS_PER_TOPIC, TOPICS_PER_REQUEST, chunk, gatherEdition, headlineCount, parseSections, webSearchToolType, type EditionTopic } from "./daily.js";

describe("parseSections", () => {
  const ids = ["telecom", "nfl"];

  it("reads the sections by topic id", () => {
    const text = `{"sections":[{"topic":"telecom","items":[{"headline":"FCC opens spectrum auction","summary":"The commission set the upper C-band auction for March.","source":"Reuters"}]}]}`;
    const r = parseSections(text, ids);
    expect(r.error).toBeNull();
    expect(r.sections).toEqual([{ topicId: "telecom", items: [{ headline: "FCC opens spectrum auction", summary: "The commission set the upper C-band auction for March.", source: "Reuters" }] }]);
  });

  it("tolerates prose or fences around the JSON", () => {
    const text = 'Here is the brief:\n```json\n{"sections":[{"topic":"telecom","items":[]}]}\n```\nDone.';
    expect(parseSections(text, ids).sections).toHaveLength(1);
  });

  /** A section for a topic nobody asked for is a misread or the search steering the answer. */
  it("discards a section for a topic that was not asked for", () => {
    const r = parseSections(`{"sections":[{"topic":"crypto","items":[{"headline":"Buy now","summary":"x"}]}]}`, ids);
    expect(r.sections).toHaveLength(0);
    expect(r.error).toMatch(/no section matched/);
  });

  it("accepts an empty topic rather than padding it", () => {
    const r = parseSections(`{"sections":[{"topic":"nfl","items":[]}]}`, ids);
    expect(r.error).toBeNull();
    expect(headlineCount(r)).toBe(0);
  });

  it("normalises a missing or literal-null source, and drops a row with no headline", () => {
    const text = `{"sections":[{"topic":"telecom","items":[{"headline":"A","summary":"B"},{"headline":"C","summary":"D","source":"null"},{"headline":"","summary":"orphan"}]}]}`;
    const items = parseSections(text, ids).sections[0]!.items;
    expect(items.map((i) => i.source)).toEqual([null, null]);
  });

  it("truncates rather than letting one headline take the page", () => {
    const text = JSON.stringify({ sections: [{ topic: "telecom", items: [{ headline: "h".repeat(400), summary: "s".repeat(900) }] }] });
    const item = parseSections(text, ids).sections[0]!.items[0]!;
    expect(item.headline.length).toBe(140);
    expect(item.summary.length).toBe(400);
  });

  it("reports a reply it could not read rather than returning an empty brief as success", () => {
    expect(parseSections("", ids).error).toMatch(/no JSON/);
    expect(parseSections("{ not json", ids).error).toMatch(/no JSON|parse failed/);
    expect(parseSections('{"ok":true}', ids).error).toMatch(/no sections array/);
  });
});

/** A stand-in for the API: answers each request with one headline per topic it was asked about. */
function fakeClient(fail: (topicIds: string[]) => boolean = () => false) {
  const calls: Array<{ maxUses: number; topicIds: string[] }> = [];
  const client = {
    messages: {
      create: async (req: { tools: Array<{ max_uses: number }>; messages: Array<{ content: string }> }) => {
        const topicIds = [...req.messages[0]!.content.matchAll(/^- ([a-z-]+):/gm)].map((m) => m[1]!);
        calls.push({ maxUses: req.tools[0]!.max_uses, topicIds });
        if (fail(topicIds)) throw new Error("overloaded");
        const sections = topicIds.map((id) => ({ topic: id, items: [{ headline: `News about ${id}`, summary: "It happened.", source: "Wire" }] }));
        return {
          stop_reason: "end_turn",
          usage: { input_tokens: 1000, output_tokens: 100 },
          content: [
            ...topicIds.map(() => ({ type: "web_search_tool_result", content: [] })),
            { type: "text", text: JSON.stringify({ sections }) },
          ],
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const topics: EditionTopic[] = Array.from({ length: 14 }, (_, i) => ({ id: `t-${String.fromCharCode(97 + i)}`, label: `Topic ${i}`, brief: "about it" }));

describe("the night's edition", () => {
  it("goes out in requests of six, one search each, and comes back in the list's order", async () => {
    const { client, calls } = fakeClient();
    const e = await gatherEdition(topics, client);
    expect(calls.map((c) => c.topicIds.length)).toEqual([6, 6, 2]);
    expect(calls.map((c) => c.maxUses)).toEqual([6, 6, 2]);
    expect(e.sections.map((s) => s.topicId)).toEqual(topics.map((t) => t.id));
    expect(e.searches).toBe(14);
    expect(e.error).toBeNull();
    expect(e.costUsd).toBeGreaterThan(0.14);
  });

  it("keeps the topics that came back when one request fails, and names the ones that did not", async () => {
    const { client } = fakeClient((ids) => ids.includes("t-g"));
    const e = await gatherEdition(topics, client);
    expect(e.sections).toHaveLength(8);
    expect(e.failedTopics).toEqual(["t-g", "t-h", "t-i", "t-j", "t-k", "t-l"]);
    expect(e.error).toBeNull();
  });

  it("is an error only when nothing came back at all", async () => {
    const { client } = fakeClient(() => true);
    const e = await gatherEdition(topics, client);
    expect(e.sections).toEqual([]);
    expect(e.error).toBe("overloaded");
  });

  it("splits evenly", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(TOPICS_PER_REQUEST).toBe(6);
    expect(ITEMS_PER_TOPIC).toBe(3);
  });
});

describe("the search tool", () => {
  /**
   * Haiku has no programmatic tool calling, and the 2026 web-search variant needs it — a real 400,
   * not a degradation. Every model here must be asked for a tool it can actually use.
   */
  it("asks each model for a web-search tool it supports", () => {
    expect(webSearchToolType("claude-haiku-4-5")).toBe("web_search_20250305");
    expect(webSearchToolType("claude-haiku-4-5-20251001")).toBe("web_search_20250305");
    expect(webSearchToolType("claude-sonnet-5")).toBe("web_search_20260209");
    expect(webSearchToolType("claude-opus-5")).toBe("web_search_20260209");
    expect(webSearchToolType("something-new")).toBe("web_search_20250305");
  });
});
