/**
 * The Daily Sheet (README core feature 3): today's date, calendar block, prioritized action
 * list with checkboxes, carried-over dot counts, Inbox to confirm, and a margin column.
 *
 * Layout contract with the decoder: see PLANNER_LAYOUT_DESCRIPTION in packages/decode.
 * Change both together (CLAUDE.md rule 6).
 */
import type { ActionItem, CalendarItem, DailySheetModel, PrintedItem } from "@daymarkable/core";
import { INK, INK_30, INK_60 } from "./brand.js";
import { newDocument } from "./canvas.js";
import { BODY_SIZE, LINE_H, MAIN_X, ROW_GAP, Section, formatLongDate, formatShortDate, type ComposeContext, type RowItem } from "./section.js";

export { formatLongDate, formatShortDate } from "./section.js";

export function dailyPageCode(date: string, page: number): string {
  return `dM/DAY/${date}/${page}`;
}

function actionMeta(a: ActionItem): string | null {
  const parts: string[] = [];
  if (a.due) parts.push(`${formatShortDate(a.due)}${a.dueTime ? ` ${a.dueTime}` : ""}`);
  if (a.kind === "follow_up") parts.push("follow-up");
  if (a.priority === "high") parts.push("HIGH");
  if (a.project) parts.push(a.project);
  if (a.people.length) parts.push(a.people.join(", "));
  return parts.join(" · ") || null;
}

export function actionRowItem(a: ActionItem): RowItem {
  return { id: a.id, type: "task", text: a.text, meta: actionMeta(a), carriedCount: a.carriedCount, emphasis: true };
}

function schedule(s: Section, events: CalendarItem[]): void {
  const f = s.canvas.fonts;
  const timed = events.filter((e) => e.startTime);
  const untimed = events.filter((e) => !e.startTime);
  for (const e of untimed) {
    s.ensure(LINE_H);
    s.canvas.text("ALL DAY", MAIN_X, s.y + BODY_SIZE, { font: f.mono, size: 19, color: INK_60 });
    s.canvas.text(e.title, MAIN_X + 120, s.y + BODY_SIZE, { font: f.uiMedium, size: BODY_SIZE });
    s.y += LINE_H;
  }
  if (untimed.length) s.y += ROW_GAP;

  const startHour = Math.min(7, ...timed.map((e) => Number(e.startTime!.slice(0, 2))));
  const endHour = Math.max(18, ...timed.map((e) => Number((e.endTime ?? e.startTime)!.slice(0, 2)) + 1));
  const rowH = 46;
  const hours = endHour - startHour;
  s.ensure(hours * rowH + 20);
  const top = s.y;
  const right = MAIN_X + s.mainWidth;
  for (let h = 0; h <= hours; h++) {
    const yy = top + h * rowH;
    s.canvas.hline(MAIN_X + 84, right, yy, h === 0 || h === hours ? 1.5 : 1, INK_30);
    if (h < hours) {
      s.canvas.text(`${String(startHour + h).padStart(2, "0")}:00`, MAIN_X, yy + 26, { font: f.mono, size: 19, color: INK_60 });
    }
  }
  for (const e of timed) {
    const sh = Number(e.startTime!.slice(0, 2)) + Number(e.startTime!.slice(3, 5)) / 60;
    const eh = e.endTime ? Number(e.endTime.slice(0, 2)) + Number(e.endTime.slice(3, 5)) / 60 : sh + 1;
    const y1 = top + (sh - startHour) * rowH;
    const h = Math.max(rowH * 0.9, (eh - sh) * rowH - 4);
    s.canvas.rect(MAIN_X + 92, y1 + 2, 10, h, { fill: INK });
    const label = `${e.startTime}${e.endTime ? `–${e.endTime}` : ""}  ${e.title}${e.location ? ` · ${e.location}` : ""}`;
    s.canvas.text(label, MAIN_X + 116, y1 + 30, { font: f.uiSemibold, size: 25 });
  }
  s.y = top + hours * rowH + 28;
}

export function writeDailySheet(ctx: ComposeContext, m: DailySheetModel): void {
  const time = m.generatedAt.slice(11, 16);
  const subtitle = `DAILY SHEET · ${m.runLabel.toUpperCase()} · generated ${time}`;
  const s = new Section(ctx, "DAY", (p) => (p === 1 ? formatLongDate(m.date) : `${formatShortDate(m.date)} · cont.`), subtitle);
  s.newPage();

  s.sectionTitle("Today", m.events.length ? `${m.events.length} on the calendar` : undefined);
  schedule(s, m.events);

  if (m.upcoming.length) {
    s.sectionTitle("Coming up", "next 7 days");
    for (const e of m.upcoming) {
      s.ensure(LINE_H);
      const f = s.canvas.fonts;
      s.canvas.text(`${formatShortDate(e.date!)}${e.startTime ? ` ${e.startTime}` : ""}`, MAIN_X, s.y + BODY_SIZE, { font: f.mono, size: 19, color: INK_60 });
      s.canvas.text(e.title, MAIN_X + 190, s.y + BODY_SIZE, { font: f.ui, size: BODY_SIZE });
      s.y += LINE_H;
    }
    s.y += ROW_GAP;
  }

  s.sectionTitle("Actions", `${m.actions.length} shown`);
  if (m.actions.length === 0) s.note("Nothing open. Write something down.");
  for (const a of m.actions) s.checkboxRow(actionRowItem(a), "A");
  s.blankRows(3);

  if (m.meetingRequests.length) {
    s.sectionTitle("Confirm to send", "tick = draft the invite");
    for (const r of m.meetingRequests) {
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

  if (m.inbox.length) {
    s.sectionTitle("Inbox — confirm these", "tick = yes · strike = drop");
    for (const it of m.inbox) s.checkboxRow({ id: it.id, type: "inbox", text: it.text, meta: it.detail, carriedCount: 0, emphasis: false }, "I");
  }

  s.ensure(60);
  const st = m.stats;
  s.canvas.text(
    `read ${st.pagesRead} page${st.pagesRead === 1 ? "" : "s"} · ${st.tasksFound} tasks · ${st.eventsFound} events · ${st.meetingRequestsFound} meeting requests`,
    MAIN_X,
    s.y + 30,
    { font: s.canvas.fonts.mono, size: 18, color: INK_60 },
  );
}

/** Standalone Daily Sheet (used by the Milestone 1 spike). */
export async function composeDailySheet(model: DailySheetModel): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument();
  const printed: PrintedItem[] = [];
  writeDailySheet({ doc, fonts, date: model.date, generatedAt: model.generatedAt, runLabel: model.runLabel, printed }, model);
  doc.setTitle(`dayMarkable Daily Sheet ${model.date}`);
  return doc.save();
}
