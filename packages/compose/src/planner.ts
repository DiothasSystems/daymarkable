/**
 * The Planner notebook: Daily, Week, Month, Quarter, Year, Inbox — one PDF, styled after the
 * handoff mocks ("Tablet Pages and Email", panels 2–5). Every page is an input form (rule 6):
 * checkboxes >= 28px, ruled handwriting areas, footer page code.
 */
import type { DayCell, MonthModel, PlannerModel, PrintedItem, StoredTask, WeekModel } from "@daymarkable/core";
import { CARRIED, CHECKBOX_PX, INK, RULE, SECONDARY, SHADE, SHADE_BORDER, TERTIARY } from "./brand.js";
import { BODY_BOTTOM, CONTENT_RIGHT, CONTENT_W, CONTENT_X, addPage, newDocument, type Canvas } from "./canvas.js";
import { actionTag, writeDailySheet } from "./dailySheet.js";
import { Section, dayName, formatDayMonth, formatShortDate, formatTag, generatedStamp, isoWeek, monthName, pageCode, type ComposeContext } from "./section.js";

export interface ComposedDocument {
  pdf: Uint8Array;
  pageCount: number;
  printed: PrintedItem[];
}

const SIDE_SIZE = 30; // mock 10px ×3
const SIDE_BOX = 30;
const SIDE_TAG = 24; // mock 8px ×3

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

/** Sidebar of open actions (Week/Month pages): small checkbox, wrapped text, mono tag line. */
function sidebar(c: Canvas, codes: Codes, x: number, top: number, bottom: number, width: number, title: string, tasks: StoredTask[], today: string, tagOf: (t: StoredTask) => string | null, prefix: string): void {
  const f = c.fonts;
  let y = top;
  y += c.label(title, x, y);
  const textX = x + SIDE_BOX + 18;
  const textW = width - (textX - x) - 6;
  for (const t of tasks) {
    const lines = c.wrap(t.text, f.ui, SIDE_SIZE, textW).slice(0, 2);
    const tag = tagOf(t);
    const h = lines.length * 40 + (tag ? 30 : 0) + 24;
    if (y + h > bottom - 3 * 45) break;
    const code = nextCode(codes, prefix, "task", t.id);
    const carried = t.carriedCount > 0;
    c.checkbox(x, y + 3, SIDE_BOX, carried ? SECONDARY : INK);
    lines.forEach((l, i) => c.text(i === lines.length - 1 && lines.length === 2 ? c.fit(l, f.ui, SIDE_SIZE, textW) : l, textX, y + SIDE_SIZE + i * 40, { font: f.ui, size: SIDE_SIZE, color: carried ? CARRIED : INK }));
    let yy = y + lines.length * 40;
    if (tag) {
      c.text(tag, textX, yy + 22, { font: f.mono, size: SIDE_TAG, color: carried ? TERTIARY : SECONDARY, tracking: 0.04 });
      yy += 30;
    }
    c.text(code, x + width - 6, y + SIDE_SIZE, { font: f.mono, size: 21, color: TERTIARY, align: "right" });
    y = yy + 24;
    void today;
  }
  // Blank ruled lines at the bottom for handwriting.
  for (let k = 3; k >= 1; k--) c.hline(x, x + width - 6, bottom - k * 45, 3, RULE);
  c.vline(x + width + 21, top - 12, bottom, 3, RULE);
}

