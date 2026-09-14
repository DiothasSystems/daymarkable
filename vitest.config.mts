import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // apps/web's own "@/..." alias, so its server modules can be tested by the name they are
  // imported by everywhere else.
  resolve: { alias: { "@/": `${path.resolve(here, "apps/web/src")}/` } },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Four suites boot an in-process Postgres (PGlite WASM) and run every migration in their
    // setup hook. Several starting at once exceeds vitest's 10s hook default, and each new
    // migration makes that likelier.
    hookTimeout: 60_000,
    server: { deps: { inline: ["server-only"] } },
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.live.test.ts"],
  },
});
