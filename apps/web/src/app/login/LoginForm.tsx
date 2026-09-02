"use client";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" | "error"; devLink?: string; error?: string }>({ status: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "sending" });
    try {
      const r = await trpc.auth.requestLink.mutate({ email });
      setState({ status: "sent", ...(r.devLink ? { devLink: r.devLink } : {}) });
    } catch (err) {
      setState({ status: "error", error: errorMessage(err) });
    }
  }

  if (state.status === "sent") {
    return (
      <div className="stack">
        <div className="notice ok">If that address has a dayMarkable account, a sign-in link is on its way. It expires in 15 minutes.</div>
        {state.devLink ? (
          <div className="notice">
            <strong>Development:</strong> no email provider configured, so here is the link:{" "}
            <a href={state.devLink}>Sign in now</a>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      {state.status === "error" ? <div className="notice bad">{state.error}</div> : null}
      <button type="submit" className="primary" disabled={state.status === "sending"}>
        {state.status === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
