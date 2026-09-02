/**
 * The Planner notebook: Daily Sheet, Week, Month, Quarter, Year, Inbox — one PDF.
 * Every page is an input form (rule 6): checkboxes >= 28px, margin column, footer page code.
 */
import type { DayCell, MonthModel, PlannerModel, PrintedItem, WeekModel } from "@daymarkable/core";
import { INK, INK_30, INK_60, WHITE } from "./brand.js";
import { newDocument } from "./canvas.js";
import { actionRowItem, writeDailySheet } from "./dailySheet.js";
import {
  BODY_BOTTOM,
  BODY_SIZE,
  LINE_H,
  MAIN_X,
  ROW_GAP,
  Section,
  dayName,
  formatDayMonth,
  formatShortDate,
  monthName,
  type ComposeContext,
} from "./section.js";

export interface ComposedDocument {
  pdf: Uint8Array;
  pageCount: number;
  printed: PrintedItem[];
}

const DOW_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dowLabels(firstCell: DayCell | undefined): string[] {
  if (!firstCell) return DOW_MON;
  const wd = new Date(`${firstCell.date}T00:00:00Z`).getUTCDay();
  return wd === 0 ? DOW_SUN : DOW_MON;
}

// ---------------------------------------------------------------- Week
function writeWeek(ctx: ComposeContext, w: WeekModel, subtitle: string): void {
  const title = `Week of ${formatDayMonth(w.start)} – ${formatDayMonth(w.end)}`;
  const s = new Section(ctx, "WEEK", (p) => (p === 1 ? title : `${title} · cont.`), subtitle);
  s.newPage();
  const f = s.canvas.fonts;
  const labelW = 150;
  const rowMin = 168;
  for (const day of w.days) {
    const contentLines = Math.max(2, day.events.length + day.tasksDue.length);
    const rowH = Math.max(rowMin, 44 + contentLines * 40);
    s.ensure(rowH);
    const top = s.y;
    if (day.isToday) s.canvas.rect(MAIN_X - 12, top, 6, rowH - 8, { fill: INK });
    s.canvas.text(dayName(day.date, 3).toUpperCase(), MAIN_X, top + 26, { font: f.monoMedium, size: 20, color: day.isToday ? INK : INK_60 });
    s.canvas.text(String(Number(day.date.slice(8, 10))), MAIN_X, top + 78, { font: f.display, size: 56, color: day.isToday ? INK : INK_60 });
    let yy = top + 30;
    for (const e of day.events) {
      const label = `${e.startTime ? `${e.startTime}  ` : ""}${e.title}${e.location ? ` · ${e.location}` : ""}`;
      s.canvas.text(label, MAIN_X + labelW, yy, { font: e.source === "ink" ? f.uiSemibold : f.ui, size: 25 });
      if (e.source === "ink") s.canvas.rect(MAIN_X + labelW - 22, yy - 14, 8, 8, { fill: INK });
      yy += 40;
    }
    for (const t of day.tasksDue) {
      s.canvas.checkbox(MAIN_X + labelW - 4, yy - 24, 30);
      const code = s.nextCode("W");
      s.canvas.text(t.text, MAIN_X + labelW + 42, yy, { font: f.ui, size: 25 });
      s.canvas.text(code, MAIN_X + s.mainWidth, yy, { font: f.monoMedium, size: 19, color: INK_60, align: "right" });
      ctx.printed.push({ pageCode: s.pageCode, itemCode: code, itemType: "task", itemId: t.id });
      yy += 40;
    }
    // Ruled lines for handwriting in the rest of the row.
    for (let ly = Math.max(yy + 8, top + 70); ly < top + rowH - 20; ly += 44) s.canvas.hline(MAIN_X + labelW, MAIN_X + s.mainWidth, ly, 1, INK_30);
    s.canvas.hline(MAIN_X, MAIN_X + s.mainWidth, top + rowH - 8, 1.5, INK_30);
    s.y = top + rowH;
  }
  if (w.focus.length) {
    s.sectionTitle("Focus this week", "overdue + high priority");
    for (const t of w.focus) s.checkboxRow(actionRowItem(t), "F");
  }
}

