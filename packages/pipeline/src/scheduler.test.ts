import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { decideRun } from "./scheduler.js";

const tz = "America/New_York";
const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
/**
 * Build the UTC instant for a wall-clock time in the user's zone. Written this way so the DST
 * cases are correct by construction rather than by me converting offsets in a comment.
 */
const local = (iso: string) => DateTime.fromISO(iso, { zone: tz }).toUTC();

describe("decideRun", () => {
  it("runs once per local date at or after 00:01 local", () => {
    expect(decideRun({ nowUtc: local("2026-09-02T00:00"), timezone: tz, lastSatisfiedLocalDate: "2026-09-01", lastSuccessAt: null }).run).toBe(false);
    const go = decideRun({ nowUtc: local("2026-09-02T00:01"), timezone: tz, lastSatisfiedLocalDate: "2026-09-01", lastSuccessAt: null });
    expect(go.run).toBe(true);
    expect(go.localDate).toBe("2026-09-02");
    expect(go.reason).toContain("00:01");
    // Later the same day the date is satisfied, so nothing runs again.
    expect(decideRun({ nowUtc: local("2026-09-02T12:00"), timezone: tz, lastSatisfiedLocalDate: "2026-09-02", lastSuccessAt: null }).run).toBe(false);
  });

  /**
   * The whole point of moving off 03:00: a page written during the day is read once the date turns
   * over, not seventeen hours later. The 15-minute tick means the first opportunity is 00:15.
   */
  it("fires on the first tick after midnight", () => {
    for (const t of ["2026-09-02T00:15", "2026-09-02T00:30", "2026-09-02T02:00"]) {
      expect(decideRun({ nowUtc: local(t), timezone: tz, lastSatisfiedLocalDate: "2026-09-01", lastSuccessAt: null }).run).toBe(true);
    }
    // 23:59 the night before belongs to the previous date, which is already satisfied.
    const eve = decideRun({ nowUtc: local("2026-09-01T23:59"), timezone: tz, lastSatisfiedLocalDate: "2026-09-01", lastSuccessAt: null });
    expect(eve.run).toBe(false);
    expect(eve.localDate).toBe("2026-09-01");
  });

  it("an on-demand sync that satisfied today skips the night (rule 11)", () => {
    expect(decideRun({ nowUtc: local("2026-09-03T00:05"), timezone: tz, lastSatisfiedLocalDate: "2026-09-03", lastSuccessAt: at("2026-09-03T02:00:00Z") }).run).toBe(false);
  });

  /**
   * 00:01 is safer than 03:00 across a US transition: spring-forward removes the 02:00 hour, which
   * 03:00 sits immediately after, while midnight is untouched at both ends.
   */
  it("is DST-safe on spring-forward (2026-03-08) and fall-back (2026-11-01)", () => {
    expect(decideRun({ nowUtc: local("2026-03-08T00:00"), timezone: tz, lastSatisfiedLocalDate: "2026-03-07", lastSuccessAt: null }).run).toBe(false);
    const spring = decideRun({ nowUtc: local("2026-03-08T00:01"), timezone: tz, lastSatisfiedLocalDate: "2026-03-07", lastSuccessAt: null });
    expect(spring.run).toBe(true);
    expect(spring.localDate).toBe("2026-03-08");

    const fall = decideRun({ nowUtc: local("2026-11-01T00:01"), timezone: tz, lastSatisfiedLocalDate: "2026-10-31", lastSuccessAt: null });
    expect(fall.run).toBe(true);
    expect(fall.localDate).toBe("2026-11-01");
    // Fall-back repeats the 01:00 hour; exactly one run per local date still.
    expect(decideRun({ nowUtc: local("2026-11-01T23:00"), timezone: tz, lastSatisfiedLocalDate: "2026-11-01", lastSuccessAt: null }).run).toBe(false);
  });

  it("catches up after a missed night", () => {
    const d = decideRun({
      nowUtc: local("2026-09-04T00:00"),
      timezone: tz,
      lastSatisfiedLocalDate: "2026-09-02",
      lastSuccessAt: at("2026-09-02T04:30:00Z"),
    });
    expect(d.run).toBe(true);
    expect(d.reason).toMatch(/catch-up/);
  });

  it("honours an overridden run time", () => {
    const input = { timezone: tz, lastSatisfiedLocalDate: "2026-09-01", lastSuccessAt: null, runHour: 3, runMinute: 30 };
    expect(decideRun({ ...input, nowUtc: local("2026-09-02T03:29") }).run).toBe(false);
    const go = decideRun({ ...input, nowUtc: local("2026-09-02T03:30") });
    expect(go.run).toBe(true);
    expect(go.reason).toContain("03:30");
  });

  it("rejects invalid timezones", () => {
    expect(decideRun({ nowUtc: at("2026-09-04T05:00:00Z"), timezone: "Mars/Olympus", lastSatisfiedLocalDate: null, lastSuccessAt: null }).run).toBe(false);
  });
});
