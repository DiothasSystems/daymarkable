/**
 * TabletProvider — the ONLY abstraction the rest of dayMarkable uses to talk to
 * an e-ink device. RemarkableCloudProvider is the launch implementation; a
 * future official API, USB mode, or another brand slots in behind this.
 */

export type TabletFileType = "notebook" | "pdf" | "epub";

export interface TabletFolder {
  id: string;
  hash: string;
  name: string;
  /** Slash-separated path from the root, e.g. "/Work/Meetings". Root is "/". */
  path: string;
  parentId: string;
}

export interface TabletDocument {
  id: string;
  /** Content hash of the whole document (changes on any edit). */
  hash: string;
  name: string;
  path: string;
  parentId: string;
  fileType: TabletFileType;
  lastModified: Date | null;
  /** Number of pages reported by the document's content file (-1 = not read yet). */
  pageCount: number;
}

export interface TabletTree {
  folders: TabletFolder[];
  documents: TabletDocument[];
}

export interface TabletPageRef {
  pageId: string;
  /** Zero-based position in document order. */
  index: number;
  /** Hash of the page's stroke file, or null when the page has no ink. */
  hash: string | null;
  /** Cloud-side last-modified for the page, when known (ISO string). */
  modified: string | null;
}

export interface TabletPage extends TabletPageRef {
  /** Raw `.rm` (lines format) bytes, or null when the page has no ink. */
  rm: Uint8Array | null;
}

export interface DownloadedDocument {
  document: TabletDocument;
  pages: TabletPage[];
  /** For PDF-backed documents: the underlying PDF (annotated-PDF fallback input). */
  basePdf: Uint8Array | null;
}

export interface UploadResult {
  id: string;
  hash: string;
}

export type TabletProviderErrorCode =
  | "auth"
  | "not_found"
  | "schema_drift"
  | "network"
  | "conflict"
  | "unknown";

/** Every failure inside a provider surfaces as this typed error (CLAUDE.md Gotchas). */
export class TabletProviderError extends Error {
  readonly code: TabletProviderErrorCode;
  override readonly cause: unknown;
  constructor(code: TabletProviderErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TabletProviderError";
    this.code = code;
    this.cause = cause;
  }
}

export interface TabletProvider {
  /** Walk the whole tree (folders + documents) with resolved paths. */
  listTree(): Promise<TabletTree>;
  /** Per-page stroke hashes without downloading ink — the change-detection unit. */
  listPages(doc: TabletDocument): Promise<TabletPageRef[]>;
  /** Download a document's ink (optionally only the named pages). */
  downloadDocument(
    doc: TabletDocument,
    options?: { onlyPageIds?: readonly string[] },
  ): Promise<DownloadedDocument>;
  /** Find-or-create a folder by path ("/dayMarkable/Archive"). */
  ensureFolder(path: string): Promise<TabletFolder>;
  /** Upload a PDF into a folder, replacing any document of the same name there. */
  uploadPdf(
    name: string,
    bytes: Uint8Array,
    folder: TabletFolder,
    options?: { replace?: boolean },
  ): Promise<UploadResult>;
  /** Move a document to a folder (used for planner archive rotation). */
  moveDocument(doc: TabletDocument, folder: TabletFolder): Promise<UploadResult>;
  /** Rename a document in place (archive rotation stamps the date on yesterday's planner). */
  renameDocument(doc: TabletDocument, name: string): Promise<UploadResult>;
  /** Move a document to the trash. */
  deleteDocument(doc: TabletDocument): Promise<void>;
}
