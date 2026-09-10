import { describe, expect, it } from "vitest";
import { parseCloudDate } from "./remarkable.js";

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("parseCloudDate", () => {
  it("reads ISO strings", () => {
    expect(iso(parseCloudDate("2026-09-08T14:30:00.000Z"))).toBe("2026-09-08T14:30:00.000Z");
  });

  it("reads epoch milliseconds", () => {
    expect(iso(parseCloudDate("1788288231187"))).toBe(new Date(1788288231187).toISOString());
  });

  it("reads epoch SECONDS as seconds, not milliseconds", () => {
    // The defect: a 10-digit value read as milliseconds landed in January 1970, which put
    // every newly written page before the change window and skipped it silently.
    const d = parseCloudDate("1788288231");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(iso(d)).toBe(new Date(1788288231 * 1000).toISOString());
  });

  it("agrees with itself across the two numeric forms", () => {
    expect(iso(parseCloudDate("1788288231"))).toBe(iso(parseCloudDate("1788288231000")));
  });

  it("returns null for nothing at all", () => {
    expect(parseCloudDate(undefined)).toBeNull();
    expect(parseCloudDate(null)).toBeNull();
    expect(parseCloudDate("")).toBeNull();
    expect(parseCloudDate("   ")).toBeNull();
  });

  it("returns null rather than an Invalid Date for junk", () => {
    expect(parseCloudDate("not a date")).toBeNull();
    expect(parseCloudDate("0")).toBeNull();
  });
});
