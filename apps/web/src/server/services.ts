import "server-only";
import { and, desc, eq, inArray, schema, sql, type UserSettings } from "@daymarkable/db";
import type { DecisionAction, DecisionItemType } from "@daymarkable/core";
import { BASELINE_DECODE_MODEL, CONVENTION_CATALOG, anthropicClient, isRetiredDecodeModel, generateCalibrationPassage, learnedTerms, transcribePage, transcriptionAccuracy, validateConventions } from "@daymarkable/decode";
import { CALIBRATION_MIN_ACCURACY, CALIBRATION_NOTEBOOK, HttpRenderer, QuotaExhaustedError, ROOT_FOLDER, RunInProgressError, getOnDemandQuota, isOurDocument, outputFolderFor, repo, republishNotebooks, startOnDemandSync, tabletFor, type QuotaStatus } from "@daymarkable/pipeline";
import { composeCalibrationSheet } from "@daymarkable/compose";
import { RemarkableCloudProvider, pairWithCode } from "@daymarkable/tablet";
import { DateTime } from "luxon";
import { z } from "zod";
import { getRuntime } from "./runtime";

// ------------------------------------------------------------------ account
export const settingsPatchSchema = z.object({
  watchFolders: z.array(z.string().min(1)).max(50).optional(),
  outputToRoot: z.boolean().optional(),
  includePdfs: z.boolean().optional(),
  conventions: z.object({ active: z.array(z.object({ id: z.string(), meaning: z.string(), keyword: z.string().optional() })) }).optional(),
  email: z.object({ meetingNotes: z.boolean(), runSummary: z.boolean(), inviteConfirmations: z.boolean() }).optional(),
  confidenceThreshold: z.number().min(0.3).max(0.95).optional(),
  decodeModel: z.string().min(1).nullable().optional(),
  escalationModel: z.string().min(1).nullable().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export async function getAccount(userId: string) {
  const rt = await getRuntime();
  const user = await repo.getUser(rt.db, userId);
  const cred = await rt.db.query.tabletCredentials.findFirst({ where: eq(schema.tabletCredentials.userId, userId) });
  const quota = await getOnDemandQuota(rt.db, userId);
  return {
    id: user.id,
    email: user.email,
    timezone: user.timezone,
    status: user.status,
    onboardedAt: user.onboardedAt,
    settings: user.settings,
    tablet: cred ? { paired: true as const, pairedAt: cred.pairedAt, lastOkAt: cred.lastOkAt, lastError: cred.lastError } : { paired: false as const },
    quota,
    conventionCatalog: CONVENTION_CATALOG,
  };
}

export async function updateSettings(userId: string, patch: SettingsPatch) {
  const rt = await getRuntime();
  const user = await repo.getUser(rt.db, userId);
  const next: UserSettings = { ...user.settings };
  if (patch.watchFolders) next.watchFolders = patch.watchFolders.map((f) => (f.startsWith("/") ? f : `/${f}`));
  if (patch.includePdfs !== undefined) next.includePdfs = patch.includePdfs;
  if (patch.outputToRoot !== undefined) next.outputToRoot = patch.outputToRoot;
  if (patch.conventions) next.conventions = validateConventions(patch.conventions) as UserSettings["conventions"];
  if (patch.email) next.email = patch.email;
  if (patch.confidenceThreshold !== undefined) next.confidenceThreshold = patch.confidenceThreshold;
  // A retired model must not be selectable by hand either — say so instead of accepting it
  // and quietly substituting, so the setting always means what it says.
  for (const m of [patch.decodeModel, patch.escalationModel]) {
    if (m && isRetiredDecodeModel(m)) throw new Error(`${m} is retired — it read handwriting materially worse than ${BASELINE_DECODE_MODEL}`);
  }
  if (patch.decodeModel !== undefined) next.decodeModel = patch.decodeModel;
  if (patch.escalationModel !== undefined) next.escalationModel = patch.escalationModel;
  await rt.db.update(schema.users).set({ settings: next, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return next;
}

export async function updateTimezone(userId: string, timezone: string) {
  if (!DateTime.now().setZone(timezone).isValid) throw new Error("unknown timezone");
  const rt = await getRuntime();
  await rt.db.update(schema.users).set({ timezone, updatedAt: new Date() }).where(eq(schema.users.id, userId));
}

export async function completeOnboarding(userId: string) {
  const rt = await getRuntime();
  await rt.db.update(schema.users).set({ onboardedAt: new Date(), updatedAt: new Date() }).where(eq(schema.users.id, userId));
}

export async function pairTablet(userId: string, code: string) {
  const rt = await getRuntime();
  const token = await pairWithCode(code);
  const api = await RemarkableCloudProvider.fromDeviceToken(token);
  const tree = await api.listTree();
  await repo.saveDeviceToken(rt.db, rt.sealer, userId, token);
  await repo.markTabletOk(rt.db, userId, null);
  return { folders: tree.folders.length, documents: tree.documents.length };
}

export async function listTabletFolders(userId: string) {
  const rt = await getRuntime();
  const tablet = await tabletFor(rt, userId);
  const tree = await tablet.listTree();
  const counts = new Map<string, number>();
  for (const d of tree.documents) {
    if (d.fileType !== "notebook") continue;
    const parent = tree.folders.find((f) => f.id === d.parentId)?.path ?? "/";
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  // The tablet's root is a real place to keep notebooks, so it is offered like any folder.
  const root = { path: ROOT_FOLDER, label: "Root (notebooks not in a folder)", notebooks: counts.get(ROOT_FOLDER) ?? 0 };
  // Two folders can share a name and therefore a path; watching one watches both, so merge
  // them into a single row rather than offering the same path twice.
  const byPath = new Map<string, { path: string; label: string; notebooks: number }>();
  for (const f of tree.folders) {
    if (f.path.startsWith("/dayMarkable")) continue;
    // counts is keyed by path and already covers every folder sharing it, so set once.
    if (!byPath.has(f.path)) byPath.set(f.path, { path: f.path, label: f.path, notebooks: counts.get(f.path) ?? 0 });
  }
  return [root, ...[...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))];
}

export function listTimezones(): string[] {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return all.length ? all : ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];
}

// ------------------------------------------------------------------ documents (rule 12: read-only from cache + registry)
export async function listDocuments(userId: string) {
  const rt = await getRuntime();
  const latest = await repo.lastSuccessfulRun(rt.db, userId);
  if (!latest) return { run: null, documents: [] };
  const docs = await rt.db.query.documents.findMany({ where: and(eq(schema.documents.userId, userId), eq(schema.documents.runId, latest.id)) });
  const available = [];
  for (const d of docs) {
    available.push({ id: d.id, kind: d.kind, name: d.name, pageCount: d.pageCount, bytes: d.bytes, createdAt: d.createdAt, cached: await rt.cache.exists(latest.id, d.cachePath) });
  }
  return { run: { id: latest.id, kind: latest.kind, localDate: latest.localDate, finishedAt: latest.finishedAt }, documents: available };
}

export async function readDocument(userId: string, documentId: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const rt = await getRuntime();
  const d = await rt.db.query.documents.findFirst({ where: and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId)) });
  if (!d) return null;
  if (!(await rt.cache.exists(d.runId, d.cachePath))) return null; // purged: 24h retention, never regenerated
  return { name: d.name, bytes: await rt.cache.get(d.runId, d.cachePath) };
}

export async function getRegistry(userId: string) {
  const rt = await getRuntime();
  const user = await repo.getUser(rt.db, userId);
  const today = DateTime.now().setZone(user.timezone).toISODate()!;
  const state = await repo.loadWorkingSet(rt.db, rt.sealer, userId);
  const actions = state.tasks.filter((t) => t.status === "open" || t.status === "carried");
  const events = state.events.filter((e) => e.status === "active" && e.date !== null && e.date >= today).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const meetings = [...state.meetings].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.time ?? "").localeCompare(a.time ?? ""));
  const inbox = state.inbox.filter((i) => i.status === "pending");
  const doneRecently = state.tasks.filter((t) => t.status === "done" && t.completedOn && t.completedOn >= DateTime.fromISO(today).minus({ days: 7 }).toISODate()!);
  return { today, actions, events, meetings, inbox, doneRecently, meetingRequests: state.meetingRequests.filter((m) => m.state !== "dropped") };
}