// ---------------------------------------------------------------- Week
function writeWeek(ctx: ComposeContext, w: WeekModel, today: string): void {
  const c = addPage(ctx.doc, ctx.fonts, ctx.doc.getPageCount() + 1);
  const page = pageCode("WEEK", ctx.date, 1);
  const codes: Codes = { ctx, page, counters: new Map() };
  const top = c.header(`Week ${isoWeek(w.start)} · ${formatDayMonth(w.start)} – ${formatDayMonth(w.end)}`, `dayMarkable WEEK · UPDATED DAILY ${ctx.generatedAt.slice(11, 16)}`);
  c.footer(page);
  const f = c.fonts;
  const sideW = 354; // mock 118px ×3
  const gap = 48;
  const rightX = CONTENT_X + sideW + gap;
  const rightW = CONTENT_RIGHT - rightX;

  sidebar(c, codes, CONTENT_X, top, BODY_BOTTOM, sideW, "Actions", w.open.slice(0, 9), today, (t) => (t.carriedCount ? `CARRIED ${t.carriedCount}D` : t.due ? `DUE ${dayName(t.due).toUpperCase()}` : t.priority === "high" ? "PRIORITY" : "THIS WEEK"), "W");

  // Goals block reserved at the bottom of the right column.
  const goals = w.focus.filter((t) => t.priority === "high" || t.due === null).slice(0, 2);
  const goalsH = 54 + goals.length * 63 + 60 + 30;
  const rowsBottom = BODY_BOTTOM - goalsH;
  const dateW = 186; // mock 62px ×3

  // Merge Sat/Sun into one row when both are empty (mock).
  const rows: Array<{ label: string; sub: string | null; cells: DayCell[]; today: boolean; weekend: boolean }> = [];
  const sat = w.days[5]!;
  const sun = w.days[6]!;
  for (const d of w.days.slice(0, 5)) rows.push({ label: `${dayName(d.date)} ${Number(d.date.slice(8, 10))}`, sub: null, cells: [d], today: d.isToday, weekend: false });
  const weekendEmpty = sat.events.length + sat.tasksDue.length + sun.events.length + sun.tasksDue.length === 0 && !sat.isToday && !sun.isToday;
  if (weekendEmpty) rows.push({ label: `${dayName(sat.date)} ${Number(sat.date.slice(8, 10))} / ${dayName(sun.date)} ${Number(sun.date.slice(8, 10))}`, sub: null, cells: [sat, sun], today: false, weekend: true });
  else for (const d of [sat, sun]) rows.push({ label: `${dayName(d.date)} ${Number(d.date.slice(8, 10))}`, sub: null, cells: [d], today: d.isToday, weekend: true });

  const rowH = Math.floor((rowsBottom - top) / rows.length);
  let y = top;
  for (const r of rows) {
    if (r.today) c.rect(rightX - 12, y, rightW + 12, rowH, { fill: SHADE });
    const past = r.cells.every((d) => d.date < today);
    const dateColor = r.today ? INK : past || r.weekend ? SECONDARY : INK;
    const labelSize = c.textWidth(r.label, f.uiBold, 39) > dateW - 18 ? 30 : 39;
    c.text(r.label, rightX, y + 24 + 39 * 0.75, { font: f.uiBold, size: labelSize, color: dateColor });
    const due = r.cells.reduce((n, d) => n + d.tasksDue.length, 0);
    const sub = r.today ? `TODAY · ${due} DUE` : due ? `${due} DUE` : r.cells.reduce((n, d) => n + d.events.length, 0) ? `${r.cells.reduce((n, d) => n + d.events.length, 0)} ON CAL` : null;
    if (sub) c.text(sub, rightX, y + 24 + 39 + 30, { font: f.mono, size: 27, color: r.today ? SECONDARY : TERTIARY, tracking: 0.04 });
    // Content: DUE items bold first, then events.
    const cx = rightX + dateW;
    const cw = rightW - dateW;
    const items: Array<{ text: string; bold: boolean }> = [];
    for (const d of r.cells) {
      for (const t of d.tasksDue) items.push({ text: `DUE: ${t.text}`, bold: true });
      for (const e of d.events) items.push({ text: `${e.title}${e.startTime ? ` ${e.startTime}` : ""}`, bold: false });
    }
    let ty = y + 24 + 33 * 0.75;
    const maxLines = Math.max(1, Math.floor((rowH - 30) / 40));
    if (items.length === 0) {
      c.text("—", cx, ty, { font: f.ui, size: 33, color: TERTIARY });
    } else {
      let used = 0;
      for (const it of items) {
        if (used >= maxLines) break;
        const line = c.fit(it.text, it.bold ? f.uiBold : f.ui, 33, cw);
        c.text(line, cx, ty, { font: it.bold ? f.uiBold : f.ui, size: 33, color: past ? SECONDARY : INK });
        ty += 40;
        used++;
      }
      if (used < items.length) c.text(`+${items.length - used} more`, cx, ty, { font: f.mono, size: 24, color: TERTIARY });
    }
    // Handwriting rule inside taller rows.
    if (rowH > 150) c.hline(cx, rightX + rightW, y + rowH - 30, 3, RULE);
    c.hline(rightX, rightX + rightW, y + rowH, 3, RULE);
    y += rowH;
  }

  // WEEK GOALS
  y = rowsBottom + 30;
  y += c.label("Week goals · from your notes", rightX, y);
  for (const t of goals) {
    const code = nextCode(codes, "F", "task", t.id);
    c.checkbox(rightX, y + 4, CHECKBOX_PX);
    c.text(c.fit(t.text, f.ui, 36, rightW - CHECKBOX_PX - 24 - 90), rightX + CHECKBOX_PX + 24, y + 36, { font: f.ui, size: 36 });
    c.text(code, rightX + rightW, y + 36, { font: f.mono, size: 24, color: TERTIARY, align: "right" });
    y += 63;
  }
  c.checkbox(rightX, y + 4, CHECKBOX_PX);
  c.hline(rightX + CHECKBOX_PX + 24, rightX + rightW, y + 42, 3, RULE);
}

