/**
 * Shared page-flow helper for the list-style notebooks (Action List, Meeting Notes, Inbox,
 * continuation pages). Owns pagination, the header/footer, and the standard checkbox row that
 * prints an item code the decoder reads back (PLANNER_LAYOUT_DESCRIPTION in packages/decode
 * must match what is drawn here).
 */
import type { PrintedItem, PrintedItemType } from "@daymarkable/core";
import type { PDFDocument } from "pdf-lib";
import { CARRIED, CHECKBOX_PX, INK, RULE, SECONDARY, TERTIARY } from "./brand.js";
import { BODY_BOTTOM, CONTENT_RIGHT, CONTENT_W, CONTENT_X, addPage, type Canvas } from "./canvas.js";
import type { BrandFonts } from "./fonts.js";

export const MAIN_X = CONTENT_X;
export const MAIN_W = CONTENT_W;
export const BODY_SIZE = 36;
export const LINE_H = 48;
export const ROW_GAP = 27;
export { BODY_BOTTOM };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Mock header style: "Tuesday, Sep 1". */
export function formatTitleDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCDate()}`;
}

export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]!.slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
}

export function formatDayMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCDate()}`;
}

/** Mock tag style: "SEP 2". */
export function formatTag(iso: string): string {
  return formatDayMonth(iso).toUpperCase();
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

export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
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

export function generatedStamp(ctx: ComposeContext): string {
  return `GENERATED ${ctx.generatedAt.slice(11, 16)}`;
}

export interface RowItem {
  id: string;
  type: PrintedItemType;
  text: string;
  /** Right-aligned mono tag (due date, "CARRIED 3D"), drawn left of the item code. */
  tag: string | null;
  /** Secondary line under the text (project, people). */
  meta: string | null;
  carried: boolean;
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
    private readonly subtitle: (pageNo: number) => string,
  ) {}

  get pageCode(): string {
    return pageCode(this.kind, this.ctx.date, this.pageNo);
  }

  newPage(): void {
    this.pageNo += 1;
    this.codeCounters.clear();
    this.canvas = addPage(this.ctx.doc, this.ctx.fonts, this.ctx.doc.getPageCount() + 1);
    this.y = this.canvas.header(this.title(this.pageNo), this.subtitle(this.pageNo));
    this.canvas.footer(this.pageCode);
  }

  ensure(height: number): void {
    if (this.pageNo === 0 || this.y + height > BODY_BOTTOM) this.newPage();
  }

  nextCode(prefix: string): string {
    const n = (this.codeCounters.get(prefix) ?? 0) + 1;
    this.codeCounters.set(prefix, n);
    return `${prefix}${String(n).padStart(2, "0")}`;
  }

  /** Mono uppercase section label with optional right-aligned mono note. */
  label(text: string, right?: string): void {
    this.ensure(70);
    this.canvas.label(text, MAIN_X, this.y);
    if (right) this.canvas.text(right, CONTENT_RIGHT, this.y + 30, { font: this.canvas.fonts.mono, size: 24, color: TERTIARY, align: "right" });
    this.y += 54;
  }

  /** Serif heading inside a page (meeting topic). */
  heading(text: string, right?: string): void {
    this.ensure(110);
    const f = this.canvas.fonts;
    this.canvas.text(this.canvas.fit(text, f.displaySemi, 54, MAIN_W - (right ? 300 : 0)), MAIN_X, this.y + 48, { font: f.displaySemi, size: 54 });
    if (right) this.canvas.text(right, CONTENT_RIGHT, this.y + 48, { font: f.mono, size: 27, color: SECONDARY, align: "right" });
    this.y += 72;
  }

  note(text: string): void {
    this.ensure(LINE_H + ROW_GAP);
    this.canvas.text(text, MAIN_X, this.y + BODY_SIZE, { font: this.canvas.fonts.displayItalic, size: 33, color: SECONDARY });
    this.y += LINE_H + ROW_GAP;
  }

  paragraph(text: string, sizePx = 33, lineH = 46, indent = 0): void {
    const f = this.canvas.fonts;
    for (const line of this.canvas.wrap(text, f.ui, sizePx, MAIN_W - indent)) {
      this.ensure(lineH);
      this.canvas.text(line, MAIN_X + indent, this.y + sizePx, { font: f.ui, size: sizePx });
      this.y += lineH;
    }
  }

  /** "→ text" row (mock action rows). */
  arrowRow(text: string, sizePx = 33): void {
    const f = this.canvas.fonts;
    const lines = this.canvas.wrap(text, f.ui, sizePx, MAIN_W - 60);
    lines.forEach((line, i) => {
      this.ensure(46);
      if (i === 0) {
        // Drawn arrow (the UI font has no "→" glyph): shaft + chevron, pen weight.
        const ay = this.y + sizePx * 0.62;
        this.canvas.hline(MAIN_X + 2, MAIN_X + 34, ay, 4, INK);
        this.canvas.page.drawSvgPath("M 0 0 L 10 10 L 0 20", { x: this.canvas.page.getWidth() * 0 + (MAIN_X + 24) * (72 / 226), y: this.canvas.y(ay - 10), scale: 72 / 226, borderColor: INK, borderWidth: 4 * (72 / 226) });
      }
      this.canvas.text(line, MAIN_X + 60, this.y + sizePx, { font: f.ui, size: sizePx });
      this.y += 46;
    });
  }

  /** A pen-checkable row. Registers (pageCode, itemCode) -> item so the merge can resolve ticks. */
  checkboxRow(item: RowItem, prefix: string): string {
    const f = this.canvas.fonts;
    const textX = MAIN_X + CHECKBOX_PX + 24;
    const codeW = 90;
    const tagW = item.tag ? this.canvas.textWidth(item.tag, f.mono, 24) + 30 : 0;
    const textW = MAIN_W - (textX - MAIN_X) - codeW - tagW - 24;
    const measure = this.pageNo === 0 ? [item.text] : this.canvas.wrap(item.text, f.ui, BODY_SIZE, textW);
    const height = measure.length * LINE_H + (item.meta ? 30 : 0) + ROW_GAP;
    this.ensure(height);
    const lines = this.canvas.wrap(item.text, f.ui, BODY_SIZE, textW);
    const code = this.nextCode(prefix);
    this.canvas.checkbox(MAIN_X, this.y + 6, CHECKBOX_PX, item.carried ? SECONDARY : INK);
    lines.forEach((l, i) => this.canvas.text(l, textX, this.y + BODY_SIZE, { font: item.emphasis ? f.uiMedium : f.ui, size: BODY_SIZE, color: item.carried ? CARRIED : INK }));
    // (draw lines after the first with the same font; the loop above draws only baseline i=0 offset)
    for (let i = 1; i < lines.length; i++) this.canvas.text(lines[i]!, textX, this.y + BODY_SIZE + i * LINE_H, { font: item.emphasis ? f.uiMedium : f.ui, size: BODY_SIZE, color: item.carried ? CARRIED : INK });
    this.canvas.text(code, CONTENT_RIGHT, this.y + BODY_SIZE, { font: f.mono, size: 24, color: TERTIARY, align: "right" });
    if (item.tag) this.canvas.text(item.tag, CONTENT_RIGHT - codeW, this.y + BODY_SIZE, { font: f.mono, size: 24, color: item.carried ? TERTIARY : SECONDARY, align: "right", tracking: 0.04 });
    let yy = this.y + lines.length * LINE_H;
    if (item.meta) {
      this.canvas.text(this.canvas.fit(item.meta, f.mono, 24, textW), textX, yy + 20, { font: f.mono, size: 24, color: SECONDARY });
      yy += 30;
    }
    this.y = yy + ROW_GAP;
    this.ctx.printed.push({ pageCode: this.pageCode, itemCode: code, itemType: item.type, itemId: item.id });
    return code;
  }

  /** Empty checkbox + ruled line rows for handwriting. */
  blankRows(n: number): void {
    for (let k = 0; k < n; k++) {
      this.ensure(LINE_H + ROW_GAP);
      this.canvas.checkbox(MAIN_X, this.y + 6);
      this.canvas.hline(MAIN_X + CHECKBOX_PX + 24, CONTENT_RIGHT, this.y + BODY_SIZE + 6, 3, RULE);
      this.y += LINE_H + ROW_GAP;
    }
  }

  ruledLines(n: number, gap = 84): void {
    for (let k = 0; k < n; k++) {
      this.ensure(gap);
      this.canvas.hline(MAIN_X, CONTENT_RIGHT, this.y + gap - 12, 3, RULE);
      this.y += gap;
    }
  }

  divider(): void {
    this.ensure(40);
    this.canvas.hline(MAIN_X, CONTENT_RIGHT, this.y + 12, 3, RULE);
    this.y += 40;
  }
}
