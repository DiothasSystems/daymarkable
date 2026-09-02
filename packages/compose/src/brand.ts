/**
 * dayMarkable brand constants for anything typeset (CLAUDE.md "Brand").
 * Tablet output is high-contrast monochrome: Paper/Beacon exist here for the web and email,
 * planner pages use ink on white only.
 */
import { rgb, type RGB } from "pdf-lib";

export const BRAND = {
  name: "dayMarkable",
  tagline: "Write it down. Wake up organized.",
  colors: {
    paper: "#F7F4EE",
    ink: "#211F1A",
    beacon: "#CE4B18",
  },
  fonts: {
    display: "Instrument Serif",
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

export const PT_PER_PX = 72 / DEVICE.dpi;
export const px = (n: number): number => n * PT_PER_PX;
export const PAGE_WIDTH_PT = px(DEVICE.widthPx);
export const PAGE_HEIGHT_PT = px(DEVICE.heightPx);

/** Minimum pen-checkable box (CLAUDE.md rule 6: >= 28px). */
export const CHECKBOX_PX = 32;

export const INK: RGB = rgb(0.13, 0.12, 0.10);
export const INK_60: RGB = rgb(0.45, 0.45, 0.45);
export const INK_30: RGB = rgb(0.72, 0.72, 0.72);
export const WHITE: RGB = rgb(1, 1, 1);
