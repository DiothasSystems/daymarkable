/**
 * The run pipeline (nightly AND on-demand — same job):
 *   sync → render → decode → merge → compose → upload → email → draft invites → rotate cache
 *
 * Idempotent per (user, local-date[, seq]) (rule 4/11). Only changed pages are processed
 * (rule 2). Nothing here logs note content — counts, hashes, ids only (rule 5).
 */
import { mergeRun, buildOutputSet, type MergePage, type PrintedItem } from "@daymarkable/core";
import { composeActionList, composeMeetingNotes, composePlanner } from "@daymarkable/compose";
import type { Db, RunStats, Sealer } from "@daymarkable/db";
import { totalUsage, type DecodePageInput, type Decoder } from "@daymarkable/decode";
import { buildMeetingMail, type MailProvider } from "@daymarkable/mail";
import { TabletProviderError, type DownloadedDocument, type TabletDocument, type TabletFolder, type TabletProvider } from "@daymarkable/tablet";
import { DateTime } from "luxon";
import type { CacheStore } from "./cache.js";
import type { Renderer } from "./renderer.js";
import * as repo from "./repo.js";

export interface PipelineDeps {
  db: Db;
  sealer: Sealer;
  cache: CacheStore;
  tablet: TabletProvider;
  renderer: Renderer;
  decoder: Decoder;
  mail: MailProvider;
  decodeModel: string;
  log: (msg: string) => void;
  now?: () => DateTime;
}

export interface PipelineParams {
  userId: string;
  kind: "nightly" | "on_demand";
  requestedVia: string;
  /** Override the local date (tests / backfill). */
  localDate?: string;
  /** Re-run even when this local date is already satisfied. */
  force?: boolean;
  /** Skip the tablet upload (dry run). */
  upload?: boolean;
  /** Process pages regardless of the previous-day window (first-run bootstrap of one notebook). */
  windowHours?: number;
  /** Called as soon as the run row exists (web "Sync now" returns the id and polls). */
  onStarted?: (runId: string) => void;
}

export interface RunOutcome {
  runId: string | null;
  status: "succeeded" | "failed" | "skipped";
  localDate: string;
  stats: RunStats | null;
  error: string | null;
}

const OUTPUT_FOLDER = "/dayMarkable";
/** The notebook the calibration sheet is uploaded as; its written page trains the decoder. */
export const CALIBRATION_NOTEBOOK = "Handwriting Sample";
/** Below this share of the passage read back, the sheet is assumed not written yet. */
export const CALIBRATION_MIN_ACCURACY = 0.25;
const ARCHIVE_FOLDER = "/dayMarkable/Archive";
const ARCHIVE_DAYS = 7;
/** How far the very first run for an account looks back (see changeWindowStart). */
export const FIRST_RUN_LOOKBACK_DAYS = 7;

function emptyStats(): RunStats {
  return {
    docsSeen: 0,
    docsChanged: 0,
    pagesChanged: 0,
    pagesRendered: 0,
    pagesDecoded: 0,
    pagesFailed: 0,
    tasksFound: 0,
    eventsFound: 0,
    meetingRequestsFound: 0,
    meetingsFound: 0,
    checkboxUpdates: 0,
    inboxItems: 0,
    emailsSent: 0,
    purgedRunId: null,
    purgedFiles: 0,
    purgedBytes: 0,
    costUsd: 0,
  };
}

function isOutputDoc(doc: TabletDocument): boolean {
  return doc.path.startsWith(`${OUTPUT_FOLDER}/`) && !doc.path.startsWith(`${ARCHIVE_FOLDER}/`);
}

/** The watch-folder entry meaning "documents sitting loose in the tablet's root". */
export const ROOT_FOLDER = "/";

/** Does `path` live in `folder`? "/" means the root itself, not everything under it. */
export function inWatchedFolder(path: string, folder: string): boolean {
  if (folder === ROOT_FOLDER) return path.lastIndexOf("/") === 0;
  const f = folder.replace(/\/$/, "");
  return path === f || path.startsWith(`${f}/`);
}

