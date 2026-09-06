/**
 * The living Action List notebook (rule 8): every open item, grouped by the page it was written
 * on, regenerated in full each night. Ticks roll items off, strikes drop them, blank rows add.
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
  const s = new Section(ctx, "ACTIONS", (p) => (p === 1 ? "Action List" : "Action List · cont."), () => `dayMarkable ACTIONS · ${m.openCount} OPEN · ${generatedStamp(ctx)}`);
  s.newPage();
  if (m.openCount === 0) s.note("Nothing open. Write something down.");
  // One group per source page: the notebook's name, then the page reference and the page's own
  // date beneath it. The heading carries the provenance, so rows no longer repeat it.
  for (const g of m.groups) {
    s.label(g.label, `${g.tasks.length}`, "WHEN / PRI");
    if (g.subtitle) s.sublabel(g.subtitle);
    for (const t of g.tasks) {
      const meta = [t.kind === "follow_up" ? "follow-up" : null, t.project, t.people.length ? t.people.join(", ") : null].filter(Boolean).join(" · ");
      s.checkboxRow(
        { id: t.id, type: "task", text: t.text, tag: actionTag(t, input.date), meta: meta || null, carried: t.carriedCount > 0, emphasis: t.priority === "high", field: true },
        "A",
      );
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