// ---------------------------------------------------------------- Month grid (shared)
interface GridOpts {
  x: number;
  y: number;
  width: number;
  cellH: number;
  today: string;
  compact: boolean;
}

function drawMonthGrid(c: Canvas, m: MonthModel, o: GridOpts): number {
  const f = c.fonts;
  const gapPx = 9; // mock 3px ×3
  const colW = (o.width - gapPx * 6) / 7;
  const first = m.weeks[0]?.[0];
  const startsSunday = first ? new Date(`${first.date}T00:00:00Z`).getUTCDay() === 0 : false;
  const labels = startsSunday ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] : ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  let y = o.y;
  labels.forEach((l, i) => c.text(o.compact ? l[0]! : l, o.x + i * (colW + gapPx) + colW / 2, y + 27 * 0.8, { font: f.mono, size: o.compact ? 24 : 27, color: SECONDARY, align: "center", tracking: 0.04 }));
  y += 36;
  for (const week of m.weeks) {
    week.forEach((cell, i) => {
      const cx = o.x + i * (colW + gapPx);
      const wd = new Date(`${cell.date}T00:00:00Z`).getUTCDay();
      const weekend = wd === 0 || wd === 6;
      const isToday = cell.date === o.today;
      if (weekend && !isToday) c.rect(cx, y, colW, o.cellH, { fill: SHADE, stroke: SHADE_BORDER, thickness: 3, radius: 6 });
      else c.rect(cx, y, colW, o.cellH, { stroke: isToday ? INK : RULE, thickness: isToday ? 4.5 : 3, radius: 6 });
      const num = String(Number(cell.date.slice(8, 10)));
      const numColor = !cell.inMonth || (weekend && !isToday) ? TERTIARY : INK;
      const numSize = o.compact ? 24 : 30;
      c.text(num, cx + 12, y + 12 + numSize * 0.8, { font: isToday ? f.uiBold : f.ui, size: numSize, color: numColor });
      if (!o.compact && cell.inMonth) {
        const items = [...cell.tasksDue.map((t) => ({ text: t.text, bold: true })), ...cell.events.map((e) => ({ text: `${e.startTime ? `${e.startTime} ` : ""}${e.title}`, bold: false }))];
        let ty = y + 12 + numSize + 30;
        const maxLines = Math.max(0, Math.floor((o.cellH - numSize - 30) / 30));
        items.slice(0, maxLines).forEach((it, k) => {
          const more = k === maxLines - 1 && items.length > maxLines;
          const text = more ? `+${items.length - maxLines + 1} more` : c.fit(it.text, it.bold ? f.uiBold : f.ui, 24, colW - 24);
          c.text(text, cx + 12, ty, { font: more ? f.mono : it.bold ? f.uiBold : f.ui, size: 24, color: more ? TERTIARY : INK });
          ty += 30;
        });
      } else if (o.compact && cell.inMonth && (cell.events.length || cell.tasksDue.length)) {
        c.rect(cx + colW / 2 - 4, y + o.cellH - 14, 8, 8, { fill: INK });
      }
    });
    y += o.cellH + gapPx;
  }
  return y - gapPx;
}