export function selectDocuments(docs: TabletDocument[], settings: { watchFolders: string[]; includePdfs: boolean }): TabletDocument[] {
  return docs.filter((d) => {
    if (d.path.startsWith(`${ARCHIVE_FOLDER}/`)) return false;
    if (isOutputDoc(d)) return true; // our own planner pages: the closed loop
    if (d.fileType === "epub") return false;
    if (d.fileType === "pdf" && !settings.includePdfs) return false;
    if (settings.watchFolders.length === 0) return true;
    return settings.watchFolders.some((f) => inWatchedFolder(d.path, f));
  });
}

/** "Only files modified during the previous day": the window opens at local midnight of the day before the run date. */
export function changeWindowStart(localDate: string, timezone: string, lastSuccessStartedAt: Date | null, windowHours?: number): DateTime {
  const midnight = DateTime.fromISO(localDate, { zone: timezone }).startOf("day");
  const base = midnight.minus({ days: 1 });
  if (windowHours !== undefined) return DateTime.utc().minus({ hours: windowHours });
  // No successful run yet means no snapshots exist, so a fresh account starts from a week of
  // notes rather than a single day — otherwise the first planner is nearly empty.
  if (!lastSuccessStartedAt) return midnight.minus({ days: FIRST_RUN_LOOKBACK_DAYS });
  const last = DateTime.fromJSDate(lastSuccessStartedAt).minus({ hours: 1 });
  return last < base ? last : base; // catch-up after a missed night
}

/**
 * A page is processed when its ink hash differs from the last snapshot. For a page we have
 * never snapshotted (first sight of a notebook), the page's own modified timestamp decides:
 * only pages written inside the window are decoded; older pages are baselined silently.
 */
export function pageChanged(page: { pageId: string; hash: string | null; modified: string | null }, snapshot: Map<string, string | null>, windowStart: DateTime): boolean {
  if (!page.hash) return false;
  if (snapshot.has(page.pageId)) return snapshot.get(page.pageId) !== page.hash;
  if (!page.modified) return true;
  const ms = /^\d{10,}$/.test(page.modified) ? Number(page.modified) : Date.parse(page.modified);
  if (Number.isNaN(ms)) return true;
  return ms >= windowStart.toMillis();
}

