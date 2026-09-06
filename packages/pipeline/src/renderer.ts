/** Rendering behind an interface so fixture runs need no render service. */
import type { DownloadedDocument } from "@daymarkable/tablet";
import { RenderServiceError, renderHealthy, renderPdfPages, renderRmPages, type PageLayout, type RenderedSegment } from "./render-client.js";

export interface PageImages {
  pageId: string;
  pageIndex: number;
  segments: Uint8Array[];
  renderer: string;
  /**
   * Structure measured from the .rm stroke coordinates rather than inferred from the image:
   * how many lines were written and how far each is indented. Absent for a PDF-only page or
   * when the strokes could not be walked.
   */
  layout?: PageLayout;
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
    const { segments, layouts, errors } = await renderRmPages(
      this.baseUrl,
      pages.map((p) => ({ pageId: p.pageId, rm: p.rm, pdfPageIndex: doc.basePdf ? p.index : null, cropTop: options.cropTop ?? null })),
      doc.basePdf,
    );
    const grouped = groupSegments(segments, (s) => s.pageId);
    const failed: Array<{ pageId: string; reason: string }> = [];
    // Fallback: rasterize the PDF page alone for pages whose ink failed to parse.
    if (errors.length && doc.basePdf) {
      const indexes = errors.map((e) => byId.get(e.pageId)!.index);
      try {
        const pdfSegs = await renderPdfPages(this.baseUrl, doc.basePdf, indexes);
        for (const [idx, segs] of groupSegments(pdfSegs, (s) => s.pageId)) {
          const page = doc.pages.find((p) => p.index === Number(idx));
          if (page) grouped.set(page.pageId, segs);
        }
      } catch (err) {
        for (const e of errors) failed.push({ pageId: e.pageId, reason: `${e.code}; pdf fallback failed: ${(err as Error).message}` });
      }
    } else {
      for (const e of errors) failed.push({ pageId: e.pageId, reason: e.code });
    }
    const layoutById = new Map(layouts.map((l) => [l.pageId, l] as const));
    const out: PageImages[] = [];
    for (const [pageId, segs] of grouped) {
      const p = byId.get(pageId)!;
      out.push({ pageId, pageIndex: p.index, segments: segs.map((s) => s.png), renderer: segs[0]?.renderer ?? "?", layout: layoutById.get(pageId) });
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
