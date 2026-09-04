"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

/**
 * Push the current lists to the tablet without a sync. Corrections change the stored data but
 * not the PDFs already on the device; this rebuilds and uploads them. No model calls, so it
 * costs nothing and does not touch the on-demand sync quota.
 */
export function Republish() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function go() {
    setState("working");
    setMessage(null);
    try {
      const r = await trpc.documents.republish.mutate();
      setMessage(`Sent ${r.uploaded.join(", ")} to the tablet — ${r.openActions} open actions, ${r.meetings} meetings. Sync the reMarkable to see them.`);
      setState("done");
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(err));
      setState("error");
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button className="secondary small" onClick={() => void go()} disabled={state === "working"}>
          {state === "working" ? "Sending…" : "Send updated notebooks to tablet"}
        </button>
        <small className="meta">rebuilds from your corrections · no sync, no cost</small>
      </div>
      {message ? <div className={`notice${state === "error" ? " bad" : " ok"}`}>{message}</div> : null}
    </div>
  );
}
