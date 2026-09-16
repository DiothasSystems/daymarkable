/** Rendering behind an interface so fixture runs need no render service. */
import { extractPdfPages } from "@daymarkable/compose";
import type { DownloadedDocument } from "@daymarkable/tablet";
import { RenderServiceError, renderHealthy, renderPdfPages, renderRmPages, type RenderedSegment } from "./render-client.js";

export interface PageImages {
  pageId: string;
  pageIndex: number;
  segments: Uint8Array[];
  renderer: string;
  /** The page's strokes, when it was drawn rather than rasterised from a PDF. */
  svg: string | null;
}

export interface Renderer {
  renderDocument(doc: DownloadedDocument, pageIds: readonly string[], options?: { cropTop?: number | null }): Promise<{ pages: PageImages[]; failed: Array<{ pageId: string; reason: string }> }>;
}

export class HttpRenderer implements Renderer {
  constructor(private readonly baseUrl: string) {}

  async check(): Promise<void> {
    if (!(await renderHealthy(this.baseUrl))) throw new RenderServiceError(`render service not reachable at ${this.baseUrl}`);
  }

  async renderDocument(doc: DownloadedDocument, pageIds: readonly string[], options: { cropTop?: number | null } = {}): Promise<{ pages: PageImages[]; failed: Array<{ pageId: string; reason: string }> }> {
    const want = new Set(pageIds);
    const pages = doc.pages.filter((p) => want.has(p.pageId));
    const byId = new Map(doc.pages.map((p) => [p.pageId, p] as const));

    // Send only the PDF pages being rendered. A planner template runs to thousands of pages, and
    // the whole file used to travel base64-encoded in the request body for the sake of one
    // annotated page — which no timeout survives. Indexes are remapped to the extract.
    let basePdf = doc.basePdf;
    let positionOf = (index: number): number | null => index;
    if (basePdf) {
      try {
        const extracted = await extractPdfPages(basePdf, pages.map((p) => p.index));
        basePdf = extracted.bytes;
        positionOf = (index) => extracted.positions.get(index) ?? null;
      } catch {
        // An unreadable PDF is not fatal: render the ink alone rather than failing the page.
        basePdf = null;
        positionOf = () => null;
      }
    }

    const { segments, errors } = await renderRmPages(
      this.baseUrl,
      pages.map((p) => ({ pageId: p.pageId, rm: p.rm, pdfPageIndex: basePdf ? positionOf(p.index) : null, cropTop: options.cropTop ?? null })),
      basePdf,
    );
    const grouped = groupSegments(segments, (s) => s.pageId);
    const failed: Array<{ pageId: string; reason: string }> = [];
    // Fallback: rasterize the PDF page alone for pages whose ink failed to parse.
    if (errors.length && basePdf) {
      // Positions inside the extract, and a way back to the page each one came from.
      const positions: number[] = [];
      const pageAt = new Map<number, string>();
      for (const e of errors) {
        const at = positionOf(byId.get(e.pageId)!.index);
        if (at === null) continue;
        positions.push(at);
        pageAt.set(at, e.pageId);
      }
      try {
        const pdfSegs = await renderPdfPages(this.baseUrl, basePdf, positions);
        for (const [idx, segs] of groupSegments(pdfSegs, (s) => s.pageId)) {
          const pageId = pageAt.get(Number(idx));
          if (pageId) grouped.set(pageId, segs);
        }
      } catch (err) {
        for (const e of errors) failed.push({ pageId: e.pageId, reason: `${e.code}; pdf fallback failed: ${(err as Error).message}` });
      }
    } else {
      for (const e of errors) failed.push({ pageId: e.pageId, reason: e.code });
    }
    const out: PageImages[] = [];
    for (const [pageId, segs] of grouped) {
      const p = byId.get(pageId)!;
      // The strokes describe the whole page, so they ride on its first segment.
      out.push({ pageId, pageIndex: p.index, segments: segs.map((s) => s.png), renderer: segs[0]?.renderer ?? "?", svg: segs[0]?.svg ?? null });
    }
    return { pages: out, failed };
  }
}

function groupSegments(segments: RenderedSegment[], key: (s: RenderedSegment) => string): Map<string, RenderedSegment[]> {
  const m = new Map<string, RenderedSegment[]>();
  for (const s of segments) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
  for (const list of m.values()) list.sort((a, b) => a.segment - b.segment);
  return m;
}
