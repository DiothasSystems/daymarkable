/**
 * The handwriting calibration sheet: the generated passage printed at the top, then ruled
 * lines for the user to copy it out by hand underneath. The written half is what the decoder
 * later learns from, so the ruled area matches the passage line for line.
 */
import { INK, RULE, SECONDARY, TERTIARY } from "./brand.js";
import { BODY_BOTTOM, CONTENT_RIGHT, CONTENT_W, CONTENT_X, addPage, newDocument } from "./canvas.js";
import { formatTitleDate, pageCode } from "./section.js";

export interface CalibrationSheetInput {
  /** The passage to copy, one line per written line. */
  text: string;
  date: string;
  generatedAt: string;
}

export async function composeCalibrationSheet(input: CalibrationSheetInput): Promise<Uint8Array> {
  const { doc, fonts } = await newDocument();
  const c = addPage(doc, fonts, 1);
  const page = pageCode("DAY", input.date, 1).replace("/DAY/", "/SAMPLE/");
  const top = c.header("Handwriting sample", `dayMarkable CALIBRATION · ${formatTitleDate(input.date).toUpperCase()}`);
  c.footer(page);

  let y = top;
  y += c.label("Copy these lines in your own handwriting", CONTENT_X, y);
  c.text("ONE LINE EACH", CONTENT_RIGHT, y - 24, { font: fonts.mono, size: 24, color: TERTIARY, align: "right", tracking: 0.08 });
  c.text("Write naturally — the point is your normal hand, not your best hand.", CONTENT_X, y + 30, { font: fonts.displayItalic, size: 30, color: SECONDARY });
  y += 60;

  const lines = input.text.split("\n").map((l) => l.trim()).filter(Boolean);
  // Printed passage, boxed so it is obviously not handwriting.
  const printedH = lines.length * 40 + 36;
  c.rect(CONTENT_X, y, CONTENT_W, printedH, { stroke: RULE, thickness: 3, radius: 6 });
  lines.forEach((l, i) => c.text(c.fit(l, fonts.mono, 27, CONTENT_W - 48), CONTENT_X + 24, y + 30 + i * 40, { font: fonts.mono, size: 27, color: INK }));
  y += printedH + 48;

  y += c.label("Your handwriting", CONTENT_X, y);
  // One ruled line per passage line, always: shrink the gap to fit rather than dropping lines.
  const remaining = BODY_BOTTOM - y - 12;
  const gap = Math.max(54, Math.min(96, Math.floor(remaining / Math.max(1, lines.length))));
  for (let i = 0; i < lines.length && y + gap <= BODY_BOTTOM + 8; i++) {
    c.text(String(i + 1).padStart(2, "0"), CONTENT_X, y + gap - 20, { font: fonts.mono, size: 21, color: TERTIARY });
    c.hline(CONTENT_X + 54, CONTENT_RIGHT, y + gap - 12, 3, RULE);
    y += gap;
  }

  doc.setTitle("dayMarkable Handwriting Sample");
  return doc.save();
}
