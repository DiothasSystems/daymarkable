/**
 * `pnpm dev:run` — execute a run now.
 *   --live         real tablet, real Claude, real render service (default: fixtures)
 *   --on-demand    on-demand run (standard API) instead of nightly (Batch)
 *   --date D       local date to run for (default: today in the user's timezone)
 *   --force        run even if the date is already satisfied
 *   --no-upload    compose but do not touch the tablet
 *   --window H     look back H hours instead of "previous local day" (bootstrap)
 *   --serve        start the 3AM scheduler loop and keep running
 */
import { ensureDefaultUser, openRuntime, pipelineDepsFor, repo, runPipeline, startScheduler } from "@daymarkable/pipeline";
import { desc, eq, and, schema } from "@daymarkable/db";
import { DateTime } from "luxon";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function log(msg: string): void {
  console.log(`[run ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main(): Promise<void> {
  const live = flag("live");
  const rt = await openRuntime(live ? "live" : "fixture", { log });
  const user = await ensureDefaultUser(rt);
  try {
    if (flag("serve")) {
      const stale = await repo.failStaleRuns(rt.db, 0);
      if (stale) log(`marked ${stale} interrupted run(s) as failed`);
      log("scheduler started (15-minute ticks, 03:00 local)");
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
      await new Promise(() => {}); // run forever
      return;
    }
    const deps = await pipelineDepsFor(rt, user.id, log);
    const windowOpt = opt("window");
    const outcome = await runPipeline(deps, {
      userId: user.id,
      kind: flag("on-demand") ? "on_demand" : "nightly",
      requestedVia: "cli",
      ...(opt("date") ? { localDate: opt("date")! } : {}),
      force: flag("force"),
      upload: !flag("no-upload"),
      ...(windowOpt ? { windowHours: Number(windowOpt) } : {}),
    });
    log(`outcome: ${outcome.status}${outcome.error ? ` — ${outcome.error}` : ""}`);
    if (outcome.status === "failed") process.exitCode = 1;
  } finally {
    if (!flag("serve")) await rt.close();
  }
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exitCode = 1;
});
