import Anthropic from "@anthropic-ai/sdk";
import type { UserInkConventions } from "./conventions.js";
import { buildPageContextText, buildSystemPrompt, type PageContext } from "./prompt.js";
import { addUsage, costUsd, zeroUsage, type CacheTtl, type TokenUsage } from "./pricing.js";
import { PageExtractionSchema, type PageExtraction } from "./schema.js";

/** Model is a CONFIG value, never a constant (CLAUDE.md "Model usage"). */
export interface DecodeConfig {
  model: string;
  /** Re-run low-confidence pages on this model; null disables escalation. */
  escalationModel: string | null;
  confidenceThreshold: number;
  conventions: UserInkConventions;
  /** Names and acronyms this writer uses; injected into the cached system prompt. */
  lexicon?: readonly string[];
  /** Calibration few-shot: a page this writer copied out, with the text they were copying. */
  calibration?: { text: string; image: Uint8Array } | null;
  maxTokens?: number;
  /** Parallelism for standard-API calls (on-demand runs). */
  concurrency?: number;
  /**
   * How long to wait on a batch before giving up on the 50% discount. The Batch API is
   * allowed 24h, but a 3AM run has to land before the user wakes up — past this deadline the
   * batch is cancelled and its pages are re-sent on the standard API at full price. Better a
   * night that costs a few cents more than a night with no notebooks on the tablet.
   */
  batchTimeoutMinutes?: number;
  /** Progress line during long waits. Counts and ids only, never page content (rule 5). */
  log?: (message: string) => void;
  /**
   * Lifetime of the cached prefix (system prompt, conventions, lexicon, calibration sample).
   *
   * "1h" by default, and measured rather than guessed: on 2026-09-10 a day of standard-API runs
   * wrote the ~8.5k-token prefix twelve times to serve fifty pages, because 5 minutes expires
   * partway through a run. A 1h write costs 2x input instead of 1.25x, but it converts the
   * repeat writes into 0.1x reads, which is cheaper from the second page onward. It also
   * survives the Batch API's queue spread, where a 5m window is luck rather than a strategy.
   */
  cacheTtl?: CacheTtl;
}

export interface DecodePageInput {
  /** Caller's key (e.g. `${docId}/${pageId}`), echoed back. */
  key: string;
  /** One PNG per vertical segment of the page, top to bottom (tall pages are tiled). */
  images: Uint8Array[];
  context: PageContext;
}

export interface DecodeStageUsage extends TokenUsage {
  model: string;
  mode: DecodeMode;
  cost_usd: number;
  /** Pages this model actually read. One per page here; summed by `totalUsage`. */
  pages: number;
}

export interface DecodePageResult {
  key: string;
  extraction: PageExtraction | null;
  /** Raw model text, kept only in memory for debugging; never logged. */
  raw: string;
  error: string | null;
  /** Usage per stage (initial + optional escalation). */
  usage: DecodeStageUsage[];
  escalated: boolean;
}

export type DecodeMode = "standard" | "batch";

export interface Decoder {
  decodePages(pages: readonly DecodePageInput[], mode: DecodeMode): Promise<DecodePageResult[]>;
}

