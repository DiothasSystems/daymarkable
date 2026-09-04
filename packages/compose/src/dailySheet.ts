/**
 * The Daily page ("Tablet Pages and Email", panel 2): two columns. Left ACTIONS, CARRIED
 * OVER, CONFIRM (Inbox + invites) and a NOTES area of ruled lines; right a SCHEDULE of hourly
 * rows with filled chips for confirmed meetings and outlined chips for tentative ones.
 *
 * Layout contract with the decoder: PLANNER_LAYOUT_DESCRIPTION in packages/decode. Change
 * both together (CLAUDE.md rule 6).
 */
import type { ActionItem, CalendarItem, DailySheetModel, PrintedItem } from "@daymarkable/core";
import { CARRIED, CHECKBOX_PX, INK, RULE, SECONDARY, TERTIARY } from "./brand.js";
import { BODY_BOTTOM, CONTENT_RIGHT, CONTENT_W, CONTENT_X, addPage, newDocument, type Canvas } from "./canvas.js";
import { formatShortDate, formatTag, formatTitleDate, generatedStamp, pageCode, sourceRef, type ComposeContext } from "./section.js";

export { formatLongDate, formatShortDate } from "./section.js";

export function dailyPageCode(date: string, page: number): string {
  return pageCode("DAY", date, page);
}

const COL_GAP = 60;
const COL_W = (CONTENT_W - COL_GAP) / 2;
const LEFT_X = CONTENT_X;
const RIGHT_X = CONTENT_X + COL_W + COL_GAP;
const ROW_SIZE = 36; // mock 12px ×3
const ROW_GAP = 27; // mock 9px ×3
const SIDE_SIZE = 33; // mock 11px ×3

interface Codes {
  ctx: ComposeContext;
  page: string;
  counters: Map<string, number>;
}

function nextCode(c: Codes, prefix: string, type: PrintedItem["itemType"], id: string): string {
  const n = (c.counters.get(prefix) ?? 0) + 1;
  c.counters.set(prefix, n);
  const code = `${prefix}${String(n).padStart(2, "0")}`;
  c.ctx.printed.push({ pageCode: c.page, itemCode: code, itemType: type, itemId: id });
  return code;
}

export function actionTag(a: ActionItem, today: string): string | null {
  if (a.carriedCount > 0) return `CARRIED ${a.carriedCount}D`;
  if (a.due) {
    if (a.due === today) return "TODAY";
    return `DUE ${formatTag(a.due)}`;
  }
  if (a.priority === "high") return "PRIORITY";
  if (a.kind === "follow_up") return "FOLLOW-UP";
  return null;
}

/** One checkbox row inside a column; returns the height used, or 0 if it did not fit. */
function columnRow(c: Canvas, codes: Codes, x: number, y: number, width: number, bottom: number, item: { id: string; type: PrintedItem["itemType"]; text: string; tag: string | null; source: string | null; carried: boolean }, prefix: string): number {
  const f = c.fonts;
  const textX = x + CHECKBOX_PX + 24;
  const codeW = 80;
  const tagW = item.tag ? c.textWidth(item.tag, f.mono, 24) + 24 : 0;
  const textW = width - (textX - x) - codeW - tagW;
  const lines = c.wrap(item.text, f.ui, ROW_SIZE, textW);
  const h = lines.length * 46 + (item.source ? 28 : 0) + ROW_GAP;
  if (y + h > bottom) return 0;
  const code = nextCode(codes, prefix, item.type, item.id);
  c.checkbox(x, y + 4, CHECKBOX_PX, item.carried ? SECONDARY : INK);
  lines.forEach((l, i) => c.text(l, textX, y + ROW_SIZE + i * 46, { font: f.ui, size: ROW_SIZE, color: item.carried ? CARRIED : INK }));
  c.text(code, x + width, y + ROW_SIZE, { font: f.mono, size: 24, color: TERTIARY, align: "right" });
  if (item.tag) c.text(item.tag, x + width - codeW, y + ROW_SIZE, { font: f.mono, size: 24, color: item.carried ? TERTIARY : SECONDARY, align: "right", tracking: 0.04 });
  // Source reference: which page of which notebook this was read from.
  if (item.source) c.text(c.fit(item.source, f.mono, 21, width - (textX - x)), textX, y + lines.length * 46 + 18, { font: f.mono, size: 21, color: TERTIARY, tracking: 0.04 });
  return h;
}

