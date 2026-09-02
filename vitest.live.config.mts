import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.live.test.ts", "apps/**/*.live.test.ts"],
    testTimeout: 300_000,
  },
});
