/**
 * Database access for the pipeline. Loads/saves the working set (packages/core WorkingSet),
 * snapshots for change detection, runs, costs, documents, and email log.
 * No content in logs; meeting bodies and device tokens sealed with the data key.
 */
import type { DecodeStageUsage } from "@daymarkable/decode";
import type { Meeting, PrintedItem, WorkingSet } from "@daymarkable/core";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  sql,
  type Db,
  type RunStats,
  type Sealer,
  type UserSettings,
} from "@daymarkable/db";
import { STARTER_CONVENTIONS } from "@daymarkable/decode";

export type UserRow = typeof schema.users.$inferSelect;
export type RunRow = typeof schema.runs.$inferSelect;

export function defaultSettings(): UserSettings {
  return {
    version: 1,
    watchFolders: [],
    includePdfs: false,
    conventions: STARTER_CONVENTIONS as UserSettings["conventions"],
    email: { meetingNotes: true, runSummary: false, inviteConfirmations: true },
    confidenceThreshold: 0.7,
    autoSendInvites: false,
    decodeModel: null,
    escalationModel: null,
  };
}

export async function ensureUser(db: Db, email: string, timezone: string): Promise<UserRow> {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) return existing;
  const [row] = await db.insert(schema.users).values({ email, timezone, settings: defaultSettings() }).returning();
  return row!;
}

export async function getUser(db: Db, userId: string): Promise<UserRow> {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw new Error(`user ${userId} not found`);
  return u;
}

// ---------------------------------------------------------------- credentials
export async function saveDeviceToken(db: Db, sealer: Sealer, userId: string, token: string): Promise<void> {
  await db
    .insert(schema.tabletCredentials)
    .values({ userId, deviceTokenEnc: sealer.seal(token) })
    .onConflictDoUpdate({ target: schema.tabletCredentials.userId, set: { deviceTokenEnc: sealer.seal(token), pairedAt: new Date(), lastError: null } });
}

export async function getDeviceToken(db: Db, sealer: Sealer, userId: string): Promise<string | null> {
  const row = await db.query.tabletCredentials.findFirst({ where: eq(schema.tabletCredentials.userId, userId) });
  return row ? sealer.open(row.deviceTokenEnc) : null;
}

export async function markTabletOk(db: Db, userId: string, error: string | null): Promise<void> {
  await db
    .update(schema.tabletCredentials)
    .set(error ? { lastError: error } : { lastOkAt: new Date(), lastError: null })
    .where(eq(schema.tabletCredentials.userId, userId));
}

// ---------------------------------------------------------------- runs
export async function findSatisfiedRun(db: Db, userId: string, localDate: string): Promise<RunRow | undefined> {
  return db.query.runs.findFirst({
    where: and(eq(schema.runs.userId, userId), eq(schema.runs.localDate, localDate), eq(schema.runs.status, "succeeded")),
    orderBy: desc(schema.runs.finishedAt),
  });
}

export async function lastSuccessfulRun(db: Db, userId: string): Promise<RunRow | undefined> {
  return db.query.runs.findFirst({
    where: and(eq(schema.runs.userId, userId), eq(schema.runs.status, "succeeded")),
    orderBy: desc(schema.runs.finishedAt),
  });
}