// ---------------------------------------------------------------- Month grid (shared by month/quarter/year)
interface GridOpts {
  x: number;
  y: number;
  width: number;
  cellH: number;
  showTitles: boolean;
  dayNumSize: number;
  compact: boolean;
}

function drawMonthGrid(s: Section, m: MonthModel, o: GridOpts): number {
  const f = s.canvas.fonts;
  const colW = o.width / 7;
  const labels = dowLabels(m.weeks[0]?.[0]);
  let y = o.y;
  labels.forEach((l, i) => s.canvas.text(o.compact ? l[0]! : l.toUpperCase(), o.x + i * colW + (o.compact ? colW / 2 : 8), y + 16, { font: f.monoMedium, size: o.compact ? 16 : 18, color: INK_60, align: o.compact ? "center" : "left" }));
  y += 24;
  s.canvas.hline(o.x, o.x + o.width, y, 1.5, INK);
  for (const week of m.weeks) {
    week.forEach((cell, i) => {
      const cx = o.x + i * colW;
      const today = cell.isToday && cell.inMonth;
      if (today) s.canvas.rect(cx, y, colW, o.cellH, { fill: INK });
      const color = today ? WHITE : cell.inMonth ? INK : INK_30;
      const num = String(Number(cell.date.slice(8, 10)));
      if (o.compact) {
        s.canvas.text(num, cx + colW / 2, y + o.dayNumSize + 6, { font: cell.events.length ? f.monoMedium : f.mono, size: o.dayNumSize, color, align: "center" });
        if (cell.events.length && !today) s.canvas.rect(cx + colW / 2 - 3, y + o.cellH - 9, 6, 6, { fill: INK });
      } else {
        s.canvas.text(num, cx + 8, y + o.dayNumSize + 4, { font: f.mono, size: o.dayNumSize, color });
        if (o.showTitles && cell.inMonth) {
          let ty = y + o.dayNumSize + 30;
          const maxLines = Math.floor((o.cellH - o.dayNumSize - 24) / 22);
          const items = [...cell.events.map((e) => `${e.startTime ? `${e.startTime} ` : ""}${e.title}`), ...cell.tasksDue.map((t) => `☐ ${t.text}`)];
          items.slice(0, maxLines).forEach((label, k) => {
            const more = k === maxLines - 1 && items.length > maxLines;
            const text = more ? `+${items.length - maxLines + 1} more` : label;
            const line = s.canvas.wrap(text, f.ui, 17, colW - 14)[0] ?? "";
            s.canvas.text(line, cx + 8, ty, { font: more ? f.mono : f.ui, size: 17, color: today ? WHITE : INK });
            ty += 22;
          });
        }
      }
      s.canvas.vline(cx, y, y + o.cellH, 1, INK_30);
    });
    s.canvas.vline(o.x + o.width, y, y + o.cellH, 1, INK_30);
    y += o.cellH;
    s.canvas.hline(o.x, o.x + o.width, y, 1, INK_30);
  }
  return y;
}

function writeMonth(ctx: ComposeContext, m: MonthModel, subtitle: string): void {
  const s = new Section(ctx, "MONTH", () => `${monthName(m.month)} ${m.year}`, subtitle);
  s.newPage();
  const rows = m.weeks.length;
  const available = BODY_BOTTOM - s.y - 260;
  const cellH = Math.min(190, Math.floor(available / rows));
  const bottom = drawMonthGrid(s, m, { x: MAIN_X, y: s.y, width: s.mainWidth, cellH, showTitles: true, dayNumSize: 22, compact: false });
  s.y = bottom + 40;
  s.subheading("Notes for the month", `${m.eventCount} on the calendar`);
  s.ruledLines(Math.floor((BODY_BOTTOM - s.y) / 56));
}

