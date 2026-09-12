"use client";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

/**
 * The waiting list form.
 *
 * It sends no sign-in link and it answers the same way for every address, whether that address is
 * new, already waiting, already invited, or already has an account. Anything else would turn a
 * public page into a way of asking who has a dayMarkable account.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "done" | "error"; error?: string }>({ status: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "sending" });
    try {
      await trpc.waitlist.join.mutate({ email });
      setState({ status: "done" });
    } catch (err) {
      setState({ status: "error", error: errorMessage(err) });
    }
  }

  if (state.status === "done") {
    return (
      <div className="notice ok">
        You are on the list. We will email <strong>{email}</strong> when there is room, and that message will explain how to sign in.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <div className="hint">The address your meeting notes would be sent to.</div>
      </div>
      {state.status === "error" ? <div className="notice bad">{state.error}</div> : null}
      <button type="submit" className="primary" disabled={state.status === "sending"}>
        {state.status === "sending" ? "Adding…" : "Join the waiting list"}
      </button>
    </form>
  );
}