function writeMonth(ctx: ComposeContext, m: MonthModel, tasks: StoredTask[], today: string): void {
  const c = addPage(ctx.doc, ctx.fonts, ctx.doc.getPageCount() + 1);
  const page = pageCode("MONTH", ctx.date, 1);
  const codes: Codes = { ctx, page, counters: new Map() };
  const open = tasks.filter((t) => t.status === "open" || t.status === "carried");
  const top = c.header(`${monthName(m.month)} ${m.year}`, `dayMarkable MONTH · ${open.length} OPEN ACTION${open.length === 1 ? "" : "S"}`);
  c.footer(page);
  const f = c.fonts;
  const sideW = 336; // mock 112px ×3
  const gap = 48;
  const rightX = CONTENT_X + sideW + gap;
  const rightW = CONTENT_RIGHT - rightX;
  const monthPrefix = `${m.year}-${String(m.month).padStart(2, "0")}`;
  const listed = [...open.filter((t) => t.due?.startsWith(monthPrefix)), ...open.filter((t) => !t.due?.startsWith(monthPrefix))].slice(0, 9);
  sidebar(c, codes, CONTENT_X, top, BODY_BOTTOM, sideW, "Open actions", listed, today, (t) => (t.carriedCount ? "CARRIED" : t.due ? formatTag(t.due) : t.priority === "high" ? "PRIORITY" : `WK ${isoWeek(today)}`), "W");

  const focusH = 120;
  const rows = m.weeks.length;
  const cellH = Math.floor((BODY_BOTTOM - focusH - top - 36 - 9 * (rows - 1)) / rows);
  const gridBottom = drawMonthGrid(c, m, { x: rightX, y: top, width: rightW, cellH, today, compact: false });

  // MONTH FOCUS line: counts only (no LLM prose).
  const dueThisMonth = open.filter((t) => t.due?.startsWith(monthPrefix)).length;
  const carried = open.filter((t) => t.carriedCount > 0).length;
  const y = gridBottom + 48;
  c.label("Month focus · ", rightX, y - 4);
  const lead = c.textWidth("MONTH FOCUS · ", f.mono, 30, 0.15) + 8;
  c.text(c.fit(`${m.eventCount} on cal · ${dueThisMonth} due · ${carried} carried`, f.ui, 33, rightW - lead), rightX + lead, y + 30, { font: f.ui, size: 33 });
  c.hline(rightX, rightX + rightW, y + 90, 3, RULE);
}

function writeQuarter(ctx: ComposeContext, q: PlannerModel["quarter"], today: string): void {
  const c = addPage(ctx.doc, ctx.fonts, ctx.doc.getPageCount() + 1);
  const page = pageCode("QUARTER", ctx.date, 1);
  const top = c.header(`Q${q.quarter} ${q.year}`, `dayMarkable QUARTER · ${q.months.reduce((n, m) => n + m.eventCount, 0)} ON THE CALENDAR`);
  c.footer(page);
  const f = c.fonts;
  const gap = 36;
  const colW = (CONTENT_W - gap * 2) / 3;
  const cellH = 60;
  let bottom = top;
  q.months.forEach((m, i) => {
    const x = CONTENT_X + i * (colW + gap);
    c.text(monthName(m.month), x, top + 40, { font: f.displaySemi, size: 45 });
    c.text(`${m.eventCount} ON CAL`, x + colW, top + 40, { font: f.mono, size: 24, color: TERTIARY, align: "right", tracking: 0.04 });
    bottom = Math.max(bottom, drawMonthGrid(c, m, { x, y: top + 66, width: colW, cellH, today, compact: true }));
  });
  let y = bottom + 60;
  y += c.label("Quarter goals", CONTENT_X, y);
  for (let ly = y + 60; ly <= BODY_BOTTOM; ly += 84) c.hline(CONTENT_X, CONTENT_RIGHT, ly, 3, RULE);
}

