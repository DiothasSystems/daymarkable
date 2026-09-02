import {
  auth,
  register,
  remarkable,
  session,
  type Entry,
  type ItemRef,
  type RemarkableApi,
} from "rmapi-js";
import {
  TabletProviderError,
  type DownloadedDocument,
  type TabletDocument,
  type TabletFolder,
  type TabletPage,
  type TabletPageRef,
  type TabletProvider,
  type TabletTree,
  type UploadResult,
} from "./provider.js";

/** Exchange a one-time code from my.remarkable.com for a long-lived device token. */
export async function pairWithCode(code: string): Promise<string> {
  const trimmed = code.trim().toLowerCase();
  if (!/^[a-z0-9]{8}$/.test(trimmed)) {
    throw new TabletProviderError(
      "auth",
      "Pairing code must be the 8-character code from my.remarkable.com",
    );
  }
  try {
    return await register(trimmed, { deviceDesc: "browser-chrome" });
  } catch (err) {
    throw wrap(err, "Pairing failed; the code may have expired (get a fresh one)");
  }
}

function wrap(err: unknown, context: string): TabletProviderError {
  if (err instanceof TabletProviderError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  let code: TabletProviderError["code"] = "unknown";
  if (status === 401 || status === 403) code = "auth";
  else if (status === 404) code = "not_found";
  else if (err instanceof Error && err.name === "ValidationError") code = "schema_drift";
  else if (err instanceof Error && err.name === "GenerationError") code = "conflict";
  else if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND/i.test(msg)) code = "network";
  return new TabletProviderError(code, `${context}: ${msg}`, err);
}

/** The cloud reports lastModified as ISO strings or epoch-millisecond strings; tolerate both. */
export function parseCloudDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = /^\d{10,}$/.test(value) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface ContentPage {
  id: string;
  modified: string | null;
}

export class RemarkableCloudProvider implements TabletProvider {
  private constructor(private readonly api: RemarkableApi) {}

  /** Build a provider from a stored device token (one auth round-trip). */
  static async fromDeviceToken(deviceToken: string): Promise<RemarkableCloudProvider> {
    try {
      const api = await remarkable(deviceToken);
      return new RemarkableCloudProvider(api);
    } catch (err) {
      throw wrap(err, "Could not open a reMarkable cloud session");
    }
  }

  /** Stateless variant: exchange once, reuse the short-lived session token. */
  static async sessionToken(deviceToken: string): Promise<string> {
    try {
      return await auth(deviceToken);
    } catch (err) {
      throw wrap(err, "Could not refresh reMarkable session");
    }
  }

  static fromSessionToken(sessionToken: string): RemarkableCloudProvider {
    return new RemarkableCloudProvider(session(sessionToken));
  }

  async listTree(): Promise<TabletTree> {
    let entries: Entry[];
    try {
      entries = await this.api.listItems(true);
    } catch (err) {
      throw wrap(err, "Listing the document tree failed");
    }
    const byId = new Map(entries.map((e) => [e.id, e] as const));
    const pathCache = new Map<string, string>([
      ["", "/"],
      ["trash", "/trash"],
    ]);
    const pathOf = (id: string): string => {
      const cached = pathCache.get(id);
      if (cached) return cached;
      const e = byId.get(id);
      if (!e) return "/?";
      const parentPath = pathOf(e.parent ?? "");
      const p = parentPath === "/" ? `/${e.visibleName}` : `${parentPath}/${e.visibleName}`;
      pathCache.set(id, p);
      return p;
    };

    const folders: TabletFolder[] = [];
    const documents: TabletDocument[] = [];
    for (const e of entries) {
      const parentId = e.parent ?? "";
      if (parentId === "trash" || pathOf(parentId).startsWith("/trash")) continue;
      if (e.type === "CollectionType") {
        folders.push({ id: e.id, hash: e.hash, name: e.visibleName, path: pathOf(e.id), parentId });
      } else if (e.type === "DocumentType") {
        documents.push({
          id: e.id,
          hash: e.hash,
          name: e.visibleName,
          path: pathOf(e.id),
          parentId,
          fileType: e.fileType,
          lastModified: parseCloudDate(e.lastModified),
          pageCount: -1,
        });
      }
    }
    folders.sort((a, b) => a.path.localeCompare(b.path));
    documents.sort((a, b) => a.path.localeCompare(b.path));
    return { folders, documents };
  }

  private async contentPages(ref: ItemRef): Promise<ContentPage[]> {
    let content;
    try {
      content = await this.api.getContent(ref);
    } catch (err) {
      throw wrap(err, `Reading content for ${ref.id} failed`);
    }
    if (!("fileType" in content) || content.fileType === undefined) return [];
    const c = content;
    if (c.cPages?.pages?.length) {
      return c.cPages.pages
        .filter((p) => !p.deleted?.value)
        .map((p) => ({ id: p.id, modified: p.modifed ?? null }));
    }
    return (c.pages ?? []).map((id) => ({ id, modified: null }));
  }