/** Header status per the style guide: `SYNCED 02:14` (user's timezone), or null before the first run. */
export async function lastSyncLabel(userId: string): Promise<string | null> {
  const rt = await getRuntime();
  const [user, last] = await Promise.all([repo.getUser(rt.db, userId), repo.lastSuccessfulRun(rt.db, userId)]);
  if (!last?.finishedAt) return null;
  const t = DateTime.fromJSDate(last.finishedAt).setZone(user.timezone);
  const today = DateTime.now().setZone(user.timezone).toISODate();
  return `SYNCED ${t.toISODate() === today ? "" : `${t.toFormat("ccc d LLL").toUpperCase()} `}${t.toFormat("HH:mm")}`;
}

/** Due tag copy from the Web UI mock: TOMORROW / THIS WEEK / THIS MONTH / date. */
export function dueTag(due: string | null, today: string): { label: string; soon: boolean } | null {
  if (!due) return null;
  const d = DateTime.fromISO(due);
  const t = DateTime.fromISO(today);
  const days = Math.round(d.diff(t, "days").days);
  if (days < 0) return { label: "OVERDUE", soon: true };
  if (days === 0) return { label: "TODAY", soon: true };
  if (days === 1) return { label: "TOMORROW", soon: true };
  if (days <= 7) return { label: "THIS WEEK", soon: false };
  if (d.hasSame(t, "month")) return { label: "THIS MONTH", soon: false };
  return { label: d.toFormat("d LLL").toUpperCase(), soon: false };
}

