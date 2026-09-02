/**
 * 3AM local scheduler (ARCHITECTURE §2, Phase 0 single-user edition).
 * Ticks every 15 minutes, computes the user's local time with Luxon (DST-safe), and runs the
 * nightly pipeline once per local date at or after 03:00 local. A completed on-demand sync
 * for that date satisfies the run (rule 11), so the tick simply skips.
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
  runHour?: number;
}

export function decideRun(input: ScheduleInput): ScheduleDecision {
  const local = input.nowUtc.setZone(input.timezone);
  if (!local.isValid) return { run: false, localDate: "", reason: `invalid timezone ${input.timezone}` };
  const localDate = local.toISODate()!;
  const hour = input.runHour ?? 3;
  if (input.lastSatisfiedLocalDate === localDate) return { run: false, localDate, reason: "already satisfied for this local date" };
  if (local.hour >= hour) return { run: true, localDate, reason: `${String(hour).padStart(2, "0")}:00 local reached` };
  // Catch-up: a missed night (tablet offline, crash) is retried once >26h have passed.
  if (input.lastSuccessAt && input.nowUtc.diff(input.lastSuccessAt, "hours").hours > 26) {
    return { run: true, localDate, reason: "catch-up: last success more than 26h ago" };
  }
  return { run: false, localDate, reason: "before run hour" };
}

export interface SchedulerHooks {
  timezone: () => Promise<string>;
  lastSatisfied: () => Promise<{ localDate: string | null; finishedAt: DateTime | null }>;
  runNightly: (localDate: string) => Promise<void>;
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
