"use client";
import Link from "next/link";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";
import type { JoinState } from "@/server/waitlist";

/**
 * The public way in, which today is a waiting list.
 *
 * The part that outlasts the list: an address that already has an account is told so and sent to
 * sign in. Only the third branch below is particular to registration being closed, and it is the
 * one that changes when it opens.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "done" | "error"; joined?: JoinState; error?: string }>({
    status: "idle",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "sending" });
    try {
      const r = await trpc.waitlist.join.mutate({ email });
      setState({ status: "done", joined: r.state });
    } catch (err) {
      setState({ status: "error", error: errorMessage(err) });
    }
  }

  if (state.status === "done") {
    if (state.joined === "has_account") {
      return (
        <div className="notice">
          <p style={{ margin: "0 0 8px" }}>
            <strong>{email}</strong> already has a dayMarkable account.
          </p>
          <p style={{ margin: 0 }}>
            Nothing was added and no email is coming. <Link href="/login">Sign in</Link> to carry on where you left off.
          </p>
        </div>
      );
    }
    if (state.joined === "invited") {
      return (
        <div className="notice ok">
          <p style={{ margin: "0 0 8px" }}>
            <strong>{email}</strong> is already approved.
          </p>
          <p style={{ margin: 0 }}>
            There is nothing to wait for. <Link href="/login">Sign in</Link> to set up your account.
          </p>
        </div>
      );
    }
    return (
      <div className="notice ok">
        You are on the list. We will email <strong>{email}</strong> when there is room, and that message will explain how to sign
        in.
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
