/**
 * The living Action List notebook (rule 8): every open item, grouped by when it is due and ranked
 * by priority within that (core actionBuckets.ts), regenerated in full each night. Ticks roll items
 * off, strikes drop them, blank rows add; a date on a row's DUE line or a tick in its L / M / H box
 * sets its due date or priority (rule 6 — decode/prompt.ts describes exactly this page).
 */
import type { ActionListModel } from "@daymarkable/core";
import { SECONDARY } from "./brand.js";
import { newDocument } from "./canvas.js";
import { actionTag } from "./dailySheet.js";
import type { ComposedDocument } from "./planner.js";
import { BODY_SIZE, LINE_H, MAIN_X, Section, generatedStamp, type ComposeContext } from "./section.js";

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
  const s = new Section(ctx, "ACTIONS", (p) => (p === 1 ? "Action List" : "Action List · cont."), () => `ACTIONS · ${m.openCount} OPEN · ${generatedStamp(ctx)}`);
  s.newPage();
  if (m.openCount === 0) s.note("Nothing open. Write something down.");
  // One group per due bucket (Overdue, Today, Next 7 days, Later, No date yet). The groups no
  // longer say where an action came from, so every row does: its notebook and page, under the text.
  for (const g of m.groups) {
    s.priorityLabel(g.label, `${g.tasks.length}`);
    for (const t of g.tasks) {
      const source = t.source.notebook.trim() ? `${t.source.notebook.trim().toUpperCase()} · p.${t.source.pageIndex + 1}` : null;
      // Medium is the default and goes unsaid; High and Low are printed, since the boxes never are.
      const priority = t.priority === "high" ? "HIGH" : t.priority === "low" ? "LOW" : null;
      // The DUE line is left blank for the pen: what is already known — the date, or how long the
      // action has been carried — leads the grey line under the text instead.
      const known = t.due ? actionTag(t, input.date) : t.carriedCount > 0 ? `CARRIED ${t.carriedCount}D` : null;
      const meta = [known, priority, t.kind === "follow_up" ? "follow-up" : null, t.project, t.people.length ? t.people.join(", ") : null, source].filter(Boolean).join(" · ");
      s.checkboxRow(
        { id: t.id, type: "task", text: t.text, tag: null, meta: meta || null, carried: t.carriedCount > 0, emphasis: t.priority === "high", priorityField: true },
        "A",
      );
    }
    s.y += 12;
  }
  s.note("Write a date on a row's DUE line, or tick L, M or H to set its priority.");
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
  doc.setTitle(`ScriptumIQ Action List ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}
