/**
 * The living Action List notebook (rule 8): every open item, grouped by date then priority,
 * regenerated in full each night. Ticks roll items off, strikes drop them, blank rows add.
 */
import type { ActionListModel } from "@daymarkable/core";
import { SECONDARY } from "./brand.js";
import { newDocument } from "./canvas.js";
import { actionTag } from "./dailySheet.js";
import type { ComposedDocument } from "./planner.js";
import { BODY_SIZE, LINE_H, MAIN_X, Section, formatShortDate, formatTag, generatedStamp, sourceRef, type ComposeContext } from "./section.js";

export interface ActionListInput {
  model: ActionListModel;
  date: string;
  generatedAt: string;
  runLabel: string;
}

export async function composeActionList(input: ActionListInput): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: input.date, generatedAt: input.generatedAt, runLabel: input.runLabel, printed: [] };
  const m = input.model;
  const s = new Section(ctx, "ACTIONS", (p) => (p === 1 ? "Action List" : "Action List · cont."), () => `dayMarkable ACTIONS · ${m.openCount} OPEN · ${generatedStamp(ctx)}`);
  s.newPage();
  if (m.openCount === 0) s.note("Nothing open. Write something down.");
  for (const g of m.groups) {
    const label = g.date ? (g.date === input.date ? "Today" : formatShortDate(g.date)) : g.label;
    s.label(label, `${g.tasks.length}`, "WHEN / PRI");
    for (const t of g.tasks) {
      // The field is for writing in, so print only what the group heading does not already say.
      const tag = g.date
        ? (t.carriedCount ? `CARRIED ${t.carriedCount}D` : t.dueTime ?? null)
        : g.label === "Priority"
          ? (t.carriedCount ? `CARRIED ${t.carriedCount}D` : null)
          : actionTag(t, input.date);
      // Source reference first: it is what makes a misread traceable back to the ink.
      const meta = [sourceRef(t.source), t.kind === "follow_up" ? "follow-up" : null, t.project, t.people.length ? t.people.join(", ") : null].filter(Boolean).join(" · ");
      s.checkboxRow({ id: t.id, type: "task", text: t.text, tag: g.label === "Overdue" && t.due ? `DUE ${formatTag(t.due)}` : tag, meta, carried: t.carriedCount > 0, emphasis: t.priority === "high", field: true }, "A");
    }
    s.y += 12;
  }
  s.note("Write a date or a priority (! for high) on any row's WHEN / PRI line.");
  s.label("Add by hand");
  s.blankRows(5);
  if (m.completedRecently.length) {
    s.y += 12;
    s.label("Done since yesterday", `${m.completedRecently.length}`);
    for (const t of m.completedRecently) {
      s.ensure(LINE_H);
      s.canvas.text(`✓ ${t.text}`, MAIN_X, s.y + BODY_SIZE, { font: s.canvas.fonts.ui, size: 33, color: SECONDARY });
      s.y += LINE_H;
    }
  }
  doc.setTitle(`dayMarkable Action List ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}
