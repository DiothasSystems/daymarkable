/**
 * dayMarkable brand constants for typeset output (CLAUDE.md "Brand", design/ handoff).
 * Tablet pages are e-ink grayscale only; the color tokens exist for the web and email.
 */
import { rgb, type RGB } from "pdf-lib";

export const BRAND = {
  name: "dayMarkable",
  tagline: "Note to Action Organizer",
  colors: {
    midnight: "#1E2A44",
    gold: "#C9973F",
    goldText: "#B8862F",
    parchment: "#F7F0E3",
    notepaper: "#FDFAF3",
    sunrise: "#F0DDA9",
    border: "#E3D9C2",
  },
  fonts: {
    display: "Source Serif 4",
    ui: "Public Sans",
    data: "IBM Plex Mono",
  },
} as const;

/** reMarkable 2 / Paper Pro portrait canvas in device pixels and the PDF point conversion. */
export const DEVICE = {
  widthPx: 1404,
  heightPx: 1872,
  dpi: 226,
} as const;

/** The handoff mocks are 468×624; every measurement there is ×3 on the device. */
export const MOCK_SCALE = 3;
export const PT_PER_PX = 72 / DEVICE.dpi;
export const px = (n: number): number => n * PT_PER_PX;
export const PAGE_WIDTH_PT = px(DEVICE.widthPx);
export const PAGE_HEIGHT_PT = px(DEVICE.heightPx);

/** Minimum pen-checkable box (CLAUDE.md rule 6: >= 28px). Mock: 12px ×3. */
export const CHECKBOX_PX = 36;

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** E-ink grayscale tokens from the style guide. */
export const PAPER: RGB = hex("#FBFBF9");
export const INK: RGB = hex("#1A1A1A");
export const SECONDARY: RGB = hex("#6E6E6E");
export const TERTIARY: RGB = hex("#9A9A9A");
export const RULE: RGB = hex("#D8D4C8");
export const SHADE: RGB = hex("#F1EFE7");
export const SHADE_BORDER: RGB = hex("#E5E1D4");
export const CARRIED: RGB = hex("#4A4A4A");
export const WHITE: RGB = rgb(1, 1, 1);

/** Backwards-compatible aliases used by older sections. */
export const INK_60: RGB = SECONDARY;
export const INK_30: RGB = RULE;
