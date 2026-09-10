import { describe, expect, it } from "vitest";
import { parseCloudDate, retryableCloudError, withRetry } from "./remarkable.js";

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

// ---------------------------------------------------------------------------------------------
// The night the cloud answered "Too Many Requests" to an upload, the whole run failed and the
// tablet got no notebooks. A rate limit is a "wait a moment", not a "give up".

const tooMany = () => Object.assign(new Error('failed reMarkable request: {"message":"Too Many Requests"}'), {});

describe("retryableCloudError", () => {
  it("retries rate limits, server errors, hangs and dropped connections", () => {
    expect(retryableCloudError(tooMany())).toBe(true);
    expect(retryableCloudError(Object.assign(new Error("boom"), { status: 429 }))).toBe(true);
    expect(retryableCloudError(Object.assign(new Error("boom"), { status: 503 }))).toBe(true);
    expect(retryableCloudError(new Error("timed out after 120s"))).toBe(true);
    expect(retryableCloudError(new Error("fetch failed"))).toBe(true);
  });

  it("does not retry what a second ask cannot change", () => {
    expect(retryableCloudError(Object.assign(new Error("nope"), { status: 401 }))).toBe(false);
    expect(retryableCloudError(Object.assign(new Error("nope"), { status: 404 }))).toBe(false);
    expect(retryableCloudError(new Error("schema mismatch"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("rides out a burst of rate limits and returns the eventual answer", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw tooMany();
        return "uploaded";
      },
      { attempts: 5, backoffMs: 1 },
    );
    expect(result).toBe("uploaded");
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt and surfaces the cloud's own error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw tooMany();
        },
        { attempts: 3, backoffMs: 1 },
      ),
    ).rejects.toThrow(/Too Many Requests/);
    expect(calls).toBe(3);
  });

  it("does not waste attempts on an error that will not change", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("expired token"), { status: 401 });
        },
        { attempts: 5, backoffMs: 1 },
      ),
    ).rejects.toThrow(/expired token/);
    expect(calls).toBe(1);
  });

  it("times out a call that never answers, then retries it", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls === 1) return new Promise<string>(() => {});
        return "second time lucky";
      },
      { attempts: 3, backoffMs: 1, timeoutMs: 20 },
    );
    expect(result).toBe("second time lucky");
    expect(calls).toBe(2);
  });
});