function writeYear(ctx: ComposeContext, yv: PlannerModel["year"], today: string): void {
  const c = addPage(ctx.doc, ctx.fonts, ctx.doc.getPageCount() + 1);
  const page = pageCode("YEAR", ctx.date, 1);
  const top = c.header(String(yv.year), "dayMarkable YEAR · MILESTONES FROM YOUR NOTES");
  c.footer(page);
  const f = c.fonts;
  const cur = Number(today.slice(5, 7));
  const mon = (n: number) => monthName(n).slice(0, 3).toUpperCase();
  const summarize = (months: MonthModel[]) => {
    const events = months.flatMap((m) => m.weeks.flat().filter((d) => d.inMonth).flatMap((d) => d.events.map((e) => ({ date: d.date, title: e.title }))));
    const due = months.flatMap((m) => m.weeks.flat().filter((d) => d.inMonth).flatMap((d) => d.tasksDue.map((t) => ({ date: d.date, title: t.text }))));
    return { events, due };
  };
  type Card = { title: string; note: string | null; lines: string[]; state: "past" | "now" | "future" };
  const cards: Card[] = [];
  const past = yv.months.filter((m) => m.month < cur);
  const half = Math.ceil(past.length / 2);
  const pastGroups = past.length === 0 ? [] : past.length === 1 ? [past] : [past.slice(0, half), past.slice(half)];
  for (const g of pastGroups) {
    const s = summarize(g);
    cards.push({ title: g.length === 1 ? mon(g[0]!.month) : `${mon(g[0]!.month)} – ${mon(g.at(-1)!.month)}`, note: "PAST", lines: [`${s.events.length} on the calendar · ${s.due.length} actions due`], state: "past" });
  }
  while (cards.length < 2) cards.push({ title: "—", note: null, lines: [], state: "past" });
  const now = yv.months.find((m) => m.month === cur)!;
  const ns = summarize([now]);
  cards.push({ title: mon(cur), note: "NOW", lines: [...ns.events.slice(0, 3).map((e) => `▸ ${e.title} (${formatDayMonth(e.date)})`), ...ns.due.slice(0, 2).map((t) => `▸ DUE ${formatDayMonth(t.date)}: ${t.title}`)], state: "now" });
  for (const m of yv.months.filter((x) => x.month > cur).slice(0, 3)) {
    const s = summarize([m]);
    cards.push({ title: mon(m.month), note: null, lines: [...s.events.slice(0, 3).map((e) => `▸ ${e.title} (${formatDayMonth(e.date)})`), ...s.due.slice(0, 2).map((t) => `▸ DUE ${formatDayMonth(t.date)}: ${t.title}`)], state: "future" });
  }
  while (cards.length < 6) cards.push({ title: "—", note: null, lines: [], state: "future" });

  const goalsH = 54 + yv.progress.length * 60 + 40;
  const gap = 24;
  const cardW = (CONTENT_W - gap) / 2;
  const cardH = Math.floor((BODY_BOTTOM - goalsH - top - gap * 2) / 3);
  cards.slice(0, 6).forEach((card, i) => {
    const x = CONTENT_X + (i % 2) * (cardW + gap);
    const y = top + Math.floor(i / 2) * (cardH + gap);
    c.rect(x, y, cardW, cardH, { stroke: card.state === "now" ? INK : RULE, thickness: card.state === "now" ? 4.5 : 3, radius: 6 });
    const color = card.state === "past" ? TERTIARY : INK;
    c.text(card.title, x + 30, y + 24 + 36 * 0.8, { font: f.uiBold, size: 36, color });
    if (card.note) c.text(`· ${card.note}`, x + 30 + c.textWidth(card.title, f.uiBold, 36) + 12, y + 24 + 36 * 0.8, { font: f.mono, size: 24, color: card.state === "past" ? TERTIARY : SECONDARY });
    let ty = y + 24 + 36 + 36;
    const maxLines = Math.floor((cardH - 100) / 40);
    if (card.lines.length === 0 && card.title !== "—") c.text("nothing scheduled yet", x + 30, ty, { font: f.ui, size: 30, color: TERTIARY });
    for (const line of card.lines.slice(0, maxLines)) {
      c.text(c.fit(line, f.ui, 30, cardW - 60), x + 30, ty, { font: f.ui, size: 30, color });
      ty += 40;
    }
    if (card.state === "future" && card.title !== "—") for (let ly = Math.max(ty + 20, y + cardH - 120); ly < y + cardH - 20; ly += 50) c.hline(x + 30, x + cardW - 30, ly, 3, RULE);
  });

  // YEAR GOALS · PROGRESS
  let y = BODY_BOTTOM - goalsH + 20;
  y += c.label("Year goals · progress", CONTENT_X, y);
  for (const p of yv.progress) {
    const labelW = 390; // mock 130px ×3
    c.text(c.fit(p.label, f.ui, 33, labelW - 20), CONTENT_X, y + 30, { font: f.ui, size: 33 });
    const barX = CONTENT_X + labelW;
    const barW = CONTENT_W - labelW - 150;
    c.rect(barX, y + 8, barW, 21, { stroke: INK, thickness: 3, radius: 10 });
    if (p.value > 0) c.rect(barX, y + 8, Math.max(21, barW * Math.min(1, p.value)), 21, { fill: INK, radius: 10 });
    c.text(p.text, CONTENT_RIGHT, y + 30, { font: f.mono, size: 27, color: SECONDARY, align: "right" });
    y += 60;
  }
}

