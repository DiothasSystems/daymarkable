/** The Meeting Notes notebook: one section per decoded meeting, appended chronologically. */
import type { MeetingNotesModel } from "@daymarkable/core";
import { INK_60 } from "./brand.js";
import { newDocument } from "./canvas.js";
import type { ComposedDocument } from "./planner.js";
import { LINE_H, MAIN_X, Section, formatShortDate, type ComposeContext } from "./section.js";

export interface MeetingNotesInput {
  model: MeetingNotesModel;
  date: string;
  generatedAt: string;
  runLabel: string;
}

export async function composeMeetingNotes(input: MeetingNotesInput): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: input.date, generatedAt: input.generatedAt, runLabel: input.runLabel, printed: [] };
  const subtitle = `MEETING NOTES · ${input.runLabel.toUpperCase()} · generated ${input.generatedAt.slice(11, 16)}`;
  const s = new Section(ctx, "MEETINGS", (p) => (p === 1 ? "Meeting Notes" : "Meeting Notes · cont."), subtitle);
  s.newPage();
  const meetings = input.model.meetings;
  if (meetings.length === 0) {
    s.sectionTitle("No meetings decoded yet");
    s.note("Title a page with the meeting topic and date; the notes arrive here and by email.");
  }
  for (const m of meetings) {
    s.ensure(200);
    s.sectionTitle(m.topic, `${m.date ? formatShortDate(m.date) : "undated"}${m.time ? ` ${m.time}` : ""}`);
    const f = s.canvas.fonts;
    s.ensure(LINE_H);
    s.canvas.text(`with ${m.attendees.length ? m.attendees.join(", ") : "—"}  ·  from “${m.source.notebook}” p${m.source.pageIndex + 1}  ·  ${Math.round(m.confidence * 100)}% sure`, MAIN_X, s.y + 22, { font: f.mono, size: 18, color: INK_60 });
    s.y += LINE_H;
    for (const para of (m.text || "(no notes captured)").split(/\n{2,}/)) s.paragraph(para.trim());
    if (m.decisions.length) {
      s.subheading("Decisions");
      for (const d of m.decisions) s.bullet(d);
    }
    if (m.actions.length) {
      s.subheading("Actions");
      for (const a of m.actions) s.bullet(a);
    }
    s.y += 24;
  }
  doc.setTitle(`dayMarkable Meeting Notes ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}
