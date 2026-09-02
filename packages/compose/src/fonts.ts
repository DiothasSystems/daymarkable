import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Fonts ship in packages/compose/fonts; bundlers relocate this module, so try the known homes. */
const FONT_DIR = [process.env.DAYMARKABLE_FONTS_DIR, path.resolve(here, "..", "fonts"), path.resolve(here, "..", "..", "fonts"), path.resolve(process.cwd(), "packages", "compose", "fonts"), path.resolve(process.cwd(), "..", "..", "packages", "compose", "fonts")]
  .filter((p): p is string => !!p)
  .find((p) => existsSync(path.join(p, "PublicSans-Regular.ttf"))) ?? path.resolve(here, "..", "fonts");

export interface BrandFonts {
  /** Source Serif 4 Bold — wordmark, page titles. */
  display: PDFFont;
  /** Source Serif 4 Semibold — headlines. */
  displaySemi: PDFFont;
  displayItalic: PDFFont;
  ui: PDFFont;
  uiMedium: PDFFont;
  uiSemibold: PDFFont;
  uiBold: PDFFont;
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
  const [display, displaySemi, displayItalic, ui, uiMedium, uiSemibold, uiBold, mono, monoMedium] = await Promise.all([
    embed("SourceSerif4-Bold.ttf"),
    embed("SourceSerif4-Semibold.ttf"),
    embed("SourceSerif4-It.ttf"),
    embed("PublicSans-Regular.ttf"),
    embed("PublicSans-Medium.ttf"),
    embed("PublicSans-SemiBold.ttf"),
    embed("PublicSans-Bold.ttf"),
    embed("IBMPlexMono-Regular.ttf"),
    embed("IBMPlexMono-Medium.ttf"),
  ]);
  return { display, displaySemi, displayItalic, ui, uiMedium, uiSemibold, uiBold, mono, monoMedium };
}