// ------------------------------------------------------------------ runs + sync now
export type RunLabel = "Automatic" | "On-demand";

export async function listRuns(userId: string, limit = 30) {
  const rt = await getRuntime();
  const runs = await rt.db.query.runs.findMany({ where: eq(schema.runs.userId, userId), orderBy: desc(schema.runs.createdAt), limit });
  const ids = runs.map((r) => r.id);
  const ratings = ids.length ? await rt.db.query.feedback.findMany({ where: inArray(schema.feedback.runId, ids) }) : [];
  const costs = ids.length
    ? await rt.db.select({ runId: schema.runCosts.runId, usd: sql<string>`sum(${schema.runCosts.costUsd})`, models: sql<string>`string_agg(distinct ${schema.runCosts.model}, ', ')` }).from(schema.runCosts).where(inArray(schema.runCosts.runId, ids)).groupBy(schema.runCosts.runId)
    : [];
  const costById = new Map(costs.map((c) => [c.runId, c]));
  return runs.map((r) => ({
    id: r.id,
    label: (r.kind === "nightly" ? "Automatic" : "On-demand") as RunLabel,
    kind: r.kind,
    seq: r.seq,
    requestedVia: r.requestedVia,
    localDate: r.localDate,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    error: r.error,
    stats: r.stats,
    decodeModel: r.decodeModel,
    models: costById.get(r.id)?.models ?? r.decodeModel ?? "",
    costUsd: Number(costById.get(r.id)?.usd ?? 0),
    rating: ratings.find((f) => f.runId === r.id) ?? null,
    cachePurgedAt: r.cachePurgedAt,
  }));
}

export async function getRun(userId: string, runId: string) {
  const all = await listRuns(userId, 200);
  return all.find((r) => r.id === runId) ?? null;
}

export type SyncNowResult =
  | { status: "started"; runId: string; quota: QuotaStatus }
  | { status: "exhausted"; quota: QuotaStatus; nextAvailableAt: Date }
  | { status: "busy"; runId: string }
  | { status: "error"; message: string };

export async function syncNow(userId: string, via: "web" | "mobile"): Promise<SyncNowResult> {
  const rt = await getRuntime();
  try {
    const started = await startOnDemandSync(rt, userId, via);
    return { status: "started", runId: started.runId, quota: started.quota };
  } catch (err) {
    if (err instanceof QuotaExhaustedError) return { status: "exhausted", quota: err.status, nextAvailableAt: err.status.nextAvailableAt! };
    if (err instanceof RunInProgressError) return { status: "busy", runId: err.runId };
    return { status: "error", message: (err as Error).message };
  }
}

