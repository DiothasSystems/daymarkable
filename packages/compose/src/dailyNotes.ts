/**
 * "Notes - 10-01-2026": everything written on one day, one section per notebook, its new lines under
 * the page they were written on. Output only — it is never read back (pipeline NEVER_READ_BACK), so
 * it carries no checkboxes and no ruled writing area, and rule 6 does not apply to it.
 */
import type { DailyNotesModel } from "@daymarkable/core";
import { newDocument } from "./canvas.js";
import type { ComposedDocument } from "./planner.js";
import { Section, formatTitleDate, generatedStamp, type ComposeContext } from "./section.js";

export interface DailyNotesInput {
  model: DailyNotesModel;
  generatedAt: string;
  runLabel: string;
}

export async function composeDailyNotes(input: DailyNotesInput): Promise<ComposedDocument> {
  const { model } = input;
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: model.date, generatedAt: input.generatedAt, runLabel: input.runLabel, printed: [] };
  const n = model.notebooks.length;
  const s = new Section(
    ctx,
    "NOTES",
    (p) => (p === 1 ? `Notes · ${formatTitleDate(model.date)}` : "Notes · cont."),
    () => `NOTES · ${n} NOTEBOOK${n === 1 ? "" : "S"} · ${generatedStamp(ctx)}`,
  );
  s.newPage();
  if (n === 0) s.note("Nothing new was written on this day.");
  model.notebooks.forEach((nb, i) => {
    if (i > 0) s.divider();
    s.ensure(200);
    s.heading(nb.notebook, `${nb.pages.length} PAGE${nb.pages.length === 1 ? "" : "S"}`);
    for (const page of nb.pages) {
      s.sublabel(`PAGE ${page.pageIndex + 1}`);
      s.notesBlock(page.lines.join("\n"));
      s.y += 18;
    }
    s.y += 24;
  });
  doc.setTitle(`ScriptumIQ Notes ${model.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: [] };
}
