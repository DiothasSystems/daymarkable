/**
 * The password primitives: what is stored, what matches, and when the door stops answering.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_FAILURES_PER_EMAIL,
  MAX_FAILURES_PER_IP,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SIGN_IN_WINDOW_MS,
  dummyHash,
  hashPassword,
  signInLocked,
  validateNewPassword,
  verifyPassword,
  type SignInAttemptRow,
} from "./password-core";

describe("hashing", () => {
  it("stores the parameters and a salt, never the password", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$15\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(h).not.toContain("correct horse");
    // A fresh salt every time, so two accounts with one password do not share a hash.
    expect(await hashPassword("correct horse battery")).not.toBe(h);
  });

  it("matches the right password and nothing else", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batterY", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  /**
   * The reason this is not bcrypt: bcrypt reads only the first 72 bytes, so two long passphrases
   * that agree on those would both open the account.
   */
  it("uses every character of a long passphrase", async () => {
    const stem = "a".repeat(80);
    const h = await hashPassword(`${stem}-one`);
    expect(await verifyPassword(`${stem}-two`, h)).toBe(false);
    expect(await verifyPassword(`${stem}-one`, h)).toBe(true);
  });

  /** The same accented password from a phone and a laptop can arrive as different code points. */
  it("treats the two ways of writing an accented letter as one password", async () => {
    const composed = "café au lait 42";
    const decomposed = "café au lait 42";
    const h = await hashPassword(composed);
    expect(await verifyPassword(decomposed, h)).toBe(true);
  });

  it("reads a malformed or tampered hash as a wrong password, never an error", async () => {
    for (const bad of ["", "plaintext", "scrypt$15$8$3$abc", "bcrypt$15$8$3$c2FsdHNhbHQ=$a2V5", "scrypt$30$8$3$c2FsdHNhbHQ=$" + "a".repeat(64)]) {
      await expect(verifyPassword("anything", bad)).resolves.toBe(false);
    }
  });

  it("has a dummy hash that no password opens", async () => {
    const d = await dummyHash();
    expect(await verifyPassword("", d)).toBe(false);
    expect(await verifyPassword("password123", d)).toBe(false);
    expect(await dummyHash()).toBe(d); // made once
  });
});

describe("what counts as a new password", () => {
  it("wants length, not symbols", () => {
    expect(validateNewPassword("a".repeat(PASSWORD_MIN - 1), "x@y.z").ok).toBe(false);
    expect(validateNewPassword("a".repeat(PASSWORD_MIN), "x@y.z").ok).toBe(true);
    expect(validateNewPassword("all lowercase words here", "x@y.z").ok).toBe(true);
    expect(validateNewPassword("a".repeat(PASSWORD_MAX + 1), "x@y.z").ok).toBe(false);
  });

  it("refuses the email address and a password of spaces", () => {
    expect(validateNewPassword("Jim@Example.com", "jim@example.com").ok).toBe(false);
    expect(validateNewPassword(" ".repeat(PASSWORD_MIN), "x@y.z").ok).toBe(false);
  });
});

describe("the lockout", () => {
  const NOW = 1_800_000_000_000;
  const fail = (email: string, ip: string, agoMs = 1000): SignInAttemptRow => ({ email, ip, success: false, createdAt: new Date(NOW - agoMs) });

  it("locks an address after its share of wrong passwords, from any IPs", () => {
    const rows = Array.from({ length: MAX_FAILURES_PER_EMAIL }, (_, i) => fail("a@b.c", `10.0.0.${i}`));
    expect(signInLocked(rows, "a@b.c", "192.168.1.1", NOW).locked).toBe(true);
    expect(signInLocked(rows.slice(1), "a@b.c", "192.168.1.1", NOW).locked).toBe(false);
    // Another address is unaffected.
    expect(signInLocked(rows, "other@b.c", "192.168.1.1", NOW).locked).toBe(false);
  });

  it("locks an IP that tries many addresses", () => {
    const rows = Array.from({ length: MAX_FAILURES_PER_IP }, (_, i) => fail(`user${i}@b.c`, "6.6.6.6"));
    expect(signInLocked(rows, "fresh@b.c", "6.6.6.6", NOW).locked).toBe(true);
    expect(signInLocked(rows, "fresh@b.c", "7.7.7.7", NOW).locked).toBe(false);
  });

  it("forgets failures older than the window, and says how long is left", () => {
    const old = Array.from({ length: MAX_FAILURES_PER_EMAIL }, () => fail("a@b.c", "1.1.1.1", SIGN_IN_WINDOW_MS + 1));
    expect(signInLocked(old, "a@b.c", "1.1.1.1", NOW).locked).toBe(false);
    const recent = Array.from({ length: MAX_FAILURES_PER_EMAIL }, () => fail("a@b.c", "1.1.1.1", 60_000));
    const lock = signInLocked(recent, "a@b.c", "1.1.1.1", NOW);
    expect(lock.retryAfterMs).toBe(SIGN_IN_WINDOW_MS - 60_000);
  });

  it("does not count successes against anyone", () => {
    const rows = Array.from({ length: 50 }, () => ({ ...fail("a@b.c", "1.1.1.1"), success: true }));
    expect(signInLocked(rows, "a@b.c", "1.1.1.1", NOW).locked).toBe(false);
  });
});
