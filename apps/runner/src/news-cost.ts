/**
 * Run one real overnight brief and report what it cost.
 *
 *   pnpm news:cost                      # one topic
 *   pnpm news:cost "rates|AI|Arsenal"   # pipe-separated
 *
 * This exists because the brief is the only part of ScriptumIQ whose price is not tokens. Web
 * search is billed per search, `WEB_SEARCH_USD_PER_SEARCH` is a figure copied from Anthropic's
 * published pricing rather than measured, and the search RESULTS come back as input tokens — which
 * is what actually dominates: a single-topic brief measured on 2026-09-18 read 163,471 cached input
 * tokens and cost $0.1873, of which only $0.08 was search fees.
 *
 * Re-run it before committing to a price (ECONOMICS.md), and whenever the model or the search
 * pricing changes. It spends real money, a few cents a go.
 */
import { gatherDailyUpdate } from "@daymarkable/news";
import { loadConfig } from "@daymarkable/pipeline";
import Anthropic from "@anthropic-ai/sdk";

const config = loadConfig();
if (!config.anthropicApiKey) {
  console.error("no key");
  process.exit(1);
}
const client = new Anthropic({ apiKey: config.anthropicApiKey });
const topics = (process.argv[2] ?? "broadband hardware").split("|");

console.log(`model=${config.newsModel} topics=${topics.length}`);
const t0 = Date.now();
const r = await gatherDailyUpdate(topics, client, { model: config.newsModel, log: (m) => console.log(`  ${m}`) });
const u = r.usage;
console.log(
  `RESULT $${r.costUsd.toFixed(4)}  searches=${r.searches}  in=${u.input_tokens} out=${u.output_tokens} ` +
    `cacheR=${u.cache_read_input_tokens} cacheW=${u.cache_creation_input_tokens}  ` +
    `sections=${r.sections.length} items=${r.sections.reduce((n, s) => n + s.items.length, 0)}  ${Math.round((Date.now() - t0) / 1000)}s` +
    (r.error ? `  ERROR: ${r.error}` : ""),
);
