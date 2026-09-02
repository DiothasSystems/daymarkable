/**
 * Published Anthropic API prices, USD per million tokens. Recheck before pricing is committed
 * (ECONOMICS.md). Cache reads are 0.1x input, cache writes 1.25x input; Batch API is 0.5x.
 */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPerM: 1.0, outputPerM: 5.0 },
  "claude-sonnet-4-6": { inputPerM: 3.0, outputPerM: 15.0 },
  "claude-sonnet-5": { inputPerM: 2.0, outputPerM: 10.0 },
  "claude-opus-4-8": { inputPerM: 5.0, outputPerM: 25.0 },
  "claude-opus-5": { inputPerM: 5.0, outputPerM: 25.0 },
  "claude-fable-5-1": { inputPerM: 10.0, outputPerM: 50.0, cacheReadPerM: 0.25 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export function costUsd(usage: TokenUsage, model: string, batch: boolean): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const cacheRead = price.cacheReadPerM ?? price.inputPerM * 0.1;
  const cacheWrite = price.inputPerM * 1.25;
  let usd =
    (usage.input_tokens * price.inputPerM +
      usage.output_tokens * price.outputPerM +
      usage.cache_read_input_tokens * cacheRead +
      usage.cache_creation_input_tokens * cacheWrite) /
    1_000_000;
  if (batch) usd *= 0.5;
  return usd;
}

export function zeroUsage(): TokenUsage {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
  };
}