export async function runPipeline(deps: PipelineDeps, params: PipelineParams): Promise<RunOutcome> {
  const { db, log } = deps;
  const now = deps.now ?? (() => DateTime.utc());
  const user = await repo.getUser(db, params.userId);
  const settings = user.settings;
  const tz = user.timezone;
  const localNow = now().setZone(tz);
  const localDate = params.localDate ?? localNow.toISODate()!;
  const threshold = settings.confidenceThreshold ?? 0.7;

  if (!params.force) {
    const satisfied = await repo.findSatisfiedRun(db, user.id, localDate);
    if (satisfied && params.kind === "nightly") {
      log(`run skipped: ${localDate} already satisfied by ${satisfied.kind} run ${satisfied.id.slice(0, 8)}`);
      return { runId: null, status: "skipped", localDate, stats: null, error: null };
    }
  }

  const seq = await repo.nextSeq(db, user.id, localDate, params.kind);
  const lastSuccess = await repo.lastSuccessfulRun(db, user.id);
  const run = await repo.createRun(db, { userId: user.id, localDate, kind: params.kind, seq, requestedVia: params.requestedVia, decodeModel: deps.decodeModel, cacheDir: null });
  await repo.updateRun(db, run.id, { cacheDir: deps.cache.location(run.id) });
  params.onStarted?.(run.id);
  const runLabel = params.kind === "nightly" ? "nightly" : `on-demand ${seq}`;
  const stats = emptyStats();
  log(`run ${run.id.slice(0, 8)} started: ${runLabel} for ${localDate} (${tz})`);

  // Failsafe: anything older than 48h is gone regardless of what happens tonight.
  for (const swept of await deps.cache.sweep(48)) log(`cache failsafe purged run ${swept.runId.slice(0, 8)}: ${swept.files} files, ${swept.bytes} bytes`);

  try {
    // ---- 1. sync + change detection --------------------------------------------------
    const tree = await deps.tablet.listTree();
    const candidates = selectDocuments(tree.documents, settings);
    stats.docsSeen = candidates.length;
    const snapshots = await repo.loadDocSnapshots(db, user.id);
    const windowStart = changeWindowStart(localDate, tz, lastSuccess?.startedAt ?? null, params.windowHours);
    const windowWhy = params.windowHours !== undefined ? ` (${params.windowHours}h override)` : lastSuccess ? "" : ` (first run: ${FIRST_RUN_LOOKBACK_DAYS}-day lookback)`;
    log(`sync: ${tree.documents.length} documents, ${candidates.length} watched; window opens ${windowStart.toISO()}${windowWhy}`);

    const downloaded: Array<{ doc: DownloadedDocument; changedPageIds: string[] }> = [];
    const baselineOnly: TabletDocument[] = [];
    for (const doc of candidates) {
      const snap = snapshots.get(doc.id);
      if (snap && snap.hash === doc.hash) continue;
      const modified = doc.lastModified ? DateTime.fromJSDate(doc.lastModified) : null;
      const inWindow = modified === null ? !!snap : modified >= windowStart;
      if (!inWindow) {
        baselineOnly.push(doc); // first sight of an old document: record the hash, do not decode
        continue;
      }
      const pageRefs = await deps.tablet.listPages(doc);
      const pageSnap = await repo.loadPageSnapshots(db, user.id, doc.id);
      const changedPageIds = pageRefs.filter((p) => pageChanged(p, pageSnap, windowStart)).map((p) => p.pageId);
      if (changedPageIds.length === 0) {
        baselineOnly.push({ ...doc, pageCount: pageRefs.length });
        continue;
      }
      const dl = await deps.tablet.downloadDocument(doc, { onlyPageIds: changedPageIds });
      for (const p of dl.pages) if (p.rm) await deps.cache.put(run.id, `downloads/${doc.id}/${p.pageId}.rm`, p.rm);
      if (dl.basePdf) await deps.cache.put(run.id, `downloads/${doc.id}/base.pdf`, dl.basePdf);
      downloaded.push({ doc: dl, changedPageIds });
      stats.docsChanged++;
      stats.pagesChanged += changedPageIds.length;
    }
    log(`change detection: ${stats.docsChanged} changed documents, ${stats.pagesChanged} changed pages, ${baselineOnly.length} baselined`);

    // ---- 2. render ------------------------------------------------------------------
    const decodeInputs: DecodePageInput[] = [];
    const pageMeta = new Map<string, { doc: DownloadedDocument; pageId: string; pageIndex: number; hash: string | null }>();
    const renderedByKey = new Map<string, Uint8Array[]>();
    /** Pages we could not render or decode: their hashes must NOT be snapshotted, so the next run retries them. */
    const unprocessed = new Set<string>();
    for (const { doc, changedPageIds } of downloaded) {
      const { pages, failed } = await deps.renderer.renderDocument(doc, changedPageIds);
      stats.pagesFailed += failed.length;
      for (const f of failed) {
        unprocessed.add(`${doc.document.id}/${f.pageId}`);
        log(`render failed for ${doc.document.id.slice(0, 8)}/${f.pageId.slice(0, 8)}: ${f.reason}`);
      }
      for (const p of pages) {
        for (let i = 0; i < p.segments.length; i++) await deps.cache.put(run.id, `images/${doc.document.id}/${String(p.pageIndex).padStart(3, "0")}-s${i}.png`, p.segments[i]!);
        stats.pagesRendered++;
        const key = `${doc.document.id}/${p.pageId}`;
        pageMeta.set(key, { doc, pageId: p.pageId, pageIndex: p.pageIndex, hash: doc.pages.find((x) => x.pageId === p.pageId)?.hash ?? null });
        renderedByKey.set(key, p.segments);
        decodeInputs.push({
          key,
          images: p.segments,
          context: {
            notebookName: doc.document.name,
            notebookPath: doc.document.path,
            pageIndex: p.pageIndex,
            pageCount: doc.document.pageCount,
            todayIso: localDate,
            timezone: tz,
          },
        });
      }
    }

    // ---- 3. decode ------------------------------------------------------------------
    const mode = params.kind === "nightly" ? "batch" : "standard";
    const mergePages: MergePage[] = [];
    const decodedKinds = new Map<string, { kind: string; confidence: number }>();
    if (decodeInputs.length) {
      log(`decode: ${decodeInputs.length} pages via ${mode} API (${deps.decodeModel})`);
      const results = await deps.decoder.decodePages(decodeInputs, mode);
      stats.costUsd += await repo.recordCosts(db, run.id, user.id, "decode", totalUsage(results).values(), decodeInputs.length);
      for (const r of results) {
        const meta = pageMeta.get(r.key)!;
        await deps.cache.put(run.id, `decode/${meta.doc.document.id}/${meta.pageId}.json`, Buffer.from(JSON.stringify(r)));
        if (!r.extraction) {
          stats.pagesFailed++;
          unprocessed.add(r.key);
          log(`decode failed for ${r.key.slice(0, 8)}…: ${r.error}`);
          continue;
        }
        stats.pagesDecoded++;
        decodedKinds.set(r.key, { kind: r.extraction.page_kind, confidence: r.extraction.overall_confidence });
        // The calibration sheet is a training sample, never content. Capturing it is an explicit
        // action in the web UI (it needs the printed half cropped away), so runs only skip it.
        if (meta.doc.document.name === CALIBRATION_NOTEBOOK) continue;
        stats.tasksFound += r.extraction.tasks.length;
        stats.eventsFound += r.extraction.events.length;
        stats.meetingRequestsFound += r.extraction.meeting_requests.length;
        stats.checkboxUpdates += r.extraction.checkbox_updates.length;
        mergePages.push({ notebook: meta.doc.document.name, pageIndex: meta.pageIndex, extraction: r.extraction });
      }
      // Every page failing is a provider or configuration fault, not an empty night. Fail the
      // run loudly and before compose, so yesterday's notebooks stay on the tablet (rule: never
      // write a broken planner) and nothing is snapshotted as seen.
      if (stats.pagesDecoded === 0) {
        const why = results.find((r) => r.error)?.error ?? "unknown error";
        throw new Error(`all ${decodeInputs.length} page(s) failed to decode: ${why}`);
      }
    }

    // ---- 4. merge (deterministic) ---------------------------------------------------
    const previous = await repo.loadWorkingSet(db, deps.sealer, user.id);
    const merged = mergeRun(previous, mergePages, { today: localDate, threshold });
    for (const line of merged.log) log(`merge: ${line}`);
    stats.meetingsFound = merged.changes.meetingsCreated;
    stats.inboxItems = merged.state.inbox.filter((i) => i.status === "pending").length;

    // ---- 5. compose -----------------------------------------------------------------
    const generatedAt = now().setZone(tz).toISO()!;
    const views = buildOutputSet(merged.state, {
      today: localDate,
      timezone: tz,
      generatedAt,
      runLabel,
      stats: { pagesRead: stats.pagesDecoded, tasksFound: stats.tasksFound, eventsFound: stats.eventsFound, meetingRequestsFound: stats.meetingRequestsFound, notesFound: stats.meetingsFound },
    });
    const planner = await composePlanner(views.planner, merged.state.tasks);
    const actionList = await composeActionList({ model: views.actionList, date: localDate, generatedAt, runLabel });
    const meetingNotes = await composeMeetingNotes({ model: views.meetingNotes, date: localDate, generatedAt, runLabel });
    const outputs = [
      { kind: "planner" as const, name: "Planner", composed: planner },
      { kind: "action_list" as const, name: "Action List", composed: actionList },
      { kind: "meeting_notes" as const, name: "Meeting Notes", composed: meetingNotes },
    ];
    const printed: PrintedItem[] = [];
    for (const o of outputs) {
      await deps.cache.put(run.id, `outputs/${o.name}.pdf`, o.composed.pdf);
      printed.push(...o.composed.printed);
    }
    log(`compose: Planner ${planner.pageCount}p, Action List ${actionList.pageCount}p, Meeting Notes ${meetingNotes.pageCount}p; ${printed.length} checkbox rows printed`);

    // ---- 6. upload + archive rotation ------------------------------------------------
    const tabletIds = new Map<string, string>();
    if (params.upload !== false) {
      const folder = await deps.tablet.ensureFolder(OUTPUT_FOLDER);
      const archive = await deps.tablet.ensureFolder(ARCHIVE_FOLDER);
      await rotateArchive(deps, tree.documents, folder, archive, localDate, log);
      for (const o of outputs) {
        const res = await deps.tablet.uploadPdf(o.name, o.composed.pdf, folder, { replace: true });
        tabletIds.set(o.kind, res.id);
      }
      log(`upload: ${outputs.length} notebooks replaced in ${OUTPUT_FOLDER}`);
    }
    for (const o of outputs) {
      await repo.registerDocument(db, { userId: user.id, runId: run.id, kind: o.kind, name: o.name, cachePath: `outputs/${o.name}.pdf`, bytes: o.composed.pdf.length, pageCount: o.composed.pageCount, tabletDocId: tabletIds.get(o.kind) ?? null });
    }

    // ---- 7. email: one per decoded meeting, registered address only (rule 10) -------
    if (settings.email.meetingNotes) {
      for (const m of merged.newMeetings) {
        const mail = buildMeetingMail(user.email, user.id, m, {
          syncedAt: now().setZone(tz).toFormat("HH:mm"),
          ...(process.env.APP_URL ? { appUrl: `${process.env.APP_URL.replace(/\/$/, "")}/documents?tab=meetings` } : {}),
          notebooksRead: stats.docsChanged,
          pagesRead: stats.pagesDecoded,
        });
        if (await repo.emailAlreadySent(db, mail.idempotencyKey)) continue;
        const res = await deps.mail.send(mail);
        await repo.logEmail(db, { userId: user.id, runId: run.id, idempotencyKey: mail.idempotencyKey, toEmail: user.email, subject: mail.subject, status: res.status, providerId: res.providerId, error: res.error });
        if (res.status === "sent") stats.emailsSent++;
        else if (res.status === "failed") log(`email failed for meeting ${m.id}: ${res.error}`);
      }
      log(`email: ${stats.emailsSent} meeting note email(s) sent via ${deps.mail.name} (${merged.newMeetings.length} new meetings)`);
    }

    // ---- 8. draft invites: Phase 0 keeps meeting_requests as DRAFTS (rule 7); the calendar
    // provider that turns confirmed drafts into invites arrives with packages/calendar (Phase 2).
    const confirmed = merged.state.meetingRequests.filter((m) => m.state === "confirmed").length;
    if (confirmed) log(`invites: ${confirmed} confirmed draft(s) waiting for a calendar connection`);

    // ---- 9. persist state + snapshots (only after everything above succeeded) -------
    await repo.saveWorkingSet(db, deps.sealer, user.id, run.id, merged.state, printed);
    for (const d of baselineOnly) await repo.upsertDocSnapshot(db, user.id, run.id, { id: d.id, hash: d.hash, name: d.name, path: d.path, fileType: d.fileType, lastModified: d.lastModified, pageCount: d.pageCount });
    for (const { doc } of downloaded) {
      const d = doc.document;
      const stillPending = doc.pages.filter((p) => unprocessed.has(`${d.id}/${p.pageId}`)).length;
      // The document hash short-circuits the per-page check, so a document with any page left
      // unprocessed keeps its old snapshot and is examined again next run.
      if (stillPending === 0) {
        await repo.upsertDocSnapshot(db, user.id, run.id, { id: d.id, hash: d.hash, name: d.name, path: d.path, fileType: d.fileType, lastModified: d.lastModified, pageCount: d.pageCount });
      } else {
        log(`retry queued: "${d.name}" has ${stillPending} page(s) that did not process`);
      }
      for (const p of doc.pages) {
        if (unprocessed.has(`${d.id}/${p.pageId}`)) continue;
        const k = decodedKinds.get(`${d.id}/${p.pageId}`);
        await repo.upsertPageSnapshot(db, user.id, run.id, d.id, { pageId: p.pageId, index: p.index, hash: p.hash, kind: k?.kind ?? null, confidence: k?.confidence ?? null });
      }
    }
    await repo.markTabletOk(db, user.id, null);

    // ---- 10. rotate the 1-day cache: delete the PREVIOUS run's cache, log it (rule 5) -
    for (const prev of await repo.unpurgedPreviousRuns(db, user.id, run.id)) {
      const purged = await deps.cache.purge(prev.id);
      await repo.updateRun(db, prev.id, { cachePurgedAt: new Date() });
      stats.purgedRunId = prev.id;
      stats.purgedFiles += purged.files;
      stats.purgedBytes += purged.bytes;
      log(`cache rotated: purged run ${prev.id.slice(0, 8)} (${purged.files} files, ${purged.bytes} bytes)`);
    }

    await repo.finishRun(db, run.id, "succeeded", stats, null);
    log(`run ${run.id.slice(0, 8)} succeeded: ${stats.pagesDecoded} pages decoded, ${stats.tasksFound} tasks, ${stats.eventsFound} events, ${stats.meetingsFound} meetings, $${stats.costUsd.toFixed(4)}`);
    return { runId: run.id, status: "succeeded", localDate, stats, error: null };
  } catch (err) {
    const msg = err instanceof TabletProviderError ? `tablet [${err.code}]: ${err.message}` : (err as Error).message;
    if (err instanceof TabletProviderError) await repo.markTabletOk(db, user.id, msg);
    await repo.finishRun(db, run.id, "failed", stats, msg);
    log(`run ${run.id.slice(0, 8)} failed: ${msg}`);
    return { runId: run.id, status: "failed", localDate, stats, error: msg };
  }
}

