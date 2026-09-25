"use client";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

/** Mirrors PASSWORD_MIN in server/password-core.ts, for the hint; the server decides. */
const MIN = 10;

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<{ status: "idle" | "saving" } | { status: "error"; error: string }>({ status: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setState({ status: "error", error: "The two passwords are not the same." });
      return;
    }
    setState({ status: "saving" });
    try {
      const r = await trpc.auth.setPassword.mutate({ token, password });
      if (!r.ok) {
        setState({ status: "error", error: r.message });
        return;
      }
      // A full navigation, not a client route change: the sign-in page decides server-side whether
      // this browser is already signed in (a first password keeps existing sessions).
      window.location.assign("/login?password=set");
    } catch (err) {
      setState({ status: "error", error: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      {/* For password managers: the account the new password belongs to. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" required minLength={MIN} value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="hint">At least {MIN} characters. A few unrelated words make a strong one; symbols are not required.</div>
      </div>
      <div className="field">
        <label htmlFor="confirm-password">The same again</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {state.status === "error" ? <div className="notice bad">{state.error}</div> : null}
      <button type="submit" className="primary" disabled={state.status === "saving"}>
        {state.status === "saving" ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
