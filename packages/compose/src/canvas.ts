/**
 * A tiny drawing layer over pdf-lib that works in device pixels from the TOP-LEFT, so
 * templates read like the tablet screen (1404 x 1872). Every planner page is an input form,
 * so this also draws the standard checkbox and the margin column.
 */
import { PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { BRAND, CHECKBOX_PX, INK, INK_30, INK_60, PAGE_HEIGHT_PT, PAGE_WIDTH_PT, WHITE, px } from "./brand.js";
import { embedBrandFonts, type BrandFonts } from "./fonts.js";

export interface TextOpts {
  font: PDFFont;
  size: number; // device px
  color?: RGB;
  align?: "left" | "right" | "center";
}

export class Canvas {
  readonly pageNumber: number;
  constructor(
    readonly doc: PDFDocument,
    readonly page: PDFPage,
    readonly fonts: BrandFonts,
    pageNumber: number,
  ) {
    this.pageNumber = pageNumber;
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH_PT, height: PAGE_HEIGHT_PT, color: WHITE });
  }

  /** Convert a top-origin y in px to pdf-lib's bottom-origin points. */
  y(topPx: number): number {
    return PAGE_HEIGHT_PT - px(topPx);
  }

  textWidth(text: string, font: PDFFont, sizePx: number): number {
    return font.widthOfTextAtSize(text, px(sizePx)) / (72 / 226);
  }

  /** Draw a single line; (x, baselineTop) in px; returns width in px. */
  text(text: string, x: number, baseline: number, opts: TextOpts): number {
    const size = px(opts.size);
    const width = opts.font.widthOfTextAtSize(text, size);
    let xPt = px(x);
    if (opts.align === "right") xPt -= width;
    else if (opts.align === "center") xPt -= width / 2;
    this.page.drawText(text, { x: xPt, y: this.y(baseline), size, font: opts.font, color: opts.color ?? INK });
    return width / (72 / 226);
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

  /** Draw wrapped text; returns the number of lines drawn. */
  paragraph(text: string, x: number, firstBaseline: number, maxWidth: number, lineHeight: number, opts: TextOpts): number {
    const lines = this.wrap(text, opts.font, opts.size, maxWidth);
    lines.forEach((l, i) => this.text(l, x, firstBaseline + i * lineHeight, opts));
    return lines.length;
  }

  hline(x1: number, x2: number, y: number, thickness = 1.5, color: RGB = INK_30): void {
    this.page.drawLine({
      start: { x: px(x1), y: this.y(y) },
      end: { x: px(x2), y: this.y(y) },
      thickness: px(thickness),
      color,
    });
  }

  vline(x: number, y1: number, y2: number, thickness = 1.5, color: RGB = INK_30): void {
    this.page.drawLine({
      start: { x: px(x), y: this.y(y1) },
      end: { x: px(x), y: this.y(y2) },
      thickness: px(thickness),
      color,
    });
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; thickness?: number } = {}): void {
    this.page.drawRectangle({
      x: px(x),
      y: this.y(y + h),
      width: px(w),
      height: px(h),
      ...(opts.fill ? { color: opts.fill } : {}),
      ...(opts.stroke ? { borderColor: opts.stroke, borderWidth: px(opts.thickness ?? 2) } : {}),
    });
  }

  /** A pen-checkable box (>= 28px). Returns its size. */
  checkbox(x: number, y: number, size = CHECKBOX_PX): number {
    this.rect(x, y, size, size, { stroke: INK, thickness: 2.5 });
    return size;
  }

  /** The beacon-triangle mark, solid ink. (x, y) is the top-left of its bounding box. */
  beacon(x: number, y: number, size: number): void {
    const s = px(size);
    this.page.drawSvgPath(`M ${s / 2} 0 L ${s} ${s} L 0 ${s} Z`, { x: px(x), y: this.y(y), color: INK });
  }

  /** Header used on every planner page: mark + wordmark left, title/date right. */
  header(title: string, subtitle: string, margin: number): number {
    const top = 64;
    this.beacon(margin, top + 4, 34);
    this.text(BRAND.name, margin + 46, top + 34, { font: this.fonts.display, size: 44 });
    this.text(title, 1404 - margin, top + 34, { font: this.fonts.display, size: 44, align: "right" });
    this.text(subtitle, 1404 - margin, top + 62, { font: this.fonts.mono, size: 19, color: INK_60, align: "right" });
    const ruleY = top + 84;
    this.hline(margin, 1404 - margin, ruleY, 2, INK);
    return ruleY + 40;
  }

  /** Footer: page code bottom-left (the decoder reads it back), tagline bottom-right. */
  footer(pageCode: string, margin: number, right = BRAND.tagline): void {
    const baseline = 1872 - 44;
    this.hline(margin, 1404 - margin, baseline - 30, 1, INK_30);
    this.text(pageCode, margin, baseline, { font: this.fonts.monoMedium, size: 19, color: INK_60 });
    this.text(right, 1404 - margin, baseline, { font: this.fonts.displayItalic, size: 24, color: INK_60, align: "right" });
  }

  /** Ruled "Margin" column for handwriting (rule 6). */
  marginColumn(x: number, top: number, bottom: number, width: number, title = "Margin"): void {
    this.vline(x - 24, top - 12, bottom, 1.5, INK_30);
    this.text(title.toUpperCase(), x, top + 6, { font: this.fonts.monoMedium, size: 18, color: INK_60 });
    for (let y = top + 56; y < bottom; y += 64) this.hline(x, x + width, y, 1, INK_30);
  }
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