function writeInbox(ctx: ComposeContext, inbox: PlannerModel["inbox"]): void {
  const s = new Section(ctx, "INBOX", (p) => (p === 1 ? "Inbox" : "Inbox · cont."), () => `dayMarkable INBOX · ${inbox.items.length} TO CONFIRM · ${generatedStamp(ctx)}`);
  s.newPage();
  s.label("Confirm these · tick = yes · strike = drop");
  if (inbox.items.length === 0) s.note("Nothing to confirm. Everything read cleanly.");
  for (const it of inbox.items) {
    s.checkboxRow({ id: it.id, type: "inbox", text: it.text, tag: `${Math.round(it.confidence * 100)}%`, meta: [it.detail, `${it.source.notebook} · p.${it.source.pageIndex + 1}`].filter(Boolean).join(" · "), carried: false, emphasis: false }, "I");
  }
  if (inbox.meetingRequests.length) {
    s.y += 20;
    s.label("Confirm to send · tick = draft the invite");
    for (const r of inbox.meetingRequests) {
      s.checkboxRow({ id: r.id, type: "meeting_request", text: `Invite: ${r.topic}`, tag: r.proposedDate ? formatTag(r.proposedDate) : null, meta: [r.proposedTime, r.durationMinutes ? `${r.durationMinutes} min` : null, r.attendees.length ? r.attendees.join(", ") : null].filter(Boolean).join(" · ") || null, carried: false, emphasis: true }, "M");
    }
  }
  s.y += 20;
  s.label("Add by hand · new items written here are read tonight");
  s.blankRows(6);
  s.note("Anything you write anywhere in this notebook is read on the next run.");
}

export async function composePlanner(model: PlannerModel, tasks: StoredTask[] = []): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const d = model.daily;
  const ctx: ComposeContext = { doc, fonts, date: d.date, generatedAt: d.generatedAt, runLabel: d.runLabel, printed: [] };
  writeDailySheet(ctx, d);
  writeWeek(ctx, model.week, d.date);
  writeMonth(ctx, model.month, tasks, d.date);
  writeQuarter(ctx, model.quarter, d.date);
  writeYear(ctx, model.year, d.date);
  writeInbox(ctx, model.inbox);
  doc.setTitle(`dayMarkable Planner ${d.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}

export { formatShortDate, actionTag };