export async function nextOnDemandSeq(db: Db, userId: string, localDate: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${schema.runs.seq}), 0)` })
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, userId), eq(schema.runs.localDate, localDate), eq(schema.runs.kind, "on_demand")));
  return Number(row?.max ?? 0) + 1;
}

/** Rule 11: on-demand syncs in the rolling 24h window, counted across every surface. */
export async function onDemandRunsSince(db: Db, userId: string, since: Date): Promise<RunRow[]> {
  return db.query.runs.findMany({
    where: and(eq(schema.runs.userId, userId), eq(schema.runs.kind, "on_demand"), sql`${schema.runs.createdAt} >= ${since}`),
    orderBy: desc(schema.runs.createdAt),
  });
}

export async function createRun(db: Db, input: { userId: string; localDate: string; kind: "nightly" | "on_demand"; seq: number; requestedVia: string; decodeModel: string; cacheDir: string | null }): Promise<RunRow> {
  const [row] = await db
    .insert(schema.runs)
    .values({ ...input, status: "running", startedAt: new Date() })
    .returning();
  return row!;
}

export async function updateRun(db: Db, runId: string, patch: Partial<typeof schema.runs.$inferInsert>): Promise<void> {
  await db.update(schema.runs).set(patch).where(eq(schema.runs.id, runId));
}

export async function finishRun(db: Db, runId: string, status: "succeeded" | "failed" | "skipped", stats: RunStats | null, error: string | null): Promise<void> {
  await db.update(schema.runs).set({ status, finishedAt: new Date(), stats, error }).where(eq(schema.runs.id, runId));
}

export async function unpurgedPreviousRuns(db: Db, userId: string, currentRunId: string): Promise<RunRow[]> {
  return db.query.runs.findMany({
    where: and(eq(schema.runs.userId, userId), isNull(schema.runs.cachePurgedAt), sql`${schema.runs.cacheDir} is not null`, sql`${schema.runs.id} <> ${currentRunId}`),
  });
}

export async function recordCosts(db: Db, runId: string, userId: string, stage: string, usages: Iterable<DecodeStageUsage>, pages: number): Promise<number> {
  let total = 0;
  for (const u of usages) {
    total += u.cost_usd;
    await db.insert(schema.runCosts).values({
      runId,
      userId,
      stage,
      model: u.model,
      mode: u.mode,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens,
      cacheWriteTokens: u.cache_creation_input_tokens,
      costUsd: u.cost_usd.toFixed(6),
      pages,
    });
  }
  return total;
}

// ---------------------------------------------------------------- snapshots
export interface DocSnapshot {
  docId: string;
  hash: string;
  lastModified: Date | null;
}

export async function loadDocSnapshots(db: Db, userId: string): Promise<Map<string, DocSnapshot>> {
  const rows = await db.query.docSnapshots.findMany({ where: eq(schema.docSnapshots.userId, userId) });
  return new Map(rows.map((r) => [r.docId, { docId: r.docId, hash: r.hash, lastModified: r.lastModified }]));
}

export async function loadPageSnapshots(db: Db, userId: string, docId: string): Promise<Map<string, string | null>> {
  const rows = await db.query.pageSnapshots.findMany({ where: and(eq(schema.pageSnapshots.userId, userId), eq(schema.pageSnapshots.docId, docId)) });
  return new Map(rows.map((r) => [r.pageId, r.hash]));
}

export async function upsertDocSnapshot(db: Db, userId: string, runId: string, doc: { id: string; hash: string; name: string; path: string; fileType: string; lastModified: Date | null; pageCount: number }): Promise<void> {
  const values = { userId, docId: doc.id, hash: doc.hash, name: doc.name, path: doc.path, fileType: doc.fileType, lastModified: doc.lastModified, pageCount: doc.pageCount, lastRunId: runId, updatedAt: new Date() };
  await db.insert(schema.docSnapshots).values(values).onConflictDoUpdate({ target: [schema.docSnapshots.userId, schema.docSnapshots.docId], set: values });
}

export async function upsertPageSnapshot(db: Db, userId: string, runId: string, docId: string, page: { pageId: string; index: number; hash: string | null; kind: string | null; confidence: number | null }): Promise<void> {
  const values = { userId, docId, pageId: page.pageId, pageIndex: page.index, hash: page.hash, lastDecodedRunId: runId, pageKind: page.kind, confidence: page.confidence, updatedAt: new Date() };
  await db.insert(schema.pageSnapshots).values(values).onConflictDoUpdate({ target: [schema.pageSnapshots.userId, schema.pageSnapshots.docId, schema.pageSnapshots.pageId], set: values });
}

// ---------------------------------------------------------------- working set
export async function loadWorkingSet(db: Db, sealer: Sealer, userId: string): Promise<WorkingSet> {
  const [tasks, events, mrs, inbox, meetings, printed] = await Promise.all([
    db.query.tasks.findMany({ where: eq(schema.tasks.userId, userId) }),
    db.query.events.findMany({ where: eq(schema.events.userId, userId) }),
    db.query.meetingRequests.findMany({ where: eq(schema.meetingRequests.userId, userId) }),
    db.query.inboxItems.findMany({ where: eq(schema.inboxItems.userId, userId) }),
    db.query.meetings.findMany({ where: eq(schema.meetings.userId, userId) }),
    latestPrinted(db, userId),
  ]);
  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      text: t.text,
      due: t.due,
      dueTime: t.dueTime,
      priority: t.priority,
      kind: t.kind,
      project: t.project,
      people: t.people,
      confidence: t.confidence,
      source: { notebook: t.sourceNotebook ?? "", pageIndex: t.sourcePageIndex ?? 0 },
      carriedCount: t.carriedCount,
      createdOn: t.createdOn,
      status: t.status,
      sourceConvention: t.sourceConvention,
      lastAgedOn: t.lastAgedOn,
      completedOn: t.completedOn,
    })),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      people: e.people,
      source: e.source,
      confidence: e.confidence,
      status: e.status,
    })),
    meetingRequests: mrs.map((m) => ({
      id: m.id,
      topic: m.topic,
      proposedDate: m.proposedDate,
      proposedTime: m.proposedTime,
      durationMinutes: m.durationMinutes,
      attendees: m.attendees,
      confidence: m.confidence,
      source: { notebook: "", pageIndex: 0 },
      state: m.state,
      confirmedOn: m.confirmedOn,
    })),
    inbox: inbox.map((i) => ({
      id: i.id,
      kind: i.kind,
      text: i.text,
      detail: i.detail,
      confidence: i.confidence,
      source: { notebook: i.sourceNotebook ?? "", pageIndex: i.sourcePageIndex ?? 0 },
      status: i.status,
      payload: i.payload,
      createdOn: i.createdOn,
    })),
    meetings: meetings.map((m) => {
      const body = sealer.openJson<{ text: string; decisions: string[]; actions: string[] }>(m.bodyEnc);
      return {
        id: m.id,
        topic: m.topic,
        date: m.date,
        time: m.time,
        attendees: m.attendees,
        text: body.text,
        decisions: body.decisions,
        actions: body.actions,
        confidence: m.confidence,
        source: { notebook: m.sourceNotebook ?? "", pageIndex: m.sourcePageIndex ?? 0 },
      };
    }),
    printed,
  };
}

/** Printed items from every run whose outputs may still be on the tablet (last 8 days). */
async function latestPrinted(db: Db, userId: string): Promise<PrintedItem[]> {
  const rows = await db
    .select({ pageCode: schema.printedItems.pageCode, itemCode: schema.printedItems.itemCode, itemType: schema.printedItems.itemType, itemId: schema.printedItems.itemId, runId: schema.printedItems.runId })
    .from(schema.printedItems)
    .where(eq(schema.printedItems.userId, userId));
  // Latest run wins for a given (pageCode, itemCode).
  const seen = new Map<string, PrintedItem>();
  for (const r of rows) seen.set(`${r.pageCode}|${r.itemCode}`, { pageCode: r.pageCode, itemCode: r.itemCode, itemType: r.itemType, itemId: r.itemId });
  return [...seen.values()];
}

export async function saveWorkingSet(db: Db, sealer: Sealer, userId: string, runId: string, state: WorkingSet, printed: PrintedItem[]): Promise<void> {
  const now = new Date();
  for (const t of state.tasks) {
    const values = {
      id: t.id,
      userId,
      text: t.text,
      due: t.due,
      dueTime: t.dueTime,
      priority: t.priority,
      kind: t.kind,
      project: t.project,
      people: t.people,
      confidence: t.confidence,
      sourceConvention: t.sourceConvention,
      sourceNotebook: t.source.notebook,
      sourcePageIndex: t.source.pageIndex,
      status: t.status,
      carriedCount: t.carriedCount,
      lastAgedOn: t.lastAgedOn,
      createdOn: t.createdOn,
      completedOn: t.completedOn,
      updatedRunId: runId,
      updatedAt: now,
    };
    await db.insert(schema.tasks).values({ ...values, createdRunId: runId }).onConflictDoUpdate({ target: schema.tasks.id, set: values });
  }
  for (const e of state.events) {
    const values = { id: e.id, userId, title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, location: e.location, people: e.people, source: e.source, confidence: e.confidence, status: e.status, updatedAt: now };
    await db.insert(schema.events).values({ ...values, createdRunId: runId }).onConflictDoUpdate({ target: schema.events.id, set: values });
  }
  for (const m of state.meetingRequests) {
    const values = { id: m.id, userId, topic: m.topic, proposedDate: m.proposedDate, proposedTime: m.proposedTime, durationMinutes: m.durationMinutes, attendees: m.attendees, confidence: m.confidence, state: m.state, confirmedOn: m.confirmedOn, updatedAt: now };
    await db.insert(schema.meetingRequests).values({ ...values, createdRunId: runId }).onConflictDoUpdate({ target: schema.meetingRequests.id, set: values });
  }
  for (const i of state.inbox) {
    const values = { id: i.id, userId, kind: i.kind, text: i.text, detail: i.detail, confidence: i.confidence, payload: i.payload, status: i.status, sourceNotebook: i.source.notebook, sourcePageIndex: i.source.pageIndex, createdOn: i.createdOn, updatedAt: now, ...(i.status !== "pending" ? { resolvedRunId: runId } : {}) };
    await db.insert(schema.inboxItems).values({ ...values, createdRunId: runId }).onConflictDoUpdate({ target: schema.inboxItems.id, set: values });
  }
  for (const m of state.meetings) {
    const values = { id: m.id, userId, topic: m.topic, date: m.date, time: m.time, attendees: m.attendees, bodyEnc: sealer.sealJson({ text: m.text, decisions: m.decisions, actions: m.actions }), confidence: m.confidence, sourceNotebook: m.source.notebook, sourcePageIndex: m.source.pageIndex };
    await db.insert(schema.meetings).values({ ...values, createdRunId: runId }).onConflictDoUpdate({ target: schema.meetings.id, set: values });
  }
  if (printed.length) {
    await db.insert(schema.printedItems).values(printed.map((p) => ({ userId, runId, pageCode: p.pageCode, itemCode: p.itemCode, itemType: p.itemType, itemId: p.itemId })));
  }
  // Printed items older than 8 days can no longer be on the tablet (7-day archive).
  const oldRuns = await db.query.runs.findMany({ where: and(eq(schema.runs.userId, userId), sql`${schema.runs.createdAt} < now() - interval '8 days'`) });
  if (oldRuns.length) await db.delete(schema.printedItems).where(inArray(schema.printedItems.runId, oldRuns.map((r) => r.id)));
}

// ---------------------------------------------------------------- documents + email
export async function registerDocument(db: Db, input: { userId: string; runId: string; kind: "planner" | "action_list" | "meeting_notes"; name: string; cachePath: string; bytes: number; pageCount: number; tabletDocId: string | null }): Promise<void> {
  await db.insert(schema.documents).values(input);
}

export async function emailAlreadySent(db: Db, idempotencyKey: string): Promise<boolean> {
  const row = await db.query.emailLog.findFirst({ where: eq(schema.emailLog.idempotencyKey, idempotencyKey) });
  return !!row && row.status === "sent";
}

export async function logEmail(db: Db, input: { userId: string; runId: string; idempotencyKey: string; toEmail: string; subject: string; status: "sent" | "failed" | "skipped"; providerId: string | null; error: string | null }): Promise<void> {
  await db
    .insert(schema.emailLog)
    .values(input)
    .onConflictDoUpdate({ target: schema.emailLog.idempotencyKey, set: { status: input.status, providerId: input.providerId, error: input.error, sentAt: new Date(), runId: input.runId } });
}

export type { Meeting };
