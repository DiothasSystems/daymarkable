import "server-only";
import { openRuntime, type Runtime } from "@daymarkable/pipeline";

/** One runtime per server process (PGlite must be opened once). Survives Next's dev HMR via globalThis. */
const g = globalThis as unknown as { __dmRuntime?: Promise<Runtime> };

export function getRuntime(): Promise<Runtime> {
  if (!g.__dmRuntime) {
    const mode = process.env.DAYMARKABLE_MODE === "fixture" ? "fixture" : "live";
    g.__dmRuntime = openRuntime(mode, { log: (m) => console.log(`[web ${new Date().toISOString().slice(11, 19)}] ${m}`) });
    // A failed open (e.g. another process still holding the embedded DB) must not poison the process.
    g.__dmRuntime.catch(() => {
      delete g.__dmRuntime;
    });
  }
  return g.__dmRuntime;
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
