"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { QuotaStatus } from "@daymarkable/pipeline";
import { errorMessage, trpc } from "@/lib/trpc";

/** Rule 11 client: the server enforces the quota; this only reflects it and polls the run. */
export function SyncNow({ quota, running }: { quota: QuotaStatus; running: string | null }) {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(running);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!runId) return;
    const t = setInterval(async () => {
      try {
        const r = await trpc.runs.get.query({ runId });
        if (r && r.status !== "running" && r.status !== "queued") {
          setRunId(null);
          setMsg(r.status === "succeeded" ? `Sync finished: ${r.stats?.pagesDecoded ?? 0} pages read, ${r.stats?.tasksFound ?? 0} tasks found.` : `Sync ${r.status}${r.error ? `: ${r.error}` : ""}`);
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [runId, router]);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await trpc.runs.syncNow.mutate({ via: "web" });
      if (r.status === "started") {
        setRunId(r.runId);
        setMsg(`Sync started (${r.quota.remaining} of ${r.quota.limit} left in the next ${r.quota.windowHours}h).`);
      } else if (r.status === "busy") {
        setRunId(r.runId);
        setMsg("A run is already in progress.");
      } else if (r.status === "error") {
        setMsg(r.message);
      }
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const exhausted = quota.remaining <= 0 && !runId;
  return (
    <div className="stack" style={{ alignItems: "flex-end" }}>
      <button className="primary" onClick={go} disabled={busy || !!runId || exhausted} aria-busy={!!runId}>
        {runId ? "Syncing…" : "Sync now"}
      </button>
      <small className="mono">
        {exhausted && quota.nextAvailableAt ? `quota used · next at ${new Date(quota.nextAvailableAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `${quota.remaining} of ${quota.limit} syncs left · rolling ${quota.windowHours}h`}
      </small>
      {msg ? <small style={{ maxWidth: 360, textAlign: "right" }}>{msg}</small> : null}
    </div>
  );
}
