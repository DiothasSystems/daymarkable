/** The Meeting Notes notebook: one section per decoded meeting, appended chronologically. */
import type { MeetingNotesModel } from "@daymarkable/core";
import { SECONDARY } from "./brand.js";
import { newDocument } from "./canvas.js";
import type { ComposedDocument } from "./planner.js";
import { LINE_H, MAIN_X, Section, formatShortDate, generatedStamp, type ComposeContext } from "./section.js";

export interface MeetingNotesInput {
  model: MeetingNotesModel;
  date: string;
  generatedAt: string;
  runLabel: string;
}

export async function composeMeetingNotes(input: MeetingNotesInput): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: input.date, generatedAt: input.generatedAt, runLabel: input.runLabel, printed: [] };
  const meetings = input.model.meetings;
  const s = new Section(ctx, "MEETINGS", (p) => (p === 1 ? "Meeting Notes" : "Meeting Notes · cont."), () => `dayMarkable MEETINGS · ${meetings.length} MEETING${meetings.length === 1 ? "" : "S"} · ${generatedStamp(ctx)}`);
  s.newPage();
  if (meetings.length === 0) {
    s.label("No meetings decoded yet");
    s.note("Title a page with the meeting and its date; the notes arrive here and by email.");
  }
  meetings.forEach((m, i) => {
    if (i > 0) s.divider();
    s.ensure(240);
    s.heading(m.topic, `${m.date ? formatShortDate(m.date).toUpperCase() : "UNDATED"}${m.time ? ` · ${m.time}` : ""}`);
    s.ensure(LINE_H);
    s.canvas.text(s.canvas.fit(`WITH ${m.attendees.length ? m.attendees.join(", ").toUpperCase() : "—"} · ${m.source.notebook.toUpperCase()} · p.${m.source.pageIndex + 1} · ${Math.round(m.confidence * 100)}% SURE`, s.canvas.fonts.mono, 24, s.canvas.textWidth("W", s.canvas.fonts.mono, 24) * 60), MAIN_X, s.y + 24, { font: s.canvas.fonts.mono, size: 24, color: SECONDARY, tracking: 0.04 });
    s.y += 48;
    for (const para of (m.text || "(no notes captured)").split(/\n{2,}/)) {
      s.paragraph(para.trim());
      s.y += 12;
    }
    if (m.decisions.length) {
      s.label("Decisions");
      for (const d of m.decisions) s.arrowRow(d);
      s.y += 12;
    }
    if (m.actions.length) {
      s.label("Actions");
      for (const a of m.actions) s.arrowRow(a);
    }
    s.y += 30;
  });
  doc.setTitle(`dayMarkable Meeting Notes ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}
