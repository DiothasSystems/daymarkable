// expo-secure-store talks to a keychain that does not exist in a test process.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => "test-session"),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED: "whenUnlocked",
}));