/** Keep 7 dated Planner archives (ARCHITECTURE §6). */
async function rotateArchive(deps: PipelineDeps, docs: TabletDocument[], folder: TabletFolder, archive: TabletFolder, localDate: string, log: (m: string) => void): Promise<void> {
  const current = docs.find((d) => d.parentId === folder.id && d.name === "Planner");
  if (current) {
    const stamp = current.lastModified ? DateTime.fromJSDate(current.lastModified).toISODate() : localDate;
    try {
      const renamed = await deps.tablet.renameDocument(current, `Planner ${stamp}`);
      await deps.tablet.moveDocument({ ...current, hash: renamed.hash, name: `Planner ${stamp}` }, archive);
    } catch (err) {
      log(`archive rotation skipped: ${(err as Error).message}`);
    }
  }
  const cutoff = DateTime.fromISO(localDate).minus({ days: ARCHIVE_DAYS }).toISODate()!;
  const stale = docs.filter((d) => d.parentId === archive.id && /^Planner (\d{4}-\d{2}-\d{2})$/.test(d.name) && d.name.slice(8) < cutoff);
  for (const d of stale) {
    try {
      await deps.tablet.deleteDocument(d);
    } catch (err) {
      log(`archive cleanup skipped for ${d.name}: ${(err as Error).message}`);
    }
  }
  if (stale.length) log(`archive: removed ${stale.length} planner(s) older than ${ARCHIVE_DAYS} days`);
}
