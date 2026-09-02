/**
 * The Daily Sheet (README core feature 3): today's date, calendar block, prioritized action
 * list with checkboxes, carried-over dot counts, Inbox to confirm, and a margin column.
 *
 * Layout contract with the decoder: see PLANNER_LAYOUT_DESCRIPTION in packages/decode.
 * Change both together (CLAUDE.md rule 6).
 */
import type { ActionItem, CalendarItem, DailySheetModel, InboxItem } from "@daymarkable/core";
import { CHECKBOX_PX, INK, INK_30, INK_60 } from "./brand.js";
import { addPage, newDocument, type Canvas } from "./canvas.js";

const MARGIN = 72;
const MAIN_X = MARGIN;
const MAIN_W = 880;
const SIDE_X = MAIN_X + MAIN_W + 48;
const SIDE_W = 1404 - MARGIN - SIDE_X;
const BODY_BOTTOM = 1872 - 110;
const BODY_SIZE = 27;
const LINE_H = 36;
const ROW_GAP = 14;

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

export function dailyPageCode(date: string, page: number): string {
  return `dM/DAY/${date}/${page}`;
}

class SheetWriter {
  private canvas!: Canvas;
  private y = 0;
  private pageNo = 0;
  private readonly pages: Canvas[] = [];

  constructor(
    private readonly doc: Awaited<ReturnType<typeof newDocument>>,
    private readonly model: DailySheetModel,
  ) {}

  private subtitle(): string {
    const time = this.model.generatedAt.slice(11, 16);
    return `DAILY SHEET · ${this.model.runLabel.toUpperCase()} · generated ${time}`;
  }

  newPage(): void {
    this.pageNo += 1;
    this.canvas = addPage(this.doc.doc, this.doc.fonts, this.pageNo);
    this.pages.push(this.canvas);
    const title = this.pageNo === 1 ? formatLongDate(this.model.date) : `${formatShortDate(this.model.date)} · cont.`;
    this.y = this.canvas.header(title, this.subtitle(), MARGIN);
    this.canvas.marginColumn(SIDE_X, this.y, BODY_BOTTOM, SIDE_W);
    this.canvas.footer(dailyPageCode(this.model.date, this.pageNo), MARGIN);
  }

  ensure(height: number): void {
    if (this.y + height > BODY_BOTTOM) this.newPage();
  }

  sectionTitle(title: string, right?: string): void {
    this.ensure(90);
    const f = this.canvas.fonts;
    this.canvas.text(title, MAIN_X, this.y + 30, { font: f.display, size: 38 });
    if (right) this.canvas.text(right, MAIN_X + MAIN_W, this.y + 30, { font: f.mono, size: 19, color: INK_60, align: "right" });
    this.canvas.hline(MAIN_X, MAIN_X + MAIN_W, this.y + 44, 1.5, INK);
    this.y += 68;
  }

  emptyLine(text: string): void {
    this.ensure(LINE_H + ROW_GAP);
    this.canvas.text(text, MAIN_X, this.y + BODY_SIZE, { font: this.canvas.fonts.displayItalic, size: 26, color: INK_60 });
    this.y += LINE_H + ROW_GAP;
  }

  schedule(events: CalendarItem[]): void {
    const f = this.canvas.fonts;
    const timed = events.filter((e) => e.startTime);
    const untimed = events.filter((e) => !e.startTime);
    for (const e of untimed) {
      this.ensure(LINE_H);
      this.canvas.text("ALL DAY", MAIN_X, this.y + BODY_SIZE, { font: f.mono, size: 19, color: INK_60 });
      this.canvas.text(e.title, MAIN_X + 120, this.y + BODY_SIZE, { font: f.uiMedium, size: BODY_SIZE });
      this.y += LINE_H;
    }
    if (untimed.length) this.y += ROW_GAP;

    const startHour = Math.min(7, ...timed.map((e) => Number(e.startTime!.slice(0, 2))));
    const endHour = Math.max(18, ...timed.map((e) => Number((e.endTime ?? e.startTime)!.slice(0, 2)) + 1));
    const rowH = 46;
    const hours = endHour - startHour;
    this.ensure(hours * rowH + 20);
    const top = this.y;
    for (let h = 0; h <= hours; h++) {
      const yy = top + h * rowH;
      this.canvas.hline(MAIN_X + 84, MAIN_X + MAIN_W, yy, h === 0 || h === hours ? 1.5 : 1, INK_30);
      if (h < hours) {
        const hh = startHour + h;
        this.canvas.text(`${String(hh).padStart(2, "0")}:00`, MAIN_X, yy + 26, { font: f.mono, size: 19, color: INK_60 });
      }
    }
    for (const e of timed) {
      const sh = Number(e.startTime!.slice(0, 2)) + Number(e.startTime!.slice(3, 5)) / 60;
      const eh = e.endTime ? Number(e.endTime.slice(0, 2)) + Number(e.endTime.slice(3, 5)) / 60 : sh + 1;
      const y1 = top + (sh - startHour) * rowH;
      const h = Math.max(rowH * 0.9, (eh - sh) * rowH - 4);
      this.canvas.rect(MAIN_X + 92, y1 + 2, 10, h, { fill: INK });
      const label = `${e.startTime}${e.endTime ? `–${e.endTime}` : ""}  ${e.title}${e.location ? ` · ${e.location}` : ""}`;
      this.canvas.text(label, MAIN_X + 116, y1 + 30, { font: f.uiSemibold, size: 25 });
    }
    this.y = top + hours * rowH + 28;
  }

