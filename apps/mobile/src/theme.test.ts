/**
 * UX-001: the app uses the same visual language as the web.
 *
 * "Looks the same" is not testable, but "is built from the same numbers" is. These are the Brand
 * values in CLAUDE.md and `design/design_handoff_daymarkable/`; if someone nudges a hex here to
 * make one screen sit better, this fails rather than the two products quietly diverging.
 */
import { describe, expect, it } from "vitest";
import { TOUCH_TARGET, card, color, radius, type } from "./theme.js";

describe("brand tokens", () => {
  it("matches the handoff palette exactly", () => {
    expect(color).toMatchObject({
      midnight: "#1E2A44",
      gold: "#C9973F",
      goldText: "#B8862F",
      parchment: "#F7F0E3",
      notepaper: "#FDFAF3",
      sunrise: "#F0DDA9",
      border: "#E3D9C2",
      borderStrong: "#D9CDB4",
      bodyMuted: "#4A5266",
      meta: "#8A7D5F",
    });
  });

  it("builds cards the way the style guide does", () => {
    expect(card).toMatchObject({ backgroundColor: color.notepaper, borderColor: color.border, borderWidth: 1, borderRadius: 6 });
    expect(radius.button).toBe(4);
  });

  it("sets section labels in the mono face with the guide's tracking", () => {
    expect(type.label.fontFamily).toBe("IBMPlexMono");
    expect(type.label.letterSpacing).toBeGreaterThanOrEqual(1.2);
  });

  it("uses a thumb's touch target, not the tablet's pen rule", () => {
    // The planner templates' ≥28px minimum is about a stylus on e-ink. A phone needs 44.
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });
});