export async function quotaStatus(userId: string): Promise<QuotaStatus> {
  const rt = await getRuntime();
  return getOnDemandQuota(rt.db, userId);
}

/**
 * Rebuild the three notebooks from the stored working set and send them to the tablet, without
 * syncing or decoding. Corrections made in the web UI reach the tablet this way; it calls no
 * model, so it costs nothing and is deliberately not rate-limited.
 */
export async function republish(userId: string) {
  const rt = await getRuntime();
  const tablet = await tabletFor(rt, userId);
  return republishNotebooks({ db: rt.db, sealer: rt.sealer, cache: rt.cache, tablet, log: rt.log }, userId);
}

// ------------------------------------------------------------------ feedback
export async function rateRun(userId: string, runId: string | null, rating: number, comment: string | null) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("rating must be 1-5");
  const rt = await getRuntime();
  if (runId) {
    const run = await rt.db.query.runs.findFirst({ where: and(eq(schema.runs.id, runId), eq(schema.runs.userId, userId)) });
    if (!run) throw new Error("run not found");
    const existing = await rt.db.query.feedback.findFirst({ where: and(eq(schema.feedback.userId, userId), eq(schema.feedback.runId, runId)) });
    if (existing) {
      await rt.db.update(schema.feedback).set({ rating, comment }).where(eq(schema.feedback.id, existing.id));
      return existing.id;
    }
  }
  const [row] = await rt.db.insert(schema.feedback).values({ userId, runId, rating, comment: comment?.trim().slice(0, 2000) || null }).returning();
  return row!.id;
}

export async function feedbackSummary(userId: string) {
  const rt = await getRuntime();
  const rows = await rt.db.query.feedback.findMany({ where: eq(schema.feedback.userId, userId), orderBy: desc(schema.feedback.createdAt), limit: 20 });
  const avg = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : null;
  return { average: avg, count: rows.length, recent: rows };
}

// ------------------------------------------------------------------ handwriting calibration
export const profileSchema = z.object({
  role: z.string().max(120),
  industry: z.string().max(120),
  context: z.string().max(600),
});
export type WriterProfileInput = z.infer<typeof profileSchema>;

export async function getCalibration(userId: string) {
  const rt = await getRuntime();
  const [user, active, captured] = await Promise.all([repo.getUser(rt.db, userId), repo.activeCalibration(rt.db, userId), repo.capturedCalibration(rt.db, userId)]);
  return {
    profile: user.settings.profile,
    lexicon: user.settings.lexicon,
    active: active ? { id: active.id, status: active.status, expectedText: active.expectedText, notebookName: active.notebookName, createdAt: active.createdAt } : null,
    captured: captured
      ? { id: captured.id, accuracy: captured.accuracy, capturedAt: captured.capturedAt, expectedText: captured.expectedText, transcribedText: captured.transcribedText }
      : null,
  };
}

/**
 * Generate a passage in this writer's own vocabulary, compose it as a sheet, and upload it to
 * the tablet for them to copy out. The written page is captured on the next run.
 */
