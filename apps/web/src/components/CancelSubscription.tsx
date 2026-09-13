"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

export interface CancelSubscriptionProps {
  subscriptionId: string | null;
  plan: string | null;
  endsAt: string | null;
  alreadyEnding: boolean;
}

/**
 * Self-serve cancellation (rule 14: the web is the only payment surface).
 *
 * Typed confirmation, because it is irreversible from here — restarting means checking out again.
 * It cancels at the end of the paid period rather than immediately: they paid for the period, so
 * cutting them off early would be taking something they bought.
 */
export function CancelSubscription({ subscriptionId, plan, endsAt, alreadyEnding }: CancelSubscriptionProps) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const armed = typed.trim().toLowerCase() === "cancel";

  if (!subscriptionId) {
    return (
      <p className="muted" style={{ marginBottom: 0 }}>
        There is no active subscription on this account, so there is nothing to cancel.
      </p>
    );
  }

  async function go() {
    setState("working");
    setMessage(null);
    try {
      const r = await trpc.subscription.cancel.mutate();
      setMessage(r.message);
      setState("done");
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(err));
      setState("error");
    }
  }

  if (alreadyEnding || state === "done") {
    return <div className="notice ok" style={{ marginBottom: 0 }}>{message ?? "This subscription is already set to end. You will not be charged again."}</div>;
  }

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>
        Cancelling takes effect at the end of the period you have already paid for
        {endsAt ? <> — {endsAt}</> : null}, so nothing stops early and nothing is charged again. After that the nightly
        runs stop. The notebooks already on your tablet are ordinary reMarkable documents and stay yours.
      </p>
      <div className="field">
        <label htmlFor="cancel-confirm">Type &ldquo;cancel&rdquo; to confirm</label>
        <input id="cancel-confirm" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="cancel" />
      </div>
      <div className="row">
        <button className="danger" onClick={() => void go()} disabled={!armed || state === "working"}>
          {state === "working" ? "Cancelling…" : `Cancel my ${plan ?? ""} subscription`.trim()}
        </button>
        <small className="meta">a prorated refund for unused days is available on request</small>
      </div>
      {message ? <div className="notice bad">{message}</div> : null}
    </div>
  );
}
