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

/**
 * The reMarkable cloud sometimes accepts a connection and then never answers. rmapi-js has no
 * per-call deadline, so race every call against one. The socket may linger, but the run fails
 * with a real error instead of sitting at "running" until someone restarts the container.
 * The thrown Error is plain: the caller's own catch adds the context and `wrap` classifies it.
 */
const CALL_TIMEOUT_MS = Number(process.env.RMAPI_TIMEOUT_MS ?? 120_000);
const CALL_ATTEMPTS = Number(process.env.RMAPI_ATTEMPTS ?? 5);
const CALL_BACKOFF_MS = Number(process.env.RMAPI_BACKOFF_MS ?? 3_000);

export function withTimeout<T>(work: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/**
 * Worth another go: a rate limit, a server-side wobble, or a call that hung. A 401, a 404 or a
 * schema mismatch will say the same thing however many times we ask.
 */
export function retryableCloudError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  if (typeof status === "number") return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /too many requests|timed out|fetch failed|ECONN|ETIMEDOUT|socket hang up/i.test(msg);
}

/**
 * The cloud rate-limits a run that does its uploads back to back — each `uploadPdf(replace)`
 * lists the whole tree, then deletes, then puts — and it sometimes accepts a connection and
 * then goes quiet. rmapi-js gives us neither a deadline nor a retry, so every call gets both:
 * a per-attempt timeout, then exponential backoff with jitter. A 429 should cost the run a few
 * seconds, not the night's notebooks.
 */
export async function withRetry<T>(
  work: () => Promise<T>,
  opts: { attempts?: number; backoffMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? CALL_ATTEMPTS;
  const backoff = opts.backoffMs ?? CALL_BACKOFF_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(work(), opts.timeoutMs ?? CALL_TIMEOUT_MS);
    } catch (err) {
      if (attempt >= attempts || !retryableCloudError(err)) throw err;
      const wait = backoff * 2 ** (attempt - 1) + Math.floor(Math.random() * backoff);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function wrap(err: unknown, context: string): TabletProviderError {
  if (err instanceof TabletProviderError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  let code: TabletProviderError["code"] = "unknown";
  if (status === 401 || status === 403) code = "auth";
  else if (status === 404) code = "not_found";
  // Reaching wrap() with a 429 means the retries were used up and the cloud is still saying no.
  else if (status === 429 || /too many requests/i.test(msg)) code = "rate_limit";
  else if (err instanceof Error && err.name === "ValidationError") code = "schema_drift";
  else if (err instanceof Error && err.name === "GenerationError") code = "conflict";
  else if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|timed out/i.test(msg)) code = "network";
  return new TabletProviderError(code, `${context}: ${msg}`, err);
}

/**
 * The cloud reports timestamps as ISO strings, epoch-millisecond strings, or epoch-SECOND
 * strings depending on the field and firmware. Tolerate all three.
 *
 * The seconds case matters: reading a 10-digit seconds value as milliseconds dates the page to
 * January 1970, which put every newly written page before the change window and skipped it
 * silently. Length decides — 10-digit values are seconds until the year 2286, 13-digit are
 * milliseconds.
 */
export function parseCloudDate(value: string | undefined | null): Date | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  let d: Date;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    d = new Date(s.length <= 11 ? n * 1000 : n);
  } else {
    d = new Date(s);
  }
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
      entries = await withRetry(() => this.api.listItems(true));
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
      content = await withRetry(() => this.api.getContent(ref));
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
      const { entries } = await withRetry(() => this.api.raw.getEntries(ref));
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
      const hash = p.hash;
      if (hash) {
        try {
          rm = await withRetry(() => this.api.raw.getHash({ id: `${doc.id}/${p.pageId}.rm`, hash }));
        } catch (err) {
          throw wrap(err, `Downloading page ${p.index + 1} of "${doc.name}" failed`);
        }
      }
      pages.push({ ...p, rm });
    }
    let basePdf: Uint8Array | null = null;
    if (doc.fileType === "pdf") {
      try {
        basePdf = await withRetry(() => this.api.getPdf(ref));
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
          await withRetry(() => this.api.putFolder(part, { parent: parentId }, true));
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
      const ref = await withRetry(() => this.api.putPdf(name, bytes, { parent: folder.id, refresh: true }));
      return { id: ref.id, hash: ref.hash };
    } catch (err) {
      throw wrap(err, `Uploading "${name}" failed`);
    }
  }

  async moveDocument(doc: TabletDocument, folder: TabletFolder): Promise<UploadResult> {
    try {
      const ref = await withRetry(() => this.api.move({ id: doc.id, hash: doc.hash }, folder.id, true));
      return { id: ref.id, hash: ref.hash };
    } catch (err) {
      throw wrap(err, `Moving "${doc.name}" failed`);
    }
  }

  async renameDocument(doc: TabletDocument, name: string): Promise<UploadResult> {
    try {
      const ref = await withRetry(() => this.api.rename({ id: doc.id, hash: doc.hash }, name, true));
      return { id: ref.id, hash: ref.hash };
    } catch (err) {
      throw wrap(err, `Renaming "${doc.name}" failed`);
    }
  }

  async deleteDocument(doc: TabletDocument): Promise<void> {
    try {
      await withRetry(() => this.api.delete({ id: doc.id, hash: doc.hash }, true));
    } catch (err) {
      throw wrap(err, `Deleting "${doc.name}" failed`);
    }
  }
}