export async function createCalibrationSheet(userId: string, profile: WriterProfileInput) {
  const rt = await getRuntime();
  if (!rt.config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured on this host");
  const user = await repo.getUser(rt.db, userId);
  const settings: UserSettings = { ...user.settings, profile };
  await rt.db.update(schema.users).set({ settings, updatedAt: new Date() }).where(eq(schema.users.id, userId));

  const passage = await generateCalibrationPassage(profile, anthropicClient(rt.config.anthropicApiKey), rt.config.decodeModel);
  const today = DateTime.now().setZone(user.timezone);
  const sheet = await composeCalibrationSheet({ text: passage.text, date: today.toISODate()!, generatedAt: today.toISO()! });

  const tablet = await tabletFor(rt, userId);
  const folder = await tablet.ensureFolder(outputFolderFor(user.settings));
  const uploaded = await tablet.uploadPdf(CALIBRATION_NOTEBOOK, sheet.pdf, folder, { replace: true });
  const row = await repo.createCalibration(rt.db, { userId, expectedText: passage.text, notebookName: CALIBRATION_NOTEBOOK, tabletDocId: uploaded.id, writingTop: sheet.writingTop });
  // Seed the lexicon with the terms the passage deliberately used.
  const added = await repo.addLexiconTerms(rt.db, userId, passage.terms);
  return { id: row.id, expectedText: passage.text, notebookName: CALIBRATION_NOTEBOOK, lexiconAdded: added.length, costUsd: passage.costUsd };
}

/**
 * Read the written sample now, on the user's say-so, rather than waiting for a sync: download
 * the sheet, render it, transcribe it, score it against the passage we asked for, and store it.
 * On success the very first extraction (7-day lookback) is started so the user gets their
 * lists immediately after calibrating.
 */
export async function calibrateNow(userId: string) {
  const rt = await getRuntime();
  if (!rt.config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured on this host");
  const pending = await repo.activeCalibration(rt.db, userId);
  if (!pending || pending.status !== "pending") throw new Error("no handwriting sample is waiting; generate one first");

  const tablet = await tabletFor(rt, userId);
  const tree = await tablet.listTree();
  const doc = tree.documents.find((d) => d.name === pending.notebookName && isOurDocument(d));
  if (!doc) throw new Error(`"${pending.notebookName}" is not on the tablet yet — sync the tablet and try again`);

  const refs = await tablet.listPages(doc);
  const inked = refs.filter((p) => p.hash);
  if (inked.length === 0) throw new Error("that sheet has no handwriting on it yet — write the lines, sync the tablet, then calibrate");

  const renderer = new HttpRenderer(rt.config.renderServiceUrl);
  await renderer.check();
  const dl = await tablet.downloadDocument(doc, { onlyPageIds: inked.map((p) => p.pageId) });
  // Crop away the printed passage: otherwise the decoder could read the answer off the sheet
  // instead of the handwriting, and the score would mean nothing.
  const { pages } = await renderer.renderDocument(dl, inked.map((p) => p.pageId), { cropTop: pending.writingTop });
  if (pages.length === 0) throw new Error("could not render that page; try syncing the tablet again");

  // Score every written page and keep the best match: the user may have written on page 2.
  const client = anthropicClient(rt.config.anthropicApiKey);
  let best: { accuracy: number; text: string; image: Uint8Array } | null = null;
  for (const p of pages) {
    const r = await transcribePage(p.segments, rt.config.decodeModel, client, { context: `Handwritten lines copied from a printed passage; the printed part has been cropped away. Page ${p.pageIndex + 1}.` });
    if (r.error) continue;
    const accuracy = transcriptionAccuracy(pending.expectedText, r.text);
    if (!best || accuracy > best.accuracy) best = { accuracy, text: r.text, image: p.segments[0]! };
  }
  if (!best) throw new Error("could not read that page at all; check the render service");
  if (best.accuracy < CALIBRATION_MIN_ACCURACY) {
    return { ok: false as const, accuracy: best.accuracy, transcribedText: best.text, message: `Only ${Math.round(best.accuracy * 100)}% of the passage came back. Check you copied the printed lines onto the ruled lines, then sync the tablet and try again.` };
  }
  await repo.captureCalibration(rt.db, rt.sealer, pending.id, { image: best.image, transcribedText: best.text, accuracy: best.accuracy, runId: null });

  // First extraction: a brand-new account has no successful run, so this reads the last 7 days.
  let firstRunId: string | null = null;
  const priorRun = await repo.lastSuccessfulRun(rt.db, userId);
  if (!priorRun) {
    try {
      firstRunId = (await startOnDemandSync(rt, userId, "web")).runId;
    } catch {
      firstRunId = null; // quota or a run already going; the user can press Sync now
    }
  }
  return { ok: true as const, accuracy: best.accuracy, transcribedText: best.text, firstRunId, message: `Calibrated: ${Math.round(best.accuracy * 100)}% of the passage read back.` };
}

export async function skipCalibration(userId: string) {
  const rt = await getRuntime();
  await repo.skipCalibration(rt.db, userId);
  return { ok: true };
}

export async function updateLexicon(userId: string, terms: string[]) {
  const rt = await getRuntime();
  const user = await repo.getUser(rt.db, userId);
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 1))].slice(0, 400);
  const settings: UserSettings = { ...user.settings, lexicon: cleaned };
  await rt.db.update(schema.users).set({ settings, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return cleaned;
}

// ------------------------------------------------------------------ corrections
/**
 * The user fixing a misread item. The corrected text replaces the item, and the words that
 * changed are promoted into the lexicon so the same misread does not recur.
 */
export async function correctItem(userId: string, itemType: "task" | "event" | "meeting" | "inbox", itemId: string, correctedText: string) {
  const rt = await getRuntime();
  const text = correctedText.trim();
  if (!text) throw new Error("corrected text cannot be empty");
  let original = "";
  if (itemType === "task") {
    const row = await rt.db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, itemId)) });
    if (!row) throw new Error("item not found");
    original = row.text;
    await rt.db.update(schema.tasks).set({ text, confidence: 1, updatedAt: new Date() }).where(eq(schema.tasks.id, itemId));
  } else if (itemType === "event") {
    const row = await rt.db.query.events.findFirst({ where: and(eq(schema.events.userId, userId), eq(schema.events.id, itemId)) });
    if (!row) throw new Error("item not found");
    original = row.title;
    await rt.db.update(schema.events).set({ title: text, confidence: 1, updatedAt: new Date() }).where(eq(schema.events.id, itemId));
  } else if (itemType === "inbox") {
    const row = await rt.db.query.inboxItems.findFirst({ where: and(eq(schema.inboxItems.userId, userId), eq(schema.inboxItems.id, itemId)) });
    if (!row) throw new Error("item not found");
    original = row.text;
    // The payload is what gets promoted, so the correction has to land there too — otherwise
    // accepting the item would resurrect the misread text.
    const field = row.kind === "event" ? "title" : row.kind === "meeting_request" ? "topic" : "text";
    const payload = { ...row.payload, [field]: text, confidence: 1 };
    await rt.db.update(schema.inboxItems).set({ text, payload, confidence: 1, updatedAt: new Date() }).where(eq(schema.inboxItems.id, itemId));
  } else {
    const row = await rt.db.query.meetings.findFirst({ where: and(eq(schema.meetings.userId, userId), eq(schema.meetings.id, itemId)) });
    if (!row) throw new Error("item not found");
    original = row.topic;
    await rt.db.update(schema.meetings).set({ topic: text, confidence: 1 }).where(eq(schema.meetings.id, itemId));
  }
  if (original === text) return { ok: true, learned: [] as string[], promoted: false };
  const learned = learnedTerms(original, text);
  await repo.recordCorrection(rt.db, { userId, itemType, itemId, originalText: original, correctedText: text, learnedTerms: learned });
  const added = await repo.addLexiconTerms(rt.db, userId, learned);
  // A corrected item is no longer a guess: the user has read it and said what it says. An Inbox
  // item only sits there because dayMarkable was unsure, so fixing it is a confirmation — it
  // moves out of "confirm these" and onto the real list (rule 3 applies to the machine's
  // uncertainty, not the user's).
  let promoted = false;
  if (itemType === "inbox") {
    const user = await repo.getUser(rt.db, userId);
    const today = DateTime.now().setZone(user.timezone).toISODate()!;
    await repo.decideItem(rt.db, rt.sealer, userId, { itemType: "inbox", itemId, action: "complete" }, today);
    promoted = true;
  }
  return { ok: true, learned: added, promoted };
}

/**
 * Tick an item off, or drop one that is not relevant — the web equivalent of ticking or crossing
 * out a row on a printed page. The change lands in the canonical data straight away; the tablet's
 * copies update on the next run, or immediately via "Send updated notebooks to tablet".
 */
export async function decideItem(userId: string, itemType: DecisionItemType, itemId: string, action: DecisionAction) {
  const rt = await getRuntime();
  const user = await repo.getUser(rt.db, userId);
  const today = DateTime.now().setZone(user.timezone).toISODate()!;
  const res = await repo.decideItem(rt.db, rt.sealer, userId, { itemType, itemId, action }, today);
  const created = res.created.tasks.length + res.created.events.length + res.created.meetingRequests.length;
  return { label: res.label, status: res.status, created };
}

export async function correctionHistory(userId: string) {
  const rt = await getRuntime();
  return repo.recentCorrections(rt.db, userId, 40);
}
