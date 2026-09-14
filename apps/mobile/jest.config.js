/**
 * React Native trees cannot be rendered by the repo's vitest: they need the preset's transforms
 * for the RN and Expo packages. jest-expo is the supported path, so this app has a second runner
 * and the root `pnpm test` calls it after vitest.
 *
 * The pure modules (theme, format) stay on vitest with everything else — they are plain
 * TypeScript and do not need any of this.
 */
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
};
