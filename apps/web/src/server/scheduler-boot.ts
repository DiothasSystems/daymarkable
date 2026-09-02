import "server-only";
import { and, desc, eq, schema } from "@daymarkable/db";
import { ensureDefaultUser, pipelineDepsFor, repo, runPipeline, startScheduler } from "@daymarkable/pipeline";
import { DateTime } from "luxon";
import { getRuntime } from "./runtime";

const g = globalThis as unknown as { __dmSchedulerStarted?: boolean };

export async function bootScheduler(): Promise<void> {
  if (process.env.DAYMARKABLE_SCHEDULER === "0" || g.__dmSchedulerStarted) return;
  g.__dmSchedulerStarted = true;
  const log = (m: string) => console.log(`[scheduler ${new Date().toISOString().slice(11, 19)}] ${m}`);
  try {
    const rt = await getRuntime();
    const user = await ensureDefaultUser(rt);
    const stale = await repo.failStaleRuns(rt.db, 0);
    if (stale) log(`marked ${stale} interrupted run(s) as failed`);
    startScheduler({
      timezone: async () => (await repo.getUser(rt.db, user.id)).timezone,
      lastSatisfied: async () => {
        const last = await rt.db.query.runs.findFirst({ where: and(eq(schema.runs.userId, user.id), eq(schema.runs.status, "succeeded")), orderBy: desc(schema.runs.finishedAt) });
        return { localDate: last?.localDate ?? null, finishedAt: last?.finishedAt ? DateTime.fromJSDate(last.finishedAt) : null };
      },
      runNightly: async (localDate) => {
        const deps = await pipelineDepsFor(rt, user.id, log);
        await runPipeline(deps, { userId: user.id, kind: "nightly", requestedVia: "scheduler", localDate });
      },
      log,
    });
    log("3AM scheduler running inside the web server");
  } catch (err) {
    g.__dmSchedulerStarted = false;
    const cause = (err as { cause?: Error }).cause;
    log(`scheduler not started: ${(err as Error).message}${cause ? ` | cause: ${cause.stack ?? cause.message}` : ""}`);
  }
}
