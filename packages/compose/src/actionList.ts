/**
 * The living Action List notebook (rule 8): every open item, grouped by date then priority,
 * regenerated in full each night. Ticks roll items off, strikes drop them, blank rows add.
 */
import type { ActionListModel } from "@daymarkable/core";
import { INK_60 } from "./brand.js";
import { newDocument } from "./canvas.js";
import { actionRowItem } from "./dailySheet.js";
import type { ComposedDocument } from "./planner.js";
import { BODY_SIZE, LINE_H, MAIN_X, Section, formatLongDate, formatShortDate, type ComposeContext } from "./section.js";

export interface ActionListInput {
  model: ActionListModel;
  date: string;
  generatedAt: string;
  runLabel: string;
}

export async function composeActionList(input: ActionListInput): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: input.date, generatedAt: input.generatedAt, runLabel: input.runLabel, printed: [] };
  const subtitle = `ACTION LIST · ${input.runLabel.toUpperCase()} · generated ${input.generatedAt.slice(11, 16)}`;
  const s = new Section(ctx, "ACTIONS", (p) => (p === 1 ? "Action List" : "Action List · cont."), subtitle);
  s.newPage();
  const m = input.model;
  s.sectionTitle(formatLongDate(input.date), `${m.openCount} open`);
  if (m.openCount === 0) s.note("Nothing open. Write something down.");
  for (const g of m.groups) {
    const label = g.date ? (g.date === input.date ? "Today" : formatShortDate(g.date)) : g.label;
    s.subheading(label, `${g.tasks.length}`);
    for (const t of g.tasks) s.checkboxRow(actionRowItem(t), "A");
  }
  s.subheading("Add by hand");
  s.blankRows(5);
  if (m.completedRecently.length) {
    s.subheading("Done since yesterday", `${m.completedRecently.length}`);
    for (const t of m.completedRecently) {
      s.ensure(LINE_H);
      s.canvas.text(`✓ ${t.text}`, MAIN_X, s.y + BODY_SIZE, { font: s.canvas.fonts.ui, size: 24, color: INK_60 });
      s.y += LINE_H;
    }
  }
  doc.setTitle(`dayMarkable Action List ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}
