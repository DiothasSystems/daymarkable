/** The dayLy Update notebook: the overnight news brief, one section per topic. */
import { SECONDARY } from "./brand.js";
import { newDocument } from "./canvas.js";
import type { ComposedDocument } from "./planner.js";
import { LINE_H, MAIN_X, Section, compiledAt, type ComposeContext } from "./section.js";

export interface DailyUpdateItem {
  headline: string;
  summary: string;
  source: string | null;
}

export interface DailyUpdateSection {
  topic: string;
  items: DailyUpdateItem[];
}

export interface DailyUpdateInput {
  sections: DailyUpdateSection[];
  date: string;
  generatedAt: string;
  runLabel: string;
  /** Shown instead of the brief when the gathering failed. Never the raw error. */
  unavailable?: string | null;
}

export async function composeDailyUpdate(input: DailyUpdateInput): Promise<ComposedDocument> {
  const { doc, fonts } = await newDocument();
  const ctx: ComposeContext = { doc, fonts, date: input.date, generatedAt: input.generatedAt, runLabel: input.runLabel, printed: [] };
  const count = input.sections.reduce((n, s) => n + s.items.length, 0);
  const s = new Section(
    ctx,
    "NEWS",
    (p) => (p === 1 ? "dayLy Update" : "dayLy Update · cont."),
    () => `NEWS · ${count} HEADLINE${count === 1 ? "" : "S"}`,
    // The compile time, right-aligned and on its own: a reader glancing at the top corner wants to
    // know this is today's brief, and a bare clock reading says that without a label.
    () => compiledAt(ctx),
  );
  s.newPage();

  if (input.unavailable) {
    s.label("No brief this morning");
    s.note(input.unavailable);
  } else if (count === 0) {
    s.label("Nothing worth reporting");
    s.note("Your topics turned up no significant stories overnight. Add or change topics in your account settings.");
  }

  input.sections.forEach((section, i) => {
    if (i > 0) s.divider();
    s.ensure(200);
    s.heading(section.topic, `${section.items.length} STOR${section.items.length === 1 ? "Y" : "IES"}`);

    if (section.items.length === 0) {
      s.ensure(LINE_H);
      s.note("Nothing significant overnight.");
      s.y += 12;
      return;
    }

    for (const item of section.items) {
      // Keep a headline with at least the first line of its summary: a headline alone at the foot
      // of a page reads as a story that was cut off.
      s.ensure(LINE_H * 3);
      s.bulletRow("—", item.headline, 0, 36, 50);
      if (item.summary) s.notesBlock(item.summary, 31, 43);
      if (item.source) {
        s.ensure(LINE_H);
        s.canvas.text(item.source.toUpperCase(), MAIN_X, s.y + 22, {
          font: s.canvas.fonts.mono,
          size: 22,
          color: SECONDARY,
          tracking: 0.12,
        });
        s.y += 40;
      }
      s.y += 18;
    }
  });

  doc.setTitle(`dayLy Update ${input.date}`);
  return { pdf: await doc.save(), pageCount: doc.getPageCount(), printed: ctx.printed };
}
