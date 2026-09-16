import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPdfPages } from "./extract.js";

/** A PDF of `n` letter pages, each a different width so a page can be identified after copying. */
async function pdfOf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200 + i, 400]);
  return doc.save();
}

describe("extractPdfPages", () => {
  it("keeps only the pages asked for, in the order asked", async () => {
    const src = await pdfOf(10);
    const { bytes, positions } = await extractPdfPages(src, [7, 2]);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
    expect(positions.get(7)).toBe(0);
    expect(positions.get(2)).toBe(1);
    // Widths identify which source page each one is.
    expect(Math.round(out.getPage(0).getWidth())).toBe(207);
    expect(Math.round(out.getPage(1).getWidth())).toBe(202);
  });

  /**
   * The case this exists for. reMarkable users buy all-in-one planner kits of a couple of thousand
   * pages; annotating one page used to send the entire file base64-encoded in a JSON body.
   */
  it("turns a two-thousand-page template into a three-page request", async () => {
    const src = await pdfOf(2000);
    const { bytes, positions } = await extractPdfPages(src, [11, 1200, 1876]);
    expect(await (await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect([...positions.entries()].sort((a, b) => a[1] - b[1])).toEqual([[11, 0], [1200, 1], [1876, 2]]);

    // The property that matters is not "smaller" but "does not grow with the source". Three pages
    // out of two hundred and three pages out of two thousand must cost the same to send; that is
    // what stops one annotated page carrying a hundred-megabyte planner kit over the wire.
    const small = await extractPdfPages(await pdfOf(200), [11, 120, 187]);
    expect(Math.abs(bytes.length - small.bytes.length)).toBeLessThan(bytes.length * 0.1);
    expect(bytes.length).toBeLessThan(src.length);
  });

  it("ignores indexes outside the document instead of throwing", async () => {
    const src = await pdfOf(5);
    const { bytes, positions } = await extractPdfPages(src, [-1, 2, 99]);
    expect(await (await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(positions.get(2)).toBe(0);
    expect(positions.has(99)).toBe(false);
    expect(positions.has(-1)).toBe(false);
  });

  it("copies a page asked for twice only once", async () => {
    const src = await pdfOf(5);
    const { bytes, positions } = await extractPdfPages(src, [3, 3]);
    expect(await (await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(positions.get(3)).toBe(0);
  });

  it("does not throw when nothing was asked for", async () => {
    // Defensive only: the renderer never calls this with an empty list, because it returns early
    // when there are no pages to render.
    const { bytes, positions } = await extractPdfPages(await pdfOf(4), []);
    expect(positions.size).toBe(0);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
