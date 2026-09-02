/**
 * Shared page-flow helper for every notebook section. Owns pagination, the header/footer,
 * the margin column, and the standard checkbox row that prints an item code the decoder
 * reads back (PLANNER_LAYOUT_DESCRIPTION in packages/decode must match what is drawn here).
 */
import type { PrintedItem, PrintedItemType } from "@daymarkable/core";
import type { PDFDocument } from "pdf-lib";
import { CHECKBOX_PX, INK, INK_30, INK_60 } from "./brand.js";
import { addPage, type Canvas } from "./canvas.js";
import type { BrandFonts } from "./fonts.js";

export const MARGIN = 72;
export const MAIN_X = MARGIN;
export const MAIN_W = 880;
export const SIDE_X = MAIN_X + MAIN_W + 48;
export const SIDE_W = 1404 - MARGIN - SIDE_X;
export const BODY_BOTTOM = 1872 - 110;
export const BODY_SIZE = 27;
export const LINE_H = 36;
export const ROW_GAP = 14;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]!.slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
}

export function formatDayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
}

export function monthName(month1: number): string {
  return MONTHS[month1 - 1]!;
}

export function dayName(iso: string, len = 3): string {
  return DAY_NAMES[weekdayOf(iso)]!.slice(0, len);
}

export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export type PageKindCode = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "INBOX" | "ACTIONS" | "MEETINGS";

export function pageCode(kind: PageKindCode, date: string, page: number): string {
  return `dM/${kind}/${date}/${page}`;
}

export interface ComposeContext {
  doc: PDFDocument;
  fonts: BrandFonts;
  date: string;
  generatedAt: string;
  runLabel: string;
  printed: PrintedItem[];
}

export interface RowItem {
  id: string;
  type: PrintedItemType;
  text: string;
  meta: string | null;
  carriedCount: number;
  emphasis: boolean;
}

export class Section {
  canvas!: Canvas;
  y = 0;
  pageNo = 0;
  private codeCounters = new Map<string, number>();

  constructor(
    readonly ctx: ComposeContext,
    readonly kind: PageKindCode,
    private readonly title: (pageNo: number) => string,
    private readonly subtitle: string,
    private readonly withMargin = true,
  ) {}

  get pageCode(): string {
    return pageCode(this.kind, this.ctx.date, this.pageNo);
  }

  newPage(): void {
    this.pageNo += 1;
    this.codeCounters.clear();
    this.canvas = addPage(this.ctx.doc, this.ctx.fonts, this.ctx.doc.getPageCount() + 1);
    this.y = this.canvas.header(this.title(this.pageNo), this.subtitle, MARGIN);
    if (this.withMargin) this.canvas.marginColumn(SIDE_X, this.y, BODY_BOTTOM, SIDE_W);
    this.canvas.footer(this.pageCode, MARGIN);
  }

  ensure(height: number): void {
    if (this.pageNo === 0 || this.y + height > BODY_BOTTOM) this.newPage();
  }

  get mainWidth(): number {
    return this.withMargin ? MAIN_W : 1404 - 2 * MARGIN;
  }

  nextCode(prefix: string): string {
    const n = (this.codeCounters.get(prefix) ?? 0) + 1;
    this.codeCounters.set(prefix, n);
    return `${prefix}${String(n).padStart(2, "0")}`;
  }

  sectionTitle(title: string, right?: string): void {
    this.ensure(90);
    const f = this.canvas.fonts;
    this.canvas.text(title, MAIN_X, this.y + 30, { font: f.display, size: 38 });
    if (right) this.canvas.text(right, MAIN_X + this.mainWidth, this.y + 30, { font: f.mono, size: 19, color: INK_60, align: "right" });
    this.canvas.hline(MAIN_X, MAIN_X + this.mainWidth, this.y + 44, 1.5, INK);
    this.y += 68;
  }

  subheading(text: string, right?: string): void {
    this.ensure(52);
    const f = this.canvas.fonts;
    this.canvas.text(text.toUpperCase(), MAIN_X, this.y + 22, { font: f.monoMedium, size: 19, color: INK_60 });
    if (right) this.canvas.text(right, MAIN_X + this.mainWidth, this.y + 22, { font: f.mono, size: 18, color: INK_60, align: "right" });
    this.canvas.hline(MAIN_X, MAIN_X + this.mainWidth, this.y + 32, 1, INK_30);
    this.y += 46;
  }

