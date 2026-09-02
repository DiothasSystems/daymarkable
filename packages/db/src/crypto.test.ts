import { describe, expect, it } from "vitest";
import { Sealer, generateKey, parseKey } from "./crypto.js";

describe("Sealer", () => {
  it("round-trips text, JSON, and bytes", () => {
    const s = new Sealer(parseKey(generateKey()));
    expect(s.open(s.seal("device-token"))).toBe("device-token");
    expect(s.openJson(s.sealJson({ a: [1, 2] }))).toEqual({ a: [1, 2] });
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect([...s.openBytes(s.sealBytes(bytes))]).toEqual([1, 2, 3, 250]);
  });
  it("rejects tampering and wrong keys", () => {
    const s = new Sealer(parseKey(generateKey()));
    const sealed = Buffer.from(s.seal("hello"), "base64");
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 1;
    expect(() => s.open(sealed.toString("base64"))).toThrow();
    const other = new Sealer(parseKey(generateKey()));
    expect(() => other.open(s.seal("hello"))).toThrow();
  });
  it("validates key material", () => {
    expect(() => parseKey("short")).toThrow();
    expect(parseKey("a".repeat(64)).length).toBe(32);
  });
});