function schedule(c: Canvas, m: DailySheetModel, x: number, top: number, bottom: number, width: number): void {
  const f = c.fonts;
  let y = top;
  y += c.label("Schedule", x, y);
  const allDay = m.events.filter((e) => !e.startTime);
  const timed = m.events.filter((e) => e.startTime);
  if (allDay.length) {
    for (const e of allDay) {
      c.text("ALL DAY", x, y + 26, { font: f.mono, size: 24, color: SECONDARY });
      c.text(c.fit(e.title, f.uiSemibold, SIDE_SIZE, width - 130), x + 130, y + 28, { font: f.uiSemibold, size: SIDE_SIZE });
      y += 48;
    }
    y += 12;
  }
  const startHour = Math.min(8, ...timed.map((e) => Number(e.startTime!.slice(0, 2))));
  const endHour = Math.max(17, ...timed.map((e) => Number((e.endTime ?? e.startTime)!.slice(0, 2))));
  const hours = endHour - startHour + 1;
  const rowH = Math.max(66, Math.min(120, Math.floor((bottom - y) / hours)));
  const hourX = 78; // mock 26px ×3
  const drafts = m.meetingRequests.filter((r) => r.proposedDate === m.date && r.proposedTime);
  for (let h = 0; h < hours; h++) {
    const hh = startHour + h;
    const rowTop = y + h * rowH;
    c.hline(x, x + width, rowTop, 3, RULE);
    c.text(String(hh).padStart(2, "0"), x, rowTop + 18 + SIDE_SIZE * 0.7, { font: f.mono, size: SIDE_SIZE, color: SECONDARY });
    let cx = x + hourX + 12;
    const chipY = rowTop + Math.max(12, (rowH - (SIDE_SIZE + 18)) / 2);
    const inHour = [
      ...timed.filter((e) => Number(e.startTime!.slice(0, 2)) === hh).map((e) => ({ text: `${e.title}${e.endTime ? ` ${e.startTime}–${e.endTime}` : e.startTime!.endsWith(":00") ? "" : ` ${e.startTime}`}`, filled: true })),
      ...drafts.filter((r) => Number(r.proposedTime!.slice(0, 2)) === hh).map((r) => ({ text: r.topic, filled: false })),
    ];
    for (const item of inHour) {
      const remaining = x + width - cx;
      if (remaining < 160) break;
      cx += c.chip(item.text, cx, chipY, { filled: item.filled, size: SIDE_SIZE, maxWidth: remaining }) + 12;
    }
  }
  c.hline(x, x + width, y + hours * rowH, 3, RULE);
}

export function writeDailySheet(ctx: ComposeContext, m: DailySheetModel): void {
  const c = addPage(ctx.doc, ctx.fonts, ctx.doc.getPageCount() + 1);
  const page = dailyPageCode(m.date, 1);
  const codes: Codes = { ctx, page, counters: new Map() };
  const top = c.header(formatTitleDate(m.date), `dayMarkable DAILY · ${generatedStamp(ctx)} · ${ctx.runLabel.toUpperCase()}`);
  c.footer(page);
  const bottom = BODY_BOTTOM;

  // ---- left column
  let y = top;
  const open = m.actions.filter((a) => a.carriedCount === 0);
  const carried = m.actions.filter((a) => a.carriedCount > 0);
  const confirm = [
    ...m.meetingRequests.map((r) => ({ id: r.id, type: "meeting_request" as const, text: `Invite: ${r.topic}${r.proposedDate ? ` · ${formatShortDate(r.proposedDate)}${r.proposedTime ? ` ${r.proposedTime}` : ""}` : ""}`, tag: "TICK TO SEND", source: sourceRef(r.source), prefix: "M" })),
    ...m.inbox.map((i) => ({ id: i.id, type: "inbox" as const, text: i.text, tag: `${Math.round(i.confidence * 100)}%`, source: sourceRef(i.source), prefix: "I" })),
  ];
  const notesMin = 4 * 84 + 60; // keep room for at least four ruled lines
  const sectionBottom = bottom - notesMin;

  y += c.label("Actions", LEFT_X, y);
  let shown = 0;
  if (open.length === 0) {
    c.text("Nothing open. Write something down.", LEFT_X, y + ROW_SIZE, { font: c.fonts.displayItalic, size: 33, color: SECONDARY });
    y += 46 + ROW_GAP;
  }
  for (const a of open) {
    const h = columnRow(c, codes, LEFT_X, y, COL_W, sectionBottom, { id: a.id, type: "task", text: a.text, tag: actionTag(a, m.date), source: sourceRef(a.source), carried: false }, "A");
    if (!h) break;
    y += h;
    shown++;
  }
  if (shown < open.length) {
    c.text(`+${open.length - shown} more on the Action List`, LEFT_X + CHECKBOX_PX + 24, y + 26, { font: c.fonts.mono, size: 24, color: TERTIARY });
    y += 40;
  }

  if (carried.length && y + 120 < sectionBottom) {
    y += 20;
    y += c.label("Carried over", LEFT_X, y);
    for (const a of carried) {
      const h = columnRow(c, codes, LEFT_X, y, COL_W, sectionBottom, { id: a.id, type: "task", text: `${a.text} (${a.carriedCount} day${a.carriedCount === 1 ? "" : "s"})`, tag: null, source: sourceRef(a.source), carried: true }, "C");
      if (!h) break;
      y += h;
    }
  }

  if (confirm.length && y + 120 < sectionBottom) {
    y += 20;
    y += c.label("Confirm · tick = yes · strike = drop", LEFT_X, y);
    for (const it of confirm) {
      const h = columnRow(c, codes, LEFT_X, y, COL_W, sectionBottom, { id: it.id, type: it.type, text: it.text, tag: it.tag, source: it.source, carried: false }, it.prefix);
      if (!h) break;
      y += h;
    }
  }

  y += 24;
  y += c.label("Notes", LEFT_X, y);
  for (let ly = y + 60; ly <= bottom; ly += 84) c.hline(LEFT_X, LEFT_X + COL_W, ly, 3, RULE);

  // ---- right column
  c.vline(RIGHT_X - COL_GAP / 2, top, bottom, 3, RULE);
  schedule(c, m, RIGHT_X, top, bottom, COL_W);
}

/** Standalone Daily Sheet (used by the Milestone 1 spike). */
export async function composeDailySheet(model: DailySheetModel): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument();
  const printed: PrintedItem[] = [];
  writeDailySheet({ doc, fonts, date: model.date, generatedAt: model.generatedAt, runLabel: model.runLabel, printed }, model);
  doc.setTitle(`dayMarkable Daily ${model.date}`);
  return doc.save();
}

export type { CalendarItem };
export { CONTENT_RIGHT };
