/**
 * Fixture implementations so `pnpm dev:run` and `pnpm test` exercise the whole pipeline
 * with no network, no API keys, and no render service.
 *
 * Layout: fixtures/notebooks/<slug>/manifest.json, pages/*.rm, png/<index>-s<seg>.png,
 * expected/<index>.json (a PageExtraction). Pages from the founder's own tablet are the
 * sanctioned exception to the purge rule.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PageExtractionSchema, emptyExtraction, zeroUsage, type DecodeMode, type DecodePageInput, type DecodePageResult, type Decoder } from "@daymarkable/decode";
import type { DownloadedDocument, TabletDocument, TabletFolder, TabletPageRef, TabletProvider, TabletTree, UploadResult } from "@daymarkable/tablet";
import type { PageImages, Renderer } from "./renderer.js";

interface FixtureManifest {
  document: TabletDocument;
  pages: Array<{ pageId: string; index: number; hash: string | null; file: string | null }>;
  basePdf: string | null;
}

async function readManifests(root: string): Promise<Array<{ dir: string; manifest: FixtureManifest }>> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const out: Array<{ dir: string; manifest: FixtureManifest }> = [];
  for (const e of entries) {
    const dir = path.join(root, e);
    try {
      out.push({ dir, manifest: JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as FixtureManifest });
    } catch {
      /* not a fixture notebook */
    }
  }
  return out;
}

/** A "tablet" whose documents are the fixture notebooks and whose uploads land on disk. */
export class FixtureTabletProvider implements TabletProvider {
  readonly uploads: Array<{ folder: string; name: string; bytes: number }> = [];
  private folders = new Map<string, TabletFolder>();
  constructor(
    private readonly root: string,
    private readonly outDir: string,
    private readonly modifiedAt: Date = new Date(),
  ) {}

  async listTree(): Promise<TabletTree> {
    const docs: TabletDocument[] = [];
    for (const { manifest } of await readManifests(this.root)) {
      docs.push({ ...manifest.document, lastModified: this.modifiedAt, pageCount: manifest.pages.length });
    }
    return { folders: [...this.folders.values()], documents: docs };
  }

  private async find(doc: TabletDocument): Promise<{ dir: string; manifest: FixtureManifest }> {
    const m = (await readManifests(this.root)).find((x) => x.manifest.document.id === doc.id);
    if (!m) throw new Error(`fixture ${doc.id} not found`);
    return m;
  }

  async listPages(doc: TabletDocument): Promise<TabletPageRef[]> {
    const { manifest } = await this.find(doc);
    return manifest.pages.map((p) => ({ pageId: p.pageId, index: p.index, hash: p.hash, modified: null }));
  }

  async downloadDocument(doc: TabletDocument, options: { onlyPageIds?: readonly string[] } = {}): Promise<DownloadedDocument> {
    const { dir, manifest } = await this.find(doc);
    const want = options.onlyPageIds ? new Set(options.onlyPageIds) : null;
    const pages = [];
    for (const p of manifest.pages) {
      if (want && !want.has(p.pageId)) continue;
      pages.push({ pageId: p.pageId, index: p.index, hash: p.hash, modified: null, rm: p.file ? new Uint8Array(await readFile(path.join(dir, p.file))) : null });
    }
    const basePdf = manifest.basePdf ? new Uint8Array(await readFile(path.join(dir, manifest.basePdf))) : null;
    return { document: { ...doc, pageCount: manifest.pages.length }, pages, basePdf };
  }

  async ensureFolder(p: string): Promise<TabletFolder> {
    const existing = this.folders.get(p);
    if (existing) return existing;
    const f: TabletFolder = { id: `folder:${p}`, hash: "", name: p.split("/").pop() ?? "", path: p, parentId: "" };
    this.folders.set(p, f);
    return f;
  }

  async uploadPdf(name: string, bytes: Uint8Array, folder: TabletFolder): Promise<UploadResult> {
    const dir = path.join(this.outDir, ...folder.path.split("/").filter(Boolean));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${name}.pdf`), bytes);
    this.uploads.push({ folder: folder.path, name, bytes: bytes.length });
    return { id: `doc:${folder.path}/${name}`, hash: String(bytes.length) };
  }

  async moveDocument(doc: TabletDocument, folder: TabletFolder): Promise<UploadResult> {
    return { id: doc.id, hash: `${doc.hash}:${folder.path}` };
  }

  async renameDocument(doc: TabletDocument, name: string): Promise<UploadResult> {
    return { id: doc.id, hash: `${doc.hash}:${name}` };
  }

  async deleteDocument(): Promise<void> {}
}

/** Reads pre-rendered PNG segments from the fixture directory. */
export class FixtureRenderer implements Renderer {
  constructor(private readonly root: string) {}

  async renderDocument(doc: DownloadedDocument, pageIds: readonly string[]): Promise<{ pages: PageImages[]; failed: Array<{ pageId: string; reason: string }> }> {
    const m = (await readManifests(this.root)).find((x) => x.manifest.document.id === doc.document.id);
    if (!m) return { pages: [], failed: pageIds.map((pageId) => ({ pageId, reason: "fixture missing" })) };
    const files = (await readdir(path.join(m.dir, "png")).catch(() => [])).sort();
    const pages: PageImages[] = [];
    const failed: Array<{ pageId: string; reason: string }> = [];
    for (const pageId of pageIds) {
      const p = doc.pages.find((x) => x.pageId === pageId);
      if (!p) continue;
      const prefix = String(p.index).padStart(3, "0");
      const segs = files.filter((f) => f.startsWith(`${prefix}-s`) || f === `${prefix}.png`);
      if (!segs.length) {
        failed.push({ pageId, reason: "no fixture png" });
        continue;
      }
      pages.push({ pageId, pageIndex: p.index, segments: await Promise.all(segs.map(async (f) => new Uint8Array(await readFile(path.join(m.dir, "png", f))))), renderer: "fixture" });
    }
    return { pages, failed };
  }
}

/** Returns expected/<index>.json per page; blank extraction when absent. Records fake usage so cost paths run. */
export class FixtureDecoder implements Decoder {
  constructor(
    private readonly root: string,
    private readonly model = "fixture-model",
  ) {}

  async decodePages(pages: readonly DecodePageInput[], mode: DecodeMode): Promise<DecodePageResult[]> {
    const manifests = await readManifests(this.root);
    const out: DecodePageResult[] = [];
    for (const p of pages) {
      const [docId] = p.key.split("/");
      const m = manifests.find((x) => x.manifest.document.id === docId);
      let extraction = emptyExtraction("blank");
      let error: string | null = null;
      if (m) {
        try {
          const raw = JSON.parse(await readFile(path.join(m.dir, "expected", `${String(p.context.pageIndex).padStart(3, "0")}.json`), "utf8"));
          const parsed = PageExtractionSchema.safeParse(raw);
          if (parsed.success) extraction = parsed.data;
          else error = parsed.error.message;
        } catch {
          /* no expected file: treat as blank */
        }
      }
      const tokens = p.images.length * 2500;
      out.push({
        key: p.key,
        extraction: error ? null : extraction,
        raw: "",
        error,
        usage: [{ ...zeroUsage(), input_tokens: tokens, output_tokens: 600, model: this.model, mode, cost_usd: 0 }],
        escalated: false,
      });
    }
    return out;
  }
}
