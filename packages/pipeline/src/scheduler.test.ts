import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { decideRun } from "./scheduler.js";

const tz = "America/New_York";
const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

describe("decideRun", () => {
  it("runs once per local date at or after 03:00 local", () => {
    // 06:59 UTC = 02:59 EDT -> wait; 07:00 UTC = 03:00 EDT -> run; later same day -> satisfied.
    expect(decideRun({ nowUtc: at("2026-09-02T06:59:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-09-01", lastSuccessAt: null }).run).toBe(false);
    const go = decideRun({ nowUtc: at("2026-09-02T07:00:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-09-01", lastSuccessAt: null });
    expect(go.run).toBe(true);
    expect(go.localDate).toBe("2026-09-02");
    expect(decideRun({ nowUtc: at("2026-09-02T12:00:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-09-02", lastSuccessAt: null }).run).toBe(false);
  });

  it("an on-demand sync that satisfied today skips the night (rule 11)", () => {
    expect(decideRun({ nowUtc: at("2026-09-03T07:05:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-09-03", lastSuccessAt: at("2026-09-03T02:00:00Z") }).run).toBe(false);
  });

  it("is DST-safe on spring-forward (2026-03-08) and fall-back (2026-11-01)", () => {
    // Spring forward: 03:00 EDT = 07:00 UTC (the 02:00 hour does not exist).
    expect(decideRun({ nowUtc: at("2026-03-08T06:59:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-03-07", lastSuccessAt: null }).run).toBe(false);
    expect(decideRun({ nowUtc: at("2026-03-08T07:00:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-03-07", lastSuccessAt: null }).run).toBe(true);
    // Fall back: 03:00 EST = 08:00 UTC; 07:00 UTC is 02:00 EST (second 1-2AM hour already passed).
    expect(decideRun({ nowUtc: at("2026-11-01T07:00:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-10-31", lastSuccessAt: null }).run).toBe(false);
    const d = decideRun({ nowUtc: at("2026-11-01T08:00:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-10-31", lastSuccessAt: null });
    expect(d.run).toBe(true);
    expect(d.localDate).toBe("2026-11-01");
    // Exactly one run per local date across the transition.
    expect(decideRun({ nowUtc: at("2026-11-01T23:00:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-11-01", lastSuccessAt: null }).run).toBe(false);
  });

  it("catches up after a missed night", () => {
    const d = decideRun({ nowUtc: at("2026-09-04T05:00:00Z"), timezone: tz, lastSatisfiedLocalDate: "2026-09-02", lastSuccessAt: at("2026-09-02T07:30:00Z") });
    expect(d.run).toBe(true);
    expect(d.reason).toMatch(/catch-up/);
  });

  it("rejects invalid timezones", () => {
    expect(decideRun({ nowUtc: at("2026-09-04T05:00:00Z"), timezone: "Mars/Olympus", lastSatisfiedLocalDate: null, lastSuccessAt: null }).run).toBe(false);
  });
});
