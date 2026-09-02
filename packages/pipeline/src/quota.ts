/**
 * On-demand sync quota (CLAUDE.md rule 11): 3 per rolling 24h per user, counted across web
 * and mobile together, enforced HERE and nowhere else. A completed on-demand sync satisfies
 * (user, local-date) so the 3AM scheduler skips that user.
 */
import { and, eq, schema, type Db } from "@daymarkable/db";
import { DateTime } from "luxon";
import type { Runtime } from "./deps.js";
import { pipelineDepsFor } from "./deps.js";
import * as repo from "./repo.js";
import { runPipeline } from "./run.js";

export const ON_DEMAND_LIMIT = 3;
export const ON_DEMAND_WINDOW_HOURS = 24;

export interface QuotaStatus {
  limit: number;
  used: number;
  remaining: number;
  /** When the oldest counted run leaves the window (null when remaining > 0). */
  nextAvailableAt: Date | null;
  windowHours: number;
}

export async function getOnDemandQuota(db: Db, userId: string, now = new Date()): Promise<QuotaStatus> {
  const since = new Date(now.getTime() - ON_DEMAND_WINDOW_HOURS * 3600_000);
  const runs = (await repo.onDemandRunsSince(db, userId, since)).filter((r) => r.status !== "skipped");
  const used = Math.min(runs.length, ON_DEMAND_LIMIT);
  const remaining = Math.max(0, ON_DEMAND_LIMIT - runs.length);
  const oldest = runs.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[Math.max(0, runs.length - ON_DEMAND_LIMIT)];
  return {
    limit: ON_DEMAND_LIMIT,
    used,
    remaining,
    nextAvailableAt: remaining > 0 || !oldest ? null : new Date(oldest.createdAt.getTime() + ON_DEMAND_WINDOW_HOURS * 3600_000),
    windowHours: ON_DEMAND_WINDOW_HOURS,
  };
}

export class QuotaExhaustedError extends Error {
  constructor(readonly status: QuotaStatus) {
    super(`on-demand sync quota exhausted (${status.limit} per ${status.windowHours}h); next available ${status.nextAvailableAt?.toISOString()}`);
    this.name = "QuotaExhaustedError";
  }
}

export class RunInProgressError extends Error {
  constructor(readonly runId: string) {
    super("a run is already in progress");
    this.name = "RunInProgressError";
  }
}

export interface StartedSync {
  runId: string;
  localDate: string;
  quota: QuotaStatus;
}

/** Enforce the quota, then start the on-demand run in the background. Resolves once the run row exists. */
export async function startOnDemandSync(rt: Runtime, userId: string, requestedVia: string): Promise<StartedSync> {
  const quota = await getOnDemandQuota(rt.db, userId);
  if (quota.remaining <= 0) throw new QuotaExhaustedError(quota);
  const running = await rt.db.query.runs.findFirst({ where: and(eq(schema.runs.userId, userId), eq(schema.runs.status, "running")) });
  if (running) throw new RunInProgressError(running.id);
  const deps = await pipelineDepsFor(rt, userId);
  const user = await repo.getUser(rt.db, userId);
  const localDate = DateTime.now().setZone(user.timezone).toISODate()!;
  const started = new Promise<string>((resolve, reject) => {
    runPipeline(deps, { userId, kind: "on_demand", requestedVia, onStarted: resolve }).then((o) => {
      if (o.runId) resolve(o.runId);
      else reject(new Error(o.error ?? "run did not start"));
    }, reject);
  });
  const runId = await started;
  return { runId, localDate, quota: await getOnDemandQuota(rt.db, userId) };
}
