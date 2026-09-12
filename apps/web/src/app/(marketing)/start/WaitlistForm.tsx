"use client";
import Link from "next/link";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

/**
 * The waiting list form.
 *
 * It sends no mail and answers identically for every address, whether that address is new,
 * already waiting, already invited, or already has an account. Anything else would turn a public
 * page into a way of asking whether any given person is a customer.
 *
 * Which is why the reply carries both outcomes rather than the one that applies. Saying only
 * "we will write when there is room" leaves somebody who already has an account waiting for a
 * message that is never coming, so the reply names the other case and points at the sign-in page.
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
        <p style={{ margin: "0 0 8px" }}>Thanks. We have <strong>{email}</strong>.</p>
        <p style={{ margin: 0 }}>
          If that address already has a dayMarkable account, <Link href="/login">sign in</Link> instead and nothing further will be
          sent to it. Otherwise you are on the list, and we will write when there is room.
        </p>
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