/** Extract the first top-level JSON object from a model reply. */
export function parseExtraction(text: string): { extraction: PageExtraction | null; error: string | null } {
  let body = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  if (fence?.[1]) body = fence[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return { extraction: null, error: "no JSON object in reply" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    return { extraction: null, error: `JSON parse failed: ${(err as Error).message}` };
  }
  const result = PageExtractionSchema.safeParse(parsed);
  if (!result.success) {
    return { extraction: null, error: `schema validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { extraction: result.data, error: null };
}

function toUsage(u: Anthropic.Messages.Usage): TokenUsage {
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
}

function textOf(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Batch poll cadence, progress-report cadence, and how many consecutive poll failures to ride out. */
const BATCH_POLL_MS = 30_000;
const BATCH_REPORT_MS = 5 * 60_000;
const BATCH_POLL_MISSES = 5;
const DEFAULT_BATCH_TIMEOUT_MINUTES = 45;

export class AnthropicDecoder implements Decoder {
  private readonly client: Anthropic;
  private readonly system: string;
  private readonly maxTokens: number;
  private readonly batchTimeoutMs: number;
  private readonly cacheTtl: CacheTtl;

  constructor(
    private readonly config: DecodeConfig,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
    this.batchTimeoutMs = (config.batchTimeoutMinutes ?? DEFAULT_BATCH_TIMEOUT_MINUTES) * 60_000;
    this.cacheTtl = config.cacheTtl ?? "1h";
    this.system = buildSystemPrompt({
      conventions: config.conventions,
      ...(config.lexicon ? { lexicon: config.lexicon } : {}),
      calibrationText: config.calibration?.text ?? null,
    });
    this.maxTokens = config.maxTokens ?? 8000;
  }

  private params(page: DecodePageInput, model: string): Anthropic.Messages.MessageCreateParamsNonStreaming {
    return {
      model,
      max_tokens: this.maxTokens,
      system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral", ttl: this.cacheTtl } }],
      messages: [
        {
          role: "user",
          content: [
            // The calibration sample leads every request and is cached, so the model sees this
            // writer's letterforms next to their known text before reading the real page.
            ...(this.config.calibration
              ? [
                  {
                    type: "image" as const,
                    source: { type: "base64" as const, media_type: "image/png" as const, data: Buffer.from(this.config.calibration.image).toString("base64") },
                    cache_control: { type: "ephemeral" as const, ttl: this.cacheTtl },
                  },
                ]
              : []),
            ...page.images.map(
              (png): Anthropic.Messages.ImageBlockParam => ({
                type: "image",
                source: { type: "base64", media_type: "image/png", data: Buffer.from(png).toString("base64") },
              }),
            ),
            { type: "text", text: buildPageContextText(page.context, page.images.length) },
          ],
        },
      ],
    };
  }

  private needsEscalation(r: DecodePageResult): boolean {
    if (!this.config.escalationModel || this.config.escalationModel === this.config.model) return false;
    if (!r.extraction) return true;
    if (r.extraction.page_kind === "blank") return false;
    return r.extraction.needs_escalation || r.extraction.overall_confidence < this.config.confidenceThreshold;
  }

  async decodePages(pages: readonly DecodePageInput[], mode: DecodeMode): Promise<DecodePageResult[]> {
    const first = await this.runPass(pages, this.config.model, mode);
    const byKey = new Map(first.map((r) => [r.key, r] as const));
    const retry = pages.filter((p) => {
      const r = byKey.get(p.key);
      return r ? this.needsEscalation(r) : false;
    });
    if (retry.length > 0 && this.config.escalationModel) {
      const second = await this.runPass(retry, this.config.escalationModel, mode);
      for (const r of second) {
        const prev = byKey.get(r.key);
        if (!prev) continue;
        // Keep whichever read is better; always keep both usages for metering.
        const better = r.extraction && (!prev.extraction || r.extraction.overall_confidence >= prev.extraction.overall_confidence);
        byKey.set(r.key, {
          key: r.key,
          extraction: better ? r.extraction : prev.extraction,
          raw: better ? r.raw : prev.raw,
          error: better ? r.error : prev.error,
          usage: [...prev.usage, ...r.usage],
          escalated: true,
        });
      }
    }
    return pages.map((p) => byKey.get(p.key)!);
  }

  private async runPass(pages: readonly DecodePageInput[], model: string, mode: DecodeMode): Promise<DecodePageResult[]> {
    if (pages.length === 0) return [];
    return mode === "batch" ? this.runBatch(pages, model) : this.runStandard(pages, model);
  }

  private finish(key: string, message: Anthropic.Messages.Message, model: string, mode: DecodeMode): DecodePageResult {
    const raw = textOf(message);
    const usage = toUsage(message.usage);
    const stage: DecodeStageUsage = { ...usage, model, mode, pages: 1, cost_usd: costUsd(usage, model, mode === "batch", this.cacheTtl) };
    if (message.stop_reason === "refusal") {
      return { key, extraction: null, raw, error: "model refused", usage: [stage], escalated: false };
    }
    if (message.stop_reason === "max_tokens") {
      return { key, extraction: null, raw, error: "reply truncated (max_tokens)", usage: [stage], escalated: false };
    }
    const { extraction, error } = parseExtraction(raw);
    return { key, extraction, raw, error, usage: [stage], escalated: false };
  }

  private failed(key: string, model: string, mode: DecodeMode, err: unknown): DecodePageResult {
    const msg = err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : (err as Error).message;
    const stage: DecodeStageUsage = { ...zeroUsage(), model, mode, pages: 1, cost_usd: 0 };
    return { key, extraction: null, raw: "", error: msg, usage: [stage], escalated: false };
  }

  private async runStandard(pages: readonly DecodePageInput[], model: string): Promise<DecodePageResult[]> {
    const concurrency = Math.max(1, this.config.concurrency ?? 4);
    const results: DecodePageResult[] = new Array(pages.length);
    let next = 0;
    const worker = async () => {
      while (next < pages.length) {
        const i = next++;
        const page = pages[i]!;
        try {
          const message = await this.client.messages.create(this.params(page, model));
          results[i] = this.finish(page.key, message, model, "standard");
        } catch (err) {
          results[i] = this.failed(page.key, model, "standard", err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
    return results;
  }

  /**
   * Poll until the batch ends. Returns false if the deadline passed first, so the caller can
   * fall back. Transient poll failures are ridden out — a network blip must not discard a
   * batch that has already been paid for.
   */
  private async awaitBatch(batch: Anthropic.Messages.MessageBatch, pageCount: number): Promise<boolean> {
    const log = this.config.log ?? (() => {});
    const id = batch.id.slice(-8);
    const deadline = Date.now() + this.batchTimeoutMs;
    let status = batch;
    let misses = 0;
    let nextReport = Date.now() + BATCH_REPORT_MS;
    while (status.processing_status !== "ended") {
      if (Date.now() >= deadline) {
        log(`decode: batch ${id} still ${status.processing_status} after ${Math.round(this.batchTimeoutMs / 60_000)}m — cancelling and re-sending ${pageCount} page(s) on the standard API`);
        return false;
      }
      await new Promise((r) => setTimeout(r, BATCH_POLL_MS));
      try {
        status = await this.client.messages.batches.retrieve(batch.id);
        misses = 0;
      } catch (err) {
        if (++misses > BATCH_POLL_MISSES) throw err;
        continue;
      }
      if (Date.now() >= nextReport) {
        const c = status.request_counts;
        log(`decode: batch ${id} ${status.processing_status}, ${c.succeeded}/${pageCount} done, ${c.processing} processing, ${c.errored} errored`);
        nextReport = Date.now() + BATCH_REPORT_MS;
      }
    }
    return true;
  }

  private async runBatch(pages: readonly DecodePageInput[], model: string): Promise<DecodePageResult[]> {
    const ids = pages.map((_, i) => `p${i}`);
    const batch = await this.client.messages.batches.create({
      requests: pages.map((page, i) => ({ custom_id: ids[i]!, params: this.params(page, model) })),
    });
    // A batch that never ends must not hold the run open forever: past the deadline, cancel it
    // and pay standard-API price so the night still produces notebooks.
    if (!(await this.awaitBatch(batch, pages.length))) {
      await this.client.messages.batches.cancel(batch.id).catch(() => {});
      return this.runStandard(pages, model);
    }
    const byId = new Map<string, DecodePageResult>();
    for await (const result of await this.client.messages.batches.results(batch.id)) {
      const i = Number(result.custom_id.slice(1));
      const page = pages[i];
      if (!page) continue;
      if (result.result.type === "succeeded") {
        byId.set(result.custom_id, this.finish(page.key, result.result.message, model, "batch"));
      } else {
        const why = result.result.type === "errored" ? result.result.error.type : result.result.type;
        byId.set(result.custom_id, this.failed(page.key, model, "batch", new Error(`batch item ${why}`)));
      }
    }
    return pages.map((page, i) => byId.get(ids[i]!) ?? this.failed(page.key, model, "batch", new Error("missing batch result")));
  }
}

export function totalUsage(results: readonly DecodePageResult[]): Map<string, DecodeStageUsage> {
  const out = new Map<string, DecodeStageUsage>();
  for (const r of results) {
    for (const s of r.usage) {
      const key = `${s.model}|${s.mode}`;
      const prev = out.get(key) ?? { ...zeroUsage(), model: s.model, mode: s.mode, cost_usd: 0, pages: 0 };
      out.set(key, { ...addUsage(prev, s), model: s.model, mode: s.mode, cost_usd: prev.cost_usd + s.cost_usd, pages: prev.pages + s.pages });
    }
  }
  return out;
}
