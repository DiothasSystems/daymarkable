/**
 * The Daily page ("Tablet Pages and Email", panel 2): two columns. Left ACTIONS, CARRIED
 * OVER, CONFIRM (Inbox + invites) and a NOTES area of ruled lines; right a SCHEDULE of hourly
 * rows in which each meeting is a shaded box spanning its start and end times — name top-left,
 * repeat rule beneath, and the remaining space ruled for the day's note about that meeting.
 *
 * Layout contract with the decoder: PLANNER_LAYOUT_DESCRIPTION in packages/decode. Change
 * both together (CLAUDE.md rule 6).
 */
import { recurrenceLabel, type ActionItem, type CalendarItem, type DailySheetModel, type PrintedItem } from "@daymarkable/core";
import { CARRIED, CHECKBOX_PX, INK, RULE, SECONDARY, SHADE, SHADE_BORDER, TERTIARY } from "./brand.js";
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
  // Being late outranks being carried: the date is the fact the reader has to act on.
  if (a.due) {
    if (a.due < today) return `LATE ${formatTag(a.due)}`;
    if (a.due === today) return "TODAY";
    return `DUE ${formatTag(a.due)}`;
  }
  if (a.carriedCount > 0) return `CARRIED ${a.carriedCount}D`;
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

const MEET_PAD = 15;
const MEET_NOTE_GAP = 60; // one line of handwriting

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

interface Block {
  title: string;
  recurrence: string | null;
  startMin: number;
  endMin: number;
  draft: boolean;
  lane: number;
}

/**
 * Lay overlapping meetings into side-by-side lanes so no block is drawn over another. Greedy and
 * global: the first free lane wins, and every block shares the resulting column count so the
 * grid reads as columns rather than a staircase.
 */
function laneOut(blocks: Block[]): number {
  const laneEnds: number[] = [];
  for (const b of [...blocks].sort((p, q) => p.startMin - q.startMin || p.endMin - q.endMin)) {
    let lane = laneEnds.findIndex((end) => end <= b.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endMin);
    } else {
      laneEnds[lane] = b.endMin;
    }
    b.lane = lane;
  }
  return Math.max(1, laneEnds.length);
}

/**
 * A meeting is drawn as a shaded box spanning its start and end times: title top-left, the
 * repeat rule beneath it, and the rest of the box left empty and faintly ruled — that space is
 * where the day's note about the meeting goes, and the decoder reads it back as a note on that
 * meeting (PLANNER_LAYOUT_DESCRIPTION says so; rule 6).
 */
function meetingBlock(c: Canvas, b: Block, x: number, top: number, w: number, h: number): void {
  const f = c.fonts;
  // A draft meeting is outlined only, so an unconfirmed block reads differently from a real one.
  c.rect(x, top, w, h, { ...(b.draft ? {} : { fill: SHADE }), stroke: SHADE_BORDER, thickness: 3, radius: 6 });
  let ty = top + MEET_PAD + SIDE_SIZE;
  c.text(c.fit(b.title, f.uiSemibold, SIDE_SIZE, w - MEET_PAD * 2), x + MEET_PAD, ty, { font: f.uiSemibold, size: SIDE_SIZE });
  ty += 30;
  if (b.recurrence && ty - top + 12 <= h) {
    c.text(b.recurrence, x + MEET_PAD, ty, { font: f.mono, size: 24, color: SECONDARY, tracking: 0.06 });
    ty += 30;
  }
  // Whatever is left inside the box is writing space, ruled so it reads as such.
  for (let ry = ty + MEET_NOTE_GAP - 18; ry <= top + h - MEET_PAD; ry += MEET_NOTE_GAP) {
    c.hline(x + MEET_PAD, x + w - MEET_PAD, ry, 2, SHADE_BORDER);
  }
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
      c.text(c.fit(`${e.title}${e.recurrence ? ` · ${recurrenceLabel(e.recurrence)}` : ""}`, f.uiSemibold, SIDE_SIZE, width - 130), x + 130, y + 28, { font: f.uiSemibold, size: SIDE_SIZE });
      y += 48;
    }
    y += 12;
  }
  const startHour = Math.min(8, ...timed.map((e) => Number(e.startTime!.slice(0, 2))));
  const endHour = Math.max(17, ...timed.map((e) => Number((e.endTime ?? e.startTime)!.slice(0, 2))));
  const hours = endHour - startHour + 1;
  const rowH = Math.max(66, Math.min(120, Math.floor((bottom - y) / hours)));
  const hourX = 78; // mock 26px ×3
  const gridX = x + hourX + 12;
  const gridW = x + width - gridX;
  const gridBottom = y + hours * rowH;

  // The hour grid first, so the meeting boxes sit on top of its rules rather than under them.
  for (let h = 0; h < hours; h++) {
    const rowTop = y + h * rowH;
    c.hline(x, x + width, rowTop, 3, RULE);
    c.text(String(startHour + h).padStart(2, "0"), x, rowTop + 18 + SIDE_SIZE * 0.7, { font: f.mono, size: SIDE_SIZE, color: SECONDARY });
  }
  c.hline(x, x + width, gridBottom, 3, RULE);

  const drafts = m.meetingRequests.filter((r) => r.proposedDate === m.date && r.proposedTime);
  const blocks: Block[] = [
    ...timed.map((e) => ({
      title: e.title,
      recurrence: e.recurrence ? recurrenceLabel(e.recurrence) : null,
      startMin: minutesOf(e.startTime!),
      // An open-ended meeting gets an hour, so it still has a box to write in.
      endMin: e.endTime ? Math.max(minutesOf(e.endTime), minutesOf(e.startTime!) + 30) : minutesOf(e.startTime!) + 60,
      draft: false,
      lane: 0,
    })),
    ...drafts.map((r) => ({
      title: r.topic,
      recurrence: null,
      startMin: minutesOf(r.proposedTime!),
      endMin: minutesOf(r.proposedTime!) + (r.durationMinutes ?? 60),
      draft: true,
      lane: 0,
    })),
  ];
  const laneCount = laneOut(blocks);
  const laneW = (gridW - 12 * (laneCount - 1)) / laneCount;

  for (const b of blocks) {
    const pxPerMin = rowH / 60;
    const blockTop = y + (b.startMin - startHour * 60) * pxPerMin;
    // Tall enough for the title and one line to write on, whatever the meeting's length.
    const minH = MEET_PAD * 2 + SIDE_SIZE + (b.recurrence ? 30 : 0) + MEET_NOTE_GAP;
    const rawH = (b.endMin - b.startMin) * pxPerMin;
    const blockH = Math.min(Math.max(rawH, minH), gridBottom - blockTop);
    if (blockTop < y || blockH <= 0) continue;
    meetingBlock(c, b, gridX + b.lane * (laneW + 12), blockTop, laneW, blockH);
  }
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
