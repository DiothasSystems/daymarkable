import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // The pipeline suites boot an in-process Postgres (PGlite WASM) and run every migration in
    // their setup hook. Two of them starting at once on a cold cache exceeds vitest's 10s hook
    // default, and each new migration makes that likelier.
    hookTimeout: 60_000,
    server: { deps: { inline: ["server-only"] } },
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.live.test.ts"],
  },
});
