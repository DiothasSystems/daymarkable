import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    server: { deps: { inline: ["server-only"] } },
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.live.test.ts"],
  },
});
