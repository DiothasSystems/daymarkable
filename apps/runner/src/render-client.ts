/** Thin HTTP client for services/render. Falls back to the PDF path when the .rm parser fails. */

export interface RenderedSegment {
  pageId: string;
  segment: number;
  segmentCount: number;
  png: Uint8Array;
  width: number;
  height: number;
  renderer: string;
}

export interface RenderFailure {
  pageId: string;
  code: string;
  message: string;
}

export class RenderServiceError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "RenderServiceError";
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (err) {
    throw new RenderServiceError(`render service unreachable at ${url} (start it with pnpm render:dev or pnpm render:up)`, err);
  }
  if (!res.ok) throw new RenderServiceError(`render service ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function renderHealthy(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

interface WireSegment {
  page_id?: string;
  index?: number;
  segment: number;
  segment_count: number;
  png_b64: string;
  width: number;
  height: number;
  renderer: string;
}

function fromWire(s: WireSegment, pageId: string): RenderedSegment {
  return {
    pageId,
    segment: s.segment,
    segmentCount: s.segment_count,
    png: Buffer.from(s.png_b64, "base64"),
    width: s.width,
    height: s.height,
    renderer: s.renderer,
  };
}

export async function renderRmPages(
  baseUrl: string,
  pages: ReadonlyArray<{ pageId: string; rm: Uint8Array | null }>,
  longEdge = 1568,
): Promise<{ segments: RenderedSegment[]; errors: RenderFailure[] }> {
  if (pages.length === 0) return { segments: [], errors: [] };
  const out = await post<{ segments: WireSegment[]; errors: Array<{ page_id: string; code: string; message: string }> }>(
    `${baseUrl}/render`,
    {
      long_edge: longEdge,
      pages: pages.map((p) => ({ page_id: p.pageId, rm_b64: p.rm ? Buffer.from(p.rm).toString("base64") : null })),
    },
  );
  return {
    segments: out.segments.map((s) => fromWire(s, s.page_id!)),
    errors: out.errors.map((e) => ({ pageId: e.page_id, code: e.code, message: e.message })),
  };
}

/** PDF fallback: segments are keyed by zero-based page index (returned in `pageId` as a string). */
export async function renderPdfPages(
  baseUrl: string,
  pdf: Uint8Array,
  pageIndexes: number[] | null,
  longEdge = 1568,
): Promise<RenderedSegment[]> {
  const out = await post<{ segments: WireSegment[]; errors: Array<{ code: string; message: string }> }>(`${baseUrl}/render-pdf`, {
    pdf_b64: Buffer.from(pdf).toString("base64"),
    page_indexes: pageIndexes,
    long_edge: longEdge,
  });
  if (out.errors.length) throw new RenderServiceError(out.errors.map((e) => `${e.code}: ${e.message}`).join("; "));
  return out.segments.map((s) => fromWire(s, String(s.index)));
}
