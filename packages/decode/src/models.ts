/**
 * Which models are allowed to read a user's handwriting.
 *
 * The model is a config value, not a constant (CLAUDE.md "Model usage") — but "configurable"
 * must not mean "silently able to pick a model we measured as the worst reader". Haiku 4.5 was
 * clearly the least accurate on real pages in September 2026 and was retired; a stale
 * DECODE_MODEL, a leftover rotation list, or an old per-user override could still name it, and
 * the only symptom would be a week of worse transcriptions. So the retirement is enforced here
 * rather than trusted to configuration.
 */

/** Baseline decoder. Every fallback lands here. */
export const BASELINE_DECODE_MODEL = "claude-sonnet-5";
/** Used only for pages the baseline reports low confidence on. */
export const ESCALATION_DECODE_MODEL = "claude-opus-5";

/** Measured as materially worse at reading handwriting; never used, however it is configured. */
export const RETIRED_DECODE_MODELS: readonly string[] = ["claude-haiku-4-5", "claude-haiku-4-5-20251001"];

export function isRetiredDecodeModel(model: string): boolean {
  return RETIRED_DECODE_MODELS.includes(model.trim());
}

export interface ResolvedDecodeModel {
  model: string;
  /** Set when a retired model was asked for; carries the message to log. */
  replaced: string | null;
}

/**
 * The model a run should actually use. A retired request is replaced by the baseline and
 * reported — never applied quietly, and never left to fail the run either.
 */
export function resolveDecodeModel(requested: string | null | undefined, fallback = BASELINE_DECODE_MODEL): ResolvedDecodeModel {
  const want = (requested ?? "").trim();
  if (!want) return { model: fallback, replaced: null };
  if (!isRetiredDecodeModel(want)) return { model: want, replaced: null };
  const to = isRetiredDecodeModel(fallback) ? BASELINE_DECODE_MODEL : fallback;
  return { model: to, replaced: `${want} is retired (measured worst on handwriting); using ${to}` };
}
