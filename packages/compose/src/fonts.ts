import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(here, "..", "fonts");

export interface BrandFonts {
  display: PDFFont;
  displayItalic: PDFFont;
  ui: PDFFont;
  uiMedium: PDFFont;
  uiSemibold: PDFFont;
  mono: PDFFont;
  monoMedium: PDFFont;
}

const cache = new Map<string, Uint8Array>();
async function fontBytes(file: string): Promise<Uint8Array> {
  const hit = cache.get(file);
  if (hit) return hit;
  const bytes = new Uint8Array(await readFile(path.join(FONT_DIR, file)));
  cache.set(file, bytes);
  return bytes;
}

export async function embedBrandFonts(doc: PDFDocument): Promise<BrandFonts> {
  doc.registerFontkit(fontkit);
  const embed = async (file: string) => doc.embedFont(await fontBytes(file), { subset: true });
  const [display, displayItalic, ui, uiMedium, uiSemibold, mono, monoMedium] = await Promise.all([
    embed("InstrumentSerif-Regular.ttf"),
    embed("InstrumentSerif-Italic.ttf"),
    embed("PublicSans-Regular.ttf"),
    embed("PublicSans-Medium.ttf"),
    embed("PublicSans-SemiBold.ttf"),
    embed("IBMPlexMono-Regular.ttf"),
    embed("IBMPlexMono-Medium.ttf"),
  ]);
  return { display, displayItalic, ui, uiMedium, uiSemibold, mono, monoMedium };
}
