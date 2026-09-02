import "server-only";
import { and, desc, eq, inArray, schema, sql, type UserSettings } from "@daymarkable/db";
import { CONVENTION_CATALOG, validateConventions } from "@daymarkable/decode";
import { QuotaExhaustedError, RunInProgressError, getOnDemandQuota, repo, startOnDemandSync, tabletFor, type QuotaStatus } from "@daymarkable/pipeline";
import { RemarkableCloudProvider, pairWithCode } from "@daymarkable/tablet";
import { DateTime } from "luxon";
import { z } from "zod";
import { getRuntime } from "./runtime";

// ------------------------------------------------------------------ account
export const settingsPatchSchema = z.object({
  watchFolders: z.array(z.string().min(1)).max(50).optional(),
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
  if (patch.conventions) next.conventions = validateConventions(patch.conventions) as UserSettings["conventions"];
  if (patch.email) next.email = patch.email;
  if (patch.confidenceThreshold !== undefined) next.confidenceThreshold = patch.confidenceThreshold;
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
  return tree.folders.filter((f) => !f.path.startsWith("/dayMarkable")).map((f) => ({ path: f.path, notebooks: counts.get(f.path) ?? 0 }));
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
  const events = state.events.filter((e) => e.status === "active" && (e.date === null || e.date >= today)).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
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
