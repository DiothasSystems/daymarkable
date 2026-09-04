/**
 * Transcription-only decoding, used by the model comparison tool. Separate from the extraction
 * path on purpose: it isolates how well a model READS the ink from how well it organises what
 * it read, which is what you want when judging accuracy by eye.
 *
 * Like everything that talks to Anthropic, it lives in this package (CLAUDE.md).
 */
import Anthropic from "@anthropic-ai/sdk";
import { costUsd, zeroUsage, type TokenUsage } from "./pricing.js";

export const TRANSCRIBE_SYSTEM = `You transcribe handwritten pages from a reMarkable tablet.

Return ONLY the transcription. No preamble, no summary, no commentary, no markdown fences.

Rules:
1. Transcribe every legible word in reading order, keeping the writer's own words. Never
   paraphrase, correct spelling, or tidy grammar.
2. Preserve the page's shape: line breaks, indentation, bullet and dash markers, numbering.
3. Keep the writer's markup visible: write * for an asterisk, and wrap underlined words in
   _underscores_. Note struck-through text as ~~text~~.
4. Use [illegible] for a word you cannot read, and [?word] when you are guessing.
5. Describe diagrams, arrows and sketches briefly in square brackets, e.g. [arrow to "budget"].
6. A page given as several images is ONE page split top to bottom with a small overlap;
   transcribe it as a single continuous page and do not repeat the overlapping lines.`;

export interface TranscriptionResult {
  model: string;
  text: string;
  usage: TokenUsage;
  costUsd: number;
  ms: number;
  error: string | null;
}

export interface TranscribeOptions {
  /** Names, companies and acronyms this writer uses; the single biggest accuracy lever. */
  lexicon?: readonly string[];
  /** A page this writer copied out, with the text they were copying: a letterform example. */
  calibration?: { text: string; image: Uint8Array } | null;
  context?: string;
  maxTokens?: number;
}

/** Transcribe one page (given as its vertical segments, top to bottom) with one model. */
export async function transcribePage(
  images: readonly Uint8Array[],
  model: string,
  client: Anthropic,
  opts: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const started = Date.now();
  const hints: string[] = [];
  if (opts.calibration) {
    hints.push(`The FIRST image is a sample this same writer copied by hand. It says exactly:
"""
${opts.calibration.text}
"""
Use it to learn their letterforms. Do not transcribe it; transcribe only the page that follows.`);
  }
  if (opts.context) hints.push(opts.context);
  if (opts.lexicon?.length) {
    hints.push(`Words this writer uses often (prefer these spellings when the ink is ambiguous): ${opts.lexicon.join(", ")}.`);
  }
  hints.push(opts.calibration ? "Transcribe the page after the sample." : "Transcribe this page.");
  try {
    const message = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4000,
      system: [{ type: "text", text: TRANSCRIBE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            ...(opts.calibration
              ? [
                  {
                    type: "image" as const,
                    source: { type: "base64" as const, media_type: "image/png" as const, data: Buffer.from(opts.calibration.image).toString("base64") },
                  },
                ]
              : []),
            ...images.map(
              (png): Anthropic.Messages.ImageBlockParam => ({
                type: "image",
                source: { type: "base64", media_type: "image/png", data: Buffer.from(png).toString("base64") },
              }),
            ),
            { type: "text", text: hints.join("\n") },
          ],
        },
      ],
    });
    const usage: TokenUsage = {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { model, text, usage, costUsd: costUsd(usage, model, false), ms: Date.now() - started, error: message.stop_reason === "max_tokens" ? "reply truncated" : null };
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : (err as Error).message;
    return { model, text: "", usage: zeroUsage(), costUsd: 0, ms: Date.now() - started, error: msg };
  }
}

export function anthropicClient(apiKey?: string): Anthropic {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}
