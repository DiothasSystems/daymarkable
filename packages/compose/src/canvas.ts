/**
 * A small drawing layer over pdf-lib in device pixels from the TOP-LEFT (1404 × 1872), so
 * templates read like the tablet screen and like the ×3 handoff mocks. Every planner page is
 * an input form: this draws the standard header, footer code, checkboxes, chips, and rules.
 */
import { PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { INK, PAGE_HEIGHT_PT, PAGE_WIDTH_PT, PAPER, RULE, SECONDARY, TERTIARY, px } from "./brand.js";
import { embedBrandFonts, type BrandFonts } from "./fonts.js";

/** Page geometry (mock 30px/34px padding ×3). */
export const PAD_X = 102;
export const PAD_TOP = 90;
export const PAD_BOTTOM = 84;
export const CONTENT_X = PAD_X;
export const CONTENT_W = 1404 - 2 * PAD_X;
export const CONTENT_RIGHT = CONTENT_X + CONTENT_W;
export const BODY_BOTTOM = 1872 - PAD_BOTTOM - 36;

export interface TextOpts {
  font: PDFFont;
  size: number; // device px
  color?: RGB;
  align?: "left" | "right" | "center";
  /** Letter spacing in em (mono labels use 0.15). */
  tracking?: number;
}

const ROSE_PATHS = ["M 36 2 L 41 12 L 36 18 L 31 12 Z", "M 36 70 L 41 60 L 36 54 L 31 60 Z", "M 2 36 L 12 31 L 18 36 L 12 41 Z", "M 70 36 L 60 31 L 54 36 L 60 41 Z"];

export class Canvas {
  constructor(
    readonly doc: PDFDocument,
    readonly page: PDFPage,
    readonly fonts: BrandFonts,
    readonly pageNumber: number,
  ) {
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH_PT, height: PAGE_HEIGHT_PT, color: PAPER });
  }

  /** Convert a top-origin y in px to pdf-lib's bottom-origin points. */
  y(topPx: number): number {
    return PAGE_HEIGHT_PT - px(topPx);
  }

  textWidth(text: string, font: PDFFont, sizePx: number, tracking = 0): number {
    return font.widthOfTextAtSize(text, px(sizePx)) / (72 / 226) + Math.max(0, text.length - 1) * tracking * sizePx;
  }

  /** Draw one line; (x, baseline) in px; returns the width in px. */
  text(text: string, x: number, baseline: number, opts: TextOpts): number {
    const size = px(opts.size);
    const color = opts.color ?? INK;
    const tracking = opts.tracking ?? 0;
    const width = this.textWidth(text, opts.font, opts.size, tracking);
    let xPx = x;
    if (opts.align === "right") xPx -= width;
    else if (opts.align === "center") xPx -= width / 2;
    if (tracking === 0) {
      this.page.drawText(text, { x: px(xPx), y: this.y(baseline), size, font: opts.font, color });
    } else {
      let cx = xPx;
      for (const ch of text) {
        this.page.drawText(ch, { x: px(cx), y: this.y(baseline), size, font: opts.font, color });
        cx += opts.font.widthOfTextAtSize(ch, size) / (72 / 226) + tracking * opts.size;
      }
    }
    return width;
  }

  /** Greedy word wrap into lines that fit maxWidth px. */
  wrap(text: string, font: PDFFont, sizePx: number, maxWidth: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (this.textWidth(candidate, font, sizePx) <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Truncate with an ellipsis to fit maxWidth px. */
  fit(text: string, font: PDFFont, sizePx: number, maxWidth: number): string {
    if (this.textWidth(text, font, sizePx) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && this.textWidth(`${t}…`, font, sizePx) > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  hline(x1: number, x2: number, y: number, thickness = 3, color: RGB = RULE): void {
    this.page.drawLine({ start: { x: px(x1), y: this.y(y) }, end: { x: px(x2), y: this.y(y) }, thickness: px(thickness), color });
  }

  vline(x: number, y1: number, y2: number, thickness = 3, color: RGB = RULE): void {
    this.page.drawLine({ start: { x: px(x), y: this.y(y1) }, end: { x: px(x), y: this.y(y2) }, thickness: px(thickness), color });
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; thickness?: number; radius?: number } = {}): void {
    const r = opts.radius ?? 0;
    if (r > 0) {
      const p = roundedPath(w, h, r);
      const base = { x: px(x), y: this.y(y), scale: px(1) };
      // pdf-lib fills black unless a borderColor is given without a color; build each shape explicitly.
      if (opts.fill && opts.stroke) this.page.drawSvgPath(p, { ...base, color: opts.fill, borderColor: opts.stroke, borderWidth: px(opts.thickness ?? 3) });
      else if (opts.fill) this.page.drawSvgPath(p, { ...base, color: opts.fill, borderWidth: 0 });
      else if (opts.stroke) this.page.drawSvgPath(p, { ...base, borderColor: opts.stroke, borderWidth: px(opts.thickness ?? 3) });
      return;
    }
    this.page.drawRectangle({
      x: px(x),
      y: this.y(y + h),
      width: px(w),
      height: px(h),
      ...(opts.fill ? { color: opts.fill } : {}),
      ...(opts.stroke ? { borderColor: opts.stroke, borderWidth: px(opts.thickness ?? 3) } : {}),
    });
  }

  /** A pen-checkable box (mock 12px ×3 = 36px, 1.5px ×3 border, 2px ×3 radius). */
  checkbox(x: number, y: number, size = 36, color: RGB = INK): number {
    this.rect(x, y, size, size, { stroke: color, thickness: 4.5, radius: 6 });
    return size;
  }

  /** Schedule chip: filled (confirmed) or outlined (tentative). Returns the chip width. */
  chip(text: string, x: number, y: number, opts: { filled: boolean; size?: number; maxWidth?: number }): number {
    const size = opts.size ?? 33;
    const font = this.fonts.uiSemibold;
    const label = opts.maxWidth ? this.fit(text, font, size, opts.maxWidth - 48) : text;
    const w = this.textWidth(label, font, size) + 48;
    const h = size + 18;
    if (opts.filled) this.rect(x, y, w, h, { fill: INK, radius: 6 });
    else this.rect(x, y, w, h, { stroke: INK, thickness: 4.5, radius: 6 });
    this.text(label, x + 24, y + h - 12 - (h - size) / 2 + size * 0.28, { font, size, color: opts.filled ? PAPER : INK });
    return w;
  }

  /** Small uppercase mono section label (mock 10px ×3, tracking 0.15em). Returns baseline advance. */
  label(text: string, x: number, y: number, opts: { align?: "left" | "right"; color?: RGB; size?: number } = {}): number {
    const size = opts.size ?? 30;
    this.text(text.toUpperCase(), x, y + size, { font: this.fonts.mono, size, color: opts.color ?? SECONDARY, tracking: 0.15, ...(opts.align ? { align: opts.align } : {}) });
    return size + 24;
  }

  /** The compass rose, monochrome. (x, y) top-left of its box. */
  rose(x: number, y: number, size: number, color: RGB = INK): void {
    const s = size / 72;
    const opts = { x: px(x), y: this.y(y), scale: px(s) };
    this.page.drawSvgPath("M 62 36 A 26 26 0 1 1 10 36 A 26 26 0 1 1 62 36 Z", { ...opts, borderColor: color, borderWidth: px(4 * s) });
    for (const p of ROSE_PATHS) this.page.drawSvgPath(p, { ...opts, color });
  }

  /** Header used on every page: serif title, mono subtitle, rose right, 2px×3 rule. Returns the content top. */
  header(title: string, subtitle: string): number {
    const f = this.fonts;
    const titleSize = 78;
    const titleBaseline = PAD_TOP + titleSize * 0.82;
    const maxTitle = CONTENT_W - 90 - 40;
    this.text(this.fit(title, f.display, titleSize, maxTitle), CONTENT_X, titleBaseline, { font: f.display, size: titleSize });
    this.text(subtitle, CONTENT_X, titleBaseline + 42, { font: f.mono, size: 30, color: SECONDARY, tracking: 0.02 });
    this.rose(CONTENT_RIGHT - 90, PAD_TOP + 4, 90);
    const ruleY = titleBaseline + 42 + 30;
    this.hline(CONTENT_X, CONTENT_RIGHT, ruleY, 6, INK);
    return ruleY + 42;
  }

  /** Footer: page code bottom-left (the decoder reads it back). */
  footer(pageCode: string): void {
    this.text(pageCode, CONTENT_X, 1872 - PAD_BOTTOM + 24, { font: this.fonts.mono, size: 24, color: TERTIARY });
  }
}

function roundedPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
}

export async function newDocument(): Promise<{ doc: PDFDocument; fonts: BrandFonts }> {
  const doc = await PDFDocument.create();
  doc.setProducer("dayMarkable");
  doc.setCreator("dayMarkable");
  const fonts = await embedBrandFonts(doc);
  return { doc, fonts };
}

export function addPage(doc: PDFDocument, fonts: BrandFonts, pageNumber: number): Canvas {
  const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
  return new Canvas(doc, page, fonts, pageNumber);
}