function writeQuarter(ctx: ComposeContext, q: PlannerModel["quarter"], subtitle: string): void {
  const s = new Section(ctx, "QUARTER", () => `Q${q.quarter} ${q.year}`, subtitle);
  s.newPage();
  const f = s.canvas.fonts;
  for (const m of q.months) {
    s.ensure(330);
    s.canvas.text(monthName(m.month), MAIN_X, s.y + 30, { font: f.display, size: 36 });
    s.canvas.text(`${m.eventCount} on the calendar`, MAIN_X + s.mainWidth, s.y + 30, { font: f.mono, size: 18, color: INK_60, align: "right" });
    s.y += 44;
    s.y = drawMonthGrid(s, m, { x: MAIN_X, y: s.y, width: s.mainWidth, cellH: 40, showTitles: false, dayNumSize: 20, compact: true }) + 36;
  }
  s.subheading("Quarter goals");
  s.ruledLines(Math.max(0, Math.floor((BODY_BOTTOM - s.y) / 56)));
}

function writeYear(ctx: ComposeContext, y: PlannerModel["year"], subtitle: string): void {
  const s = new Section(ctx, "YEAR", () => String(y.year), subtitle, false);
  s.newPage();
  const f = s.canvas.fonts;
  const cols = 3;
  const gap = 40;
  const gridW = (s.mainWidth - gap * (cols - 1)) / cols;
  const cellH = 34;
  const blockH = 44 + 24 + 6 * cellH + 30;
  y.months.forEach((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MAIN_X + col * (gridW + gap);
    const top = s.y + row * blockH;
    s.canvas.text(monthName(m.month), x, top + 28, { font: f.display, size: 30 });
    drawMonthGrid(s, m, { x, y: top + 40, width: gridW, cellH, showTitles: false, dayNumSize: 16, compact: true });
  });
  s.y += 4 * blockH;
  s.canvas.text("dots mark days with commitments · filled square is today", MAIN_X, s.y + 20, { font: f.mono, size: 17, color: INK_60 });
}

function writeInbox(ctx: ComposeContext, inbox: PlannerModel["inbox"], subtitle: string): void {
  const s = new Section(ctx, "INBOX", (p) => (p === 1 ? "Inbox" : "Inbox · cont."), subtitle);
  s.newPage();
  s.sectionTitle("Confirm these", "tick = yes · strike = drop");
  if (inbox.items.length === 0) s.note("Nothing to confirm. Everything read cleanly.");
  for (const it of inbox.items) {
    const meta = [it.detail, `${Math.round(it.confidence * 100)}% sure`, `${it.source.notebook} p${it.source.pageIndex + 1}`].filter(Boolean).join(" · ");
    s.checkboxRow({ id: it.id, type: "inbox", text: it.text, meta, carriedCount: 0, emphasis: false }, "I");
  }
  if (inbox.meetingRequests.length) {
    s.sectionTitle("Confirm to send", "tick = draft the invite");
    for (const r of inbox.meetingRequests) {
      s.checkboxRow(
        {
          id: r.id,
          type: "meeting_request",
          text: `Invite: ${r.topic}`,
          meta: [r.proposedDate ? formatShortDate(r.proposedDate) : null, r.proposedTime, r.durationMinutes ? `${r.durationMinutes} min` : null, r.attendees.length ? r.attendees.join(", ") : null].filter(Boolean).join(" · ") || null,
          carriedCount: 0,
          emphasis: true,
        },
        "M",
      );
    }
  }
  s.sectionTitle("Add by hand", "new items written here are read tonight");
  s.blankRows(6);
  s.ensure(LINE_H + ROW_GAP);
  s.canvas.text("Anything you write anywhere in this notebook is read on the next run.", MAIN_X, s.y + BODY_SIZE, { font: s.canvas.fonts.displayItalic, size: 24, color: INK_60 });
}

export async function composePlanner(model: PlannerModel): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const d = model.daily;
  const ctx: ComposeContext = { doc, fonts, date: d.date, generatedAt: d.generatedAt, runLabel: d.runLabel, printed: [] };
  const subtitle = `PLANNER · ${d.runLabel.toUpperCase()} · generated ${d.generatedAt.slice(11, 16)}`;
  writeDailySheet(ctx, d);
  writeWeek(ctx, model.week, subtitle);
  writeMonth(ctx, model.month, subtitle);
  writeQuarter(ctx, model.quarter, subtitle);
  writeYear(ctx, model.year, subtitle);
  writeInbox(ctx, model.inbox, subtitle);
  doc.setTitle(`dayMarkable Planner ${d.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}