  note(text: string): void {
    this.ensure(LINE_H + ROW_GAP);
    this.canvas.text(text, MAIN_X, this.y + BODY_SIZE, { font: this.canvas.fonts.displayItalic, size: 26, color: INK_60 });
    this.y += LINE_H + ROW_GAP;
  }

  /** Wrapped body paragraph; returns nothing, advances y. */
  paragraph(text: string, sizePx = BODY_SIZE, lineH = LINE_H, indent = 0): void {
    const f = this.canvas.fonts;
    const lines = this.canvas.wrap(text, f.ui, sizePx, this.mainWidth - indent);
    for (const line of lines) {
      this.ensure(lineH);
      this.canvas.text(line, MAIN_X + indent, this.y + sizePx, { font: f.ui, size: sizePx });
      this.y += lineH;
    }
  }

  bullet(text: string, sizePx = BODY_SIZE): void {
    const f = this.canvas.fonts;
    const lines = this.canvas.wrap(text, f.ui, sizePx, this.mainWidth - 40);
    lines.forEach((line, i) => {
      this.ensure(LINE_H);
      if (i === 0) this.canvas.text("•", MAIN_X + 8, this.y + sizePx, { font: f.uiSemibold, size: sizePx });
      this.canvas.text(line, MAIN_X + 40, this.y + sizePx, { font: f.ui, size: sizePx });
      this.y += LINE_H;
    });
  }

  /** A pen-checkable row. Registers (pageCode, itemCode) -> item so the merge can resolve ticks. */
  checkboxRow(item: RowItem, prefix: string): string {
    const f = this.canvas.fonts;
    const textX = MAIN_X + CHECKBOX_PX + 22;
    const codeW = 60;
    const textW = this.mainWidth - (textX - MAIN_X) - codeW - 20;
    // Measure before allocating so a row never splits across pages.
    const probe = this.pageNo === 0 ? null : this.canvas;
    const lines = probe ? probe.wrap(item.text, f.ui, BODY_SIZE, textW) : [item.text];
    const height = lines.length * LINE_H + (item.meta ? 28 : 0) + ROW_GAP;
    this.ensure(height);
    const wrapped = this.canvas.wrap(item.text, f.ui, BODY_SIZE, textW);
    const code = this.nextCode(prefix);
    this.canvas.checkbox(MAIN_X, this.y + 2);
    wrapped.forEach((l, i) => this.canvas.text(l, textX, this.y + BODY_SIZE + i * LINE_H, { font: item.emphasis ? f.uiMedium : f.ui, size: BODY_SIZE }));
    this.canvas.text(code, MAIN_X + this.mainWidth, this.y + BODY_SIZE, { font: f.monoMedium, size: 19, color: INK_60, align: "right" });
    let yy = this.y + wrapped.length * LINE_H;
    const dots = item.carriedCount > 0 ? "·".repeat(Math.min(item.carriedCount, 7)) : "";
    if (item.meta) {
      this.canvas.text(item.meta, textX, yy + 20, { font: f.mono, size: 18, color: INK_60 });
      if (dots) this.canvas.text(dots, MAIN_X + this.mainWidth - codeW - 8, yy + 20, { font: f.monoMedium, size: 22, color: INK_60, align: "right" });
      yy += 28;
    } else if (dots) {
      this.canvas.text(dots, MAIN_X + this.mainWidth - codeW - 8, this.y + BODY_SIZE, { font: f.monoMedium, size: 22, color: INK_60, align: "right" });
    }
    this.y = yy + ROW_GAP;
    this.ctx.printed.push({ pageCode: this.pageCode, itemCode: code, itemType: item.type, itemId: item.id });
    return code;
  }

  blankRows(n: number): void {
    for (let k = 0; k < n; k++) {
      this.ensure(LINE_H + ROW_GAP);
      this.canvas.checkbox(MAIN_X, this.y + 2);
      this.canvas.hline(MAIN_X + CHECKBOX_PX + 22, MAIN_X + this.mainWidth, this.y + BODY_SIZE + 4, 1, INK_30);
      this.y += LINE_H + ROW_GAP;
    }
  }

  ruledLines(n: number, gap = 56): void {
    for (let k = 0; k < n; k++) {
      this.ensure(gap);
      this.canvas.hline(MAIN_X, MAIN_X + this.mainWidth, this.y + gap - 12, 1, INK_30);
      this.y += gap;
    }
  }
}