  private async pageFileHashes(ref: ItemRef): Promise<Map<string, string>> {
    try {
      const { entries } = await this.api.raw.getEntries(ref);
      const out = new Map<string, string>();
      for (const e of entries) {
        const m = /^[^/]+\/([^/]+)\.rm$/.exec(e.id);
        if (m?.[1]) out.set(m[1], e.hash);
      }
      return out;
    } catch (err) {
      throw wrap(err, `Reading page entries for ${ref.id} failed`);
    }
  }

  async listPages(doc: TabletDocument): Promise<TabletPageRef[]> {
    const ref = { id: doc.id, hash: doc.hash };
    const [pages, hashes] = await Promise.all([this.contentPages(ref), this.pageFileHashes(ref)]);
    return pages.map((p, index) => ({
      pageId: p.id,
      index,
      hash: hashes.get(p.id) ?? null,
      modified: p.modified,
    }));
  }

  async downloadDocument(
    doc: TabletDocument,
    options: { onlyPageIds?: readonly string[] } = {},
  ): Promise<DownloadedDocument> {
    const ref = { id: doc.id, hash: doc.hash };
    const refs = await this.listPages(doc);
    const wanted = options.onlyPageIds ? new Set(options.onlyPageIds) : null;
    const pages: TabletPage[] = [];
    for (const p of refs) {
      if (wanted && !wanted.has(p.pageId)) continue;
      let rm: Uint8Array | null = null;
      if (p.hash) {
        try {
          rm = await this.api.raw.getHash({ id: `${doc.id}/${p.pageId}.rm`, hash: p.hash });
        } catch (err) {
          throw wrap(err, `Downloading page ${p.index + 1} of "${doc.name}" failed`);
        }
      }
      pages.push({ ...p, rm });
    }
    let basePdf: Uint8Array | null = null;
    if (doc.fileType === "pdf") {
      try {
        basePdf = await this.api.getPdf(ref);
      } catch {
        basePdf = null; // non-fatal: fallback input only
      }
    }
    return { document: { ...doc, pageCount: refs.length }, pages, basePdf };
  }

  async ensureFolder(path: string): Promise<TabletFolder> {
    const parts = path.split("/").filter(Boolean);
    let tree = await this.listTree();
    let parentId = "";
    let current: TabletFolder = { id: "", hash: "", name: "", path: "/", parentId: "" };
    for (const part of parts) {
      const wantPath = current.path === "/" ? `/${part}` : `${current.path}/${part}`;
      let found = tree.folders.find((f) => f.path === wantPath);
      if (!found) {
        try {
          await this.api.putFolder(part, { parent: parentId }, true);
        } catch (err) {
          throw wrap(err, `Creating folder ${wantPath} failed`);
        }
        tree = await this.listTree();
        found = tree.folders.find((f) => f.path === wantPath);
        if (!found) {
          throw new TabletProviderError("unknown", `Folder ${wantPath} did not appear after creation`);
        }
      }
      current = found;
      parentId = found.id;
    }
    return current;
  }

  async uploadPdf(
    name: string,
    bytes: Uint8Array,
    folder: TabletFolder,
    options: { replace?: boolean } = {},
  ): Promise<UploadResult> {
    const replace = options.replace ?? true;
    if (replace) {
      const tree = await this.listTree();
      const existing = tree.documents.filter((d) => d.parentId === folder.id && d.name === name);
      for (const d of existing) await this.deleteDocument(d);
    }
    try {
      const ref = await this.api.putPdf(name, bytes, { parent: folder.id, refresh: true });
      return { id: ref.id, hash: ref.hash };
    } catch (err) {
      throw wrap(err, `Uploading "${name}" failed`);
    }
  }

  async moveDocument(doc: TabletDocument, folder: TabletFolder): Promise<UploadResult> {
    try {
      const ref = await this.api.move({ id: doc.id, hash: doc.hash }, folder.id, true);
      return { id: ref.id, hash: ref.hash };
    } catch (err) {
      throw wrap(err, `Moving "${doc.name}" failed`);
    }
  }

  async renameDocument(doc: TabletDocument, name: string): Promise<UploadResult> {
    try {
      const ref = await this.api.rename({ id: doc.id, hash: doc.hash }, name, true);
      return { id: ref.id, hash: ref.hash };
    } catch (err) {
      throw wrap(err, `Renaming "${doc.name}" failed`);
    }
  }

  async deleteDocument(doc: TabletDocument): Promise<void> {
    try {
      await this.api.delete({ id: doc.id, hash: doc.hash }, true);
    } catch (err) {
      throw wrap(err, `Deleting "${doc.name}" failed`);
    }
  }
}
