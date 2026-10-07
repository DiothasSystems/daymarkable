/**
 * Write one real news edition and report what it cost.
 *
 *   pnpm news:cost                 # the whole list, as a night writes it
 *   pnpm news:cost "ai|nfl|telecom"  # just these topic ids, pipe-separated
 *
 * This exists because the brief is the only part of ScriptumIQ whose price is not only tokens. Web
 * search is billed per search, `WEB_SEARCH_USD_PER_SEARCH` is a figure copied from Anthropic's
 * published pricing rather than measured, and the search RESULTS come back as input tokens — which
 * is what actually dominates. The edition is a fixed nightly cost (packages/core newsTopics.ts):
 * estimated at about $0.67 for 37 topics, which this is how to check.
 *
 * Re-run it before committing to a price (ECONOMICS.md), and whenever the model, the list or the
 * search pricing changes. It spends real money — the whole list is well under a dollar.
 */
import { NEWS_TOPICS } from "@daymarkable/core";
import { gatherEdition, headlineCount } from "@daymarkable/news";
import { loadConfig } from "@daymarkable/pipeline";
import Anthropic from "@anthropic-ai/sdk";

const config = loadConfig();
if (!config.anthropicApiKey) {
  console.error("no key");
  process.exit(1);
}
const client = new Anthropic({ apiKey: config.anthropicApiKey });
const only = process.argv[2]?.split("|");
const topics = only ? NEWS_TOPICS.filter((t) => only.includes(t.id)) : NEWS_TOPICS;

console.log(`model=${config.newsModel} topics=${topics.length}`);
const t0 = Date.now();
const r = await gatherEdition(topics, client, { model: config.newsModel, log: (m: string) => console.log(`  ${m}`) });
const u = r.usage;
console.log(
  `RESULT $${r.costUsd.toFixed(4)}  searches=${r.searches}  in=${u.input_tokens} out=${u.output_tokens}  ` +
    `topics=${r.sections.length}/${topics.length} headlines=${headlineCount(r)}  ${Math.round((Date.now() - t0) / 1000)}s` +
    (r.failedTopics.length ? `  FAILED: ${r.failedTopics.join(", ")}` : "") +
    (r.error ? `  ERROR: ${r.error}` : ""),
);