  actionRow(a: ActionItem, code: string, isInbox: boolean): void {
    const f = this.canvas.fonts;
    const textX = MAIN_X + CHECKBOX_PX + 22;
    const codeW = 60;
    const textW = MAIN_W - (textX - MAIN_X) - codeW - 20;
    const lines = this.canvas.wrap(a.text, f.ui, BODY_SIZE, textW);
    const metaParts: string[] = [];
    if (a.due) metaParts.push(`${formatShortDate(a.due)}${a.dueTime ? ` ${a.dueTime}` : ""}`);
    if (a.kind === "follow_up") metaParts.push("follow-up");
    if (a.priority === "high") metaParts.push("HIGH");
    if (a.project) metaParts.push(a.project);
    if (a.people.length) metaParts.push(a.people.join(", "));
    const meta = metaParts.join(" · ");
    const height = lines.length * LINE_H + (meta ? 28 : 0) + ROW_GAP;
    this.ensure(height);
    this.canvas.checkbox(MAIN_X, this.y + 2);
    lines.forEach((l, i) =>
      this.canvas.text(l, textX, this.y + BODY_SIZE + i * LINE_H, { font: isInbox ? f.ui : f.uiMedium, size: BODY_SIZE }),
    );
    this.canvas.text(code, MAIN_X + MAIN_W, this.y + BODY_SIZE, { font: f.monoMedium, size: 19, color: INK_60, align: "right" });
    let yy = this.y + lines.length * LINE_H;
    if (meta) {
      this.canvas.text(meta, textX, yy + 20, { font: f.mono, size: 18, color: INK_60 });
      if (a.carriedCount > 0) {
        const dots = "·".repeat(Math.min(a.carriedCount, 7));
        this.canvas.text(dots, MAIN_X + MAIN_W - codeW - 8, yy + 20, { font: f.monoMedium, size: 22, color: INK_60, align: "right" });
      }
      yy += 28;
    } else if (a.carriedCount > 0) {
      const dots = "·".repeat(Math.min(a.carriedCount, 7));
      this.canvas.text(dots, MAIN_X + MAIN_W - codeW - 8, this.y + BODY_SIZE, { font: f.monoMedium, size: 22, color: INK_60, align: "right" });
    }
    this.y = yy + ROW_GAP;
  }

  inboxRow(i: InboxItem, code: string): void {
    this.actionRow(
      {
        id: i.id,
        text: i.text,
        due: null,
        dueTime: null,
        priority: "normal",
        kind: "action",
        project: i.detail,
        people: [],
        confidence: i.confidence,
        source: i.source,
        carriedCount: 0,
        createdOn: this.model.date,
      },
      code,
      true,
    );
  }

  blankRows(n: number): void {
    for (let k = 0; k < n; k++) {
      this.ensure(LINE_H + ROW_GAP);
      this.canvas.checkbox(MAIN_X, this.y + 2);
      this.canvas.hline(MAIN_X + CHECKBOX_PX + 22, MAIN_X + MAIN_W, this.y + BODY_SIZE + 4, 1, INK_30);
      this.y += LINE_H + ROW_GAP;
    }
  }

  write(): void {
    const m = this.model;
    this.newPage();

    this.sectionTitle("Today", m.events.length ? `${m.events.length} on the calendar` : undefined);
    this.schedule(m.events);

    if (m.upcoming.length) {
      this.sectionTitle("Coming up", "next 7 days");
      for (const e of m.upcoming) {
        this.ensure(LINE_H);
        const f = this.canvas.fonts;
        this.canvas.text(`${formatShortDate(e.date!)}${e.startTime ? ` ${e.startTime}` : ""}`, MAIN_X, this.y + BODY_SIZE, { font: f.mono, size: 19, color: INK_60 });
        this.canvas.text(e.title, MAIN_X + 190, this.y + BODY_SIZE, { font: f.ui, size: BODY_SIZE });
        this.y += LINE_H;
      }
      this.y += ROW_GAP;
    }

    this.sectionTitle("Actions", `${m.actions.length} open`);
    if (m.actions.length === 0) this.emptyLine("Nothing open. Write something down.");
    m.actions.forEach((a, i) => this.actionRow(a, `A${String(i + 1).padStart(2, "0")}`, false));
    this.blankRows(3);

    if (m.meetingRequests.length) {
      this.sectionTitle("Confirm to send", "tick = draft the invite");
      m.meetingRequests.forEach((r, i) =>
        this.actionRow(
          {
            id: r.id,
            text: `Invite: ${r.topic}`,
            due: r.proposedDate,
            dueTime: r.proposedTime,
            priority: "normal",
            kind: "action",
            project: r.durationMinutes ? `${r.durationMinutes} min` : null,
            people: r.attendees,
            confidence: r.confidence,
            source: r.source,
            carriedCount: 0,
            createdOn: m.date,
          },
          `M${String(i + 1).padStart(2, "0")}`,
          false,
        ),
      );
    }

    if (m.inbox.length) {
      this.sectionTitle("Inbox — confirm these", "tick = yes · strike = drop");
      m.inbox.forEach((it, i) => this.inboxRow(it, `I${String(i + 1).padStart(2, "0")}`));
    }

    // Stats line for the dogfood phase (counts only, never content).
    this.ensure(60);
    const s = m.stats;
    this.canvas.text(
      `read ${s.pagesRead} page${s.pagesRead === 1 ? "" : "s"} · ${s.tasksFound} tasks · ${s.eventsFound} events · ${s.meetingRequestsFound} meeting requests`,
      MAIN_X,
      this.y + 30,
      { font: this.canvas.fonts.mono, size: 18, color: INK_60 },
    );
  }
}

export async function composeDailySheet(model: DailySheetModel): Promise<Uint8Array> {
  const doc = await newDocument();
  new SheetWriter(doc, model).write();
  doc.doc.setTitle(`dayMarkable Daily Sheet ${model.date}`);
  return doc.doc.save();
}
