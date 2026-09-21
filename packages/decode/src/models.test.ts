import { describe, expect, it } from "vitest";
import {
  resolveEscalationModel,
  clampEscalationThreshold,
  DEFAULT_ESCALATION_THRESHOLD, BASELINE_DECODE_MODEL, ESCALATION_DECODE_MODEL, isRetiredDecodeModel, resolveDecodeModel } from "./models.js";

describe("resolveDecodeModel", () => {
  it("passes a current model through untouched", () => {
    expect(resolveDecodeModel("claude-sonnet-5")).toEqual({ model: "claude-sonnet-5", replaced: null });
    expect(resolveDecodeModel("claude-opus-5").replaced).toBeNull();
  });

  it("replaces a retired model and says so", () => {
    // This is the bug it exists for: a stale DECODE_MODEL decoded a week of pages on Haiku,
    // and the only sign was one line in the run log.
    const r = resolveDecodeModel("claude-haiku-4-5");
    expect(r.model).toBe(BASELINE_DECODE_MODEL);
    expect(r.replaced).toMatch(/retired/);
  });

  it("replaces a dated retired alias too", () => {
    expect(resolveDecodeModel("claude-haiku-4-5-20251001").model).toBe(BASELINE_DECODE_MODEL);
  });

  it("falls back when nothing is requested", () => {
    expect(resolveDecodeModel(null).model).toBe(BASELINE_DECODE_MODEL);
    expect(resolveDecodeModel("  ").model).toBe(BASELINE_DECODE_MODEL);
    expect(resolveDecodeModel(undefined, ESCALATION_DECODE_MODEL).model).toBe(ESCALATION_DECODE_MODEL);
  });

  it("never lands on a retired model even if the fallback is one", () => {
    const r = resolveDecodeModel("claude-haiku-4-5", "claude-haiku-4-5");
    expect(r.model).toBe(BASELINE_DECODE_MODEL);
    expect(isRetiredDecodeModel(r.model)).toBe(false);
  });

  it("does not treat an unknown model as retired — the list is a config value, not a whitelist", () => {
    expect(resolveDecodeModel("claude-something-new-6").model).toBe("claude-something-new-6");
  });
});

describe("escalation threshold and model", () => {
  it("defaults to half, and clamps to a usable range", () => {
    expect(DEFAULT_ESCALATION_THRESHOLD).toBe(0.5);
    expect(clampEscalationThreshold(null)).toBe(0.5);
    expect(clampEscalationThreshold(undefined)).toBe(0.5);
    expect(clampEscalationThreshold(0.7)).toBe(0.7);
    // Zero is a real setting — never escalate — so it survives rather than falling back.
    expect(clampEscalationThreshold(0)).toBe(0);
    expect(clampEscalationThreshold(-1)).toBe(0);
    expect(clampEscalationThreshold(2)).toBe(0.95);
    expect(clampEscalationThreshold(Number.NaN)).toBe(0.5);
  });

  it("takes an account's override over the operator default", () => {
    expect(clampEscalationThreshold(0.8, 0.5)).toBe(0.8);
    expect(clampEscalationThreshold(null, 0.3)).toBe(0.3);
  });

  /**
   * The accident that switched escalation off on the production box, in full: the escalation model
   * was set to Sonnet while the baseline was Haiku, Haiku was retired and silently replaced by
   * Sonnet, and the two became equal — at which point a second pass is the same model giving the
   * same answer at twice the price, so it was skipped. Nothing said so.
   */
  it("rescues an escalation model that has become the baseline", () => {
    const r = resolveEscalationModel("claude-sonnet-5", "claude-sonnet-5");
    expect(r.model).toBe("claude-opus-5");
    expect(r.replaced).toMatch(/cannot escalate/);
  });

  it("leaves a genuine escalation model alone", () => {
    expect(resolveEscalationModel("claude-opus-5", "claude-sonnet-5")).toEqual({ model: "claude-opus-5", replaced: null });
  });

  /** Empty means the operator switched escalation off, which is a choice and must be respected. */
  it("keeps escalation off when it was turned off on purpose", () => {
    expect(resolveEscalationModel(null, "claude-sonnet-5")).toEqual({ model: null, replaced: null });
  });

  it("still refuses a retired model for the second pass", () => {
    expect(resolveEscalationModel("claude-haiku-4-5", "claude-sonnet-5").model).toBe("claude-opus-5");
  });
});
