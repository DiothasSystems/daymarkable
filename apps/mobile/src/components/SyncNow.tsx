/**
 * Sync now, from the phone (SW-005).
 *
 * Rule 11 lives on the server: three per rolling 24 hours, counted across web and mobile
 * together, and a completed on-demand sync satisfies the night for that user. This control only
 * reflects that — it must never be the thing enforcing it, which is why an exhausted quota is
 * read off the server's 429 rather than predicted here from `remaining`.
 *
 * A run takes minutes, so the button hands off to a poll rather than pretending to block.
 */
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { errorMessage, trpc } from "@/api";
import { color, space, type } from "@/theme";
import { Button } from "./ui";

type Quota = Awaited<ReturnType<typeof trpc.runs.quota.query>>;

export function SyncNow({ quota, onFinished }: { quota: Quota | null; onFinished(): void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!runId) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const r = await trpc.runs.get.query({ runId });
          if (r && r.status !== "running" && r.status !== "queued") {
            setRunId(null);
            setFailed(r.status !== "succeeded");
            setMessage(
              r.status === "succeeded"
                ? `Read ${r.stats?.pagesDecoded ?? 0} pages — ${r.stats?.tasksFound ?? 0} actions, ${r.stats?.meetingsFound ?? 0} meetings.`
                : `Sync ${r.status}${r.error ? `: ${r.error}` : ""}`,
            );
            onFinished();
          }
        } catch {
          // Keep polling: a dropped request is a phone in a tunnel, not a failed run.
        }
      })();
    }, 4000);
    return () => clearInterval(timer);
  }, [runId, onFinished]);

  const go = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const r = await trpc.runs.syncNow.mutate({ via: "mobile" });
      if (r.status === "started") {
        setRunId(r.runId);
        setMessage(`Reading your tablet. ${r.quota.remaining} of ${r.quota.limit} left today.`);
      } else if (r.status === "busy") {
        setRunId(r.runId);
        setMessage("A run is already going.");
      } else if (r.status === "error") {
        setFailed(true);
        setMessage(r.message);
      }
    } catch (err) {
      // The quota is exhausted (429) or something else went wrong; the server said which.
      setFailed(true);
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const running = !!runId;

  return (
    <View style={{ gap: space.sm }}>
      <Button
        title={running ? "Syncing…" : "Sync now"}
        variant="secondary"
        busy={busy || running}
        onPress={() => void go()}
      />
      {quota ? (
        <Text style={type.label}>
          {`${quota.remaining} OF ${quota.limit} LEFT · ${quota.windowHours}H`}
        </Text>
      ) : null}
      {message ? (
        <Text style={[type.small, { color: failed ? color.bad : color.bodyMuted }]} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </View>
  );
}
