/**
 * Dev tool: `pnpm --filter @daymarkable/runner dump <outDir> [--fixture]`
 * Prints the latest run + costs and decrypts that run's generated notebooks from the 1-day
 * cache into outDir. Reads only; never regenerates (rule 12).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Sealer, desc, openDb, schema, sql } from "@daymarkable/db";
import { LocalCacheStore, STATE_DIR } from "@daymarkable/pipeline";

const out = process.argv[2];
if (!out) {
  console.error("usage: dump <outDir> [--fixture]");
  process.exit(1);
}
const fixture = process.argv.includes("--fixture");
const sealer = Sealer.fromEnv();
const h = await openDb(`pglite://${path.join(STATE_DIR, fixture ? "db-fixture" : "db")}`);
const runs = await h.db.query.runs.findMany({ orderBy: desc(schema.runs.createdAt), limit: 5 });
for (const r of runs) {
  const s = r.stats;
  console.log(`run ${r.id.slice(0, 8)} ${r.kind}#${r.seq} ${r.localDate} ${r.status}${s ? ` docs=${s.docsChanged}/${s.docsSeen} pages=${s.pagesDecoded} tasks=${s.tasksFound} meetings=${s.meetingsFound} $${s.costUsd.toFixed(4)} purged=${s.purgedRunId?.slice(0, 8) ?? "-"}` : ""}${r.error ? ` error=${r.error}` : ""}`);
}
const costs = await h.db.select({ model: schema.runCosts.model, mode: schema.runCosts.mode, inTok: sql<number>`sum(${schema.runCosts.inputTokens})`, cr: sql<number>`sum(${schema.runCosts.cacheReadTokens})`, cw: sql<number>`sum(${schema.runCosts.cacheWriteTokens})`, outTok: sql<number>`sum(${schema.runCosts.outputTokens})`, usd: sql<number>`sum(${schema.runCosts.costUsd})`, pages: sql<number>`sum(${schema.runCosts.pages})` }).from(schema.runCosts).groupBy(schema.runCosts.model, schema.runCosts.mode);
for (const c of costs) console.log(`cost ${c.model} [${c.mode}] pages=${c.pages} in=${c.inTok} cache_read=${c.cr} cache_write=${c.cw} out=${c.outTok} $${Number(c.usd).toFixed(4)}`);
const counts = await h.db.select({ status: schema.tasks.status, n: sql<number>`count(*)` }).from(schema.tasks).groupBy(schema.tasks.status);
console.log("tasks", counts.map((c) => `${c.status}=${c.n}`).join(" "));
const latest = runs.find((r) => r.status === "succeeded");
if (latest) {
  const cache = new LocalCacheStore(path.join(STATE_DIR, fixture ? "cache-fixture" : "cache"), sealer);
  await mkdir(out, { recursive: true });
  for (const n of ["Planner", "Action List", "Meeting Notes"]) {
    if (await cache.exists(latest.id, `outputs/${n}.pdf`)) {
      await writeFile(path.join(out, `${n}.pdf`), await cache.get(latest.id, `outputs/${n}.pdf`));
      console.log(`wrote ${n}.pdf`);
    }
  }
}
await h.close();
