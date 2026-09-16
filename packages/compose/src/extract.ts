/**
 * Pull a handful of pages out of a large PDF.
 *
 * The render service takes the page's ink and the PDF page it sits on, and composites one over
 * the other. The PDF travelled there base64-encoded in the request body, which is fine for a
 * twenty-page document and impossible for a planner template: reMarkable users buy all-in-one
 * kits of two thousand pages, and a single annotated page would have carried the whole file —
 * a hundred megabytes or more of PDF becoming half as much again as base64, against a three
 * minute timeout.
 *
 * So send the pages being rendered and nothing else. Three pages out of two thousand is a few
 * hundred kilobytes.
 */
import { PDFDocument } from "pdf-lib";

export interface ExtractedPdf {
  bytes: Uint8Array;
  /**
   * Position of each requested page within `bytes`, in the order requested. An index that was out
   * of range for the source document is absent, so the caller can tell what it actually got.
   */
  positions: Map<number, number>;
}

/**
 * A PDF holding only `indexes`, in the order given. Duplicates are collapsed: asking for the same
 * page twice copies it once and both callers are pointed at it.
 */
export async function extractPdfPages(pdf: Uint8Array, indexes: readonly number[]): Promise<ExtractedPdf> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const total = src.getPageCount();
  const wanted: number[] = [];
  for (const i of indexes) {
    if (Number.isInteger(i) && i >= 0 && i < total && !wanted.includes(i)) wanted.push(i);
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, wanted);
  for (const page of copied) out.addPage(page);
  const positions = new Map<number, number>();
  wanted.forEach((original, position) => positions.set(original, position));
  return { bytes: await out.save(), positions };
}
