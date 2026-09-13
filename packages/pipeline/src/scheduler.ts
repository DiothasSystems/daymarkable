/**
 * Just-after-midnight scheduler (ARCHITECTURE §2, Phase 0 single-user edition).
 *
 * Ticks every 15 minutes, computes the user's local time with Luxon (DST-safe), and runs the
 * nightly pipeline once per local date at or after 00:01 local. A completed on-demand sync for
 * that date satisfies the run (rule 11), so the tick simply skips.
 *
 * 00:01 rather than 03:00 because it makes the promise a whole day instead of a sliding window:
 * everything written today is read tonight, a few minutes after the date turns over. At 03:00 a
 * page written at 10am waited seventeen hours; now the longest wait belongs to the page written
 * a minute after the run, and the evening's notes are read within the hour.
 *
 * A user who flies somewhere else keeps the timezone on their account until they change it, so
 * their run fires at 00:01 where they said they live, not where they are. That is a deliberate
 * non-feature: guessing at location from a tablet sync would be worse, and Sync now covers the
 * trip.
 */
import { DateTime } from "luxon";

export interface ScheduleDecision {
  run: boolean;
  localDate: string;
  reason: string;
}

export interface ScheduleInput {
  nowUtc: DateTime;
  timezone: string;
  /** Local date of the latest succeeded run (nightly or on-demand), or null. */
  lastSatisfiedLocalDate: string | null;
  /** When the last successful run finished (UTC), for the >26h catch-up sweep. */
  lastSuccessAt: DateTime | null;
  /** Local hour to run at. Default 0. */
  runHour?: number;
  /** Minute within that hour. Default 1 — one minute past, not on, the stroke of midnight. */
  runMinute?: number;
}

export function decideRun(input: ScheduleInput): ScheduleDecision {
  const local = input.nowUtc.setZone(input.timezone);
  if (!local.isValid) return { run: false, localDate: "", reason: `invalid timezone ${input.timezone}` };
  const localDate = local.toISODate()!;
  const hour = input.runHour ?? 0;
  const minute = input.runMinute ?? 1;
  const at = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (input.lastSatisfiedLocalDate === localDate) return { run: false, localDate, reason: "already satisfied for this local date" };
  // Minute-of-day, because the run time is no longer on an hour boundary.
  if (local.hour * 60 + local.minute >= hour * 60 + minute) return { run: true, localDate, reason: `${at} local reached` };
  // Catch-up: a missed night (tablet offline, crash) is retried once >26h have passed.
  if (input.lastSuccessAt && input.nowUtc.diff(input.lastSuccessAt, "hours").hours > 26) {
    return { run: true, localDate, reason: "catch-up: last success more than 26h ago" };
  }
  return { run: false, localDate, reason: `before ${at} local` };
}

export interface SchedulerHooks {
  timezone: () => Promise<string>;
  lastSatisfied: () => Promise<{ localDate: string | null; finishedAt: DateTime | null }>;
  runNightly: (localDate: string) => Promise<void>;
  /** Housekeeping to run on every tick, whether or not a run is due (e.g. the credit warning). */
  onTick?: () => Promise<void>;
  log: (msg: string) => void;
}

/** Long-running loop; returns a stop function. */
export function startScheduler(hooks: SchedulerHooks, intervalMs = 15 * 60_000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const tz = await hooks.timezone();
      const last = await hooks.lastSatisfied();
      const d = decideRun({ nowUtc: DateTime.utc(), timezone: tz, lastSatisfiedLocalDate: last.localDate, lastSuccessAt: last.finishedAt });
      hooks.log(`tick tz=${tz} localDate=${d.localDate} run=${d.run} (${d.reason})`);
      if (hooks.onTick) await hooks.onTick();
      if (d.run) await hooks.runNightly(d.localDate);
    } catch (err) {
      hooks.log(`tick failed: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(handle);
}
