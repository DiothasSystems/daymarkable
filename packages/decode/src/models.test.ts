import { describe, expect, it } from "vitest";
import { BASELINE_DECODE_MODEL, ESCALATION_DECODE_MODEL, isRetiredDecodeModel, resolveDecodeModel } from "./models.js";

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
