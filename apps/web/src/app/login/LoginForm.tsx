"use client";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

type Mode = "signin" | "reset";
type State =
  | { status: "idle" | "sending" }
  | { status: "sent"; devLink?: string }
  | { status: "reset-sent"; devLink?: string }
  | { status: "error"; error: string };

/**
 * Two forms in one card: sign in (address + password → a link to finish), and set or reset a
 * password (address → a link to choose one). The second is where a first-time customer starts,
 * because nobody has a password until they set one.
 *
 * The wrong-password message is the same for every way of being wrong (server/sign-in.ts), so it
 * has to point at the reset form rather than guess which way it was.
 */
export function LoginForm({ initialMode = "signin" }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "sending" });
    try {
      const r = await trpc.auth.requestLink.mutate({ email, password });
      if (r.ok) {
        setState({ status: "sent", ...(r.devLink ? { devLink: r.devLink } : {}) });
        return;
      }
      setPassword("");
      setState({
        status: "error",
        error:
          r.reason === "locked"
            ? `Too many wrong passwords for this address. Try again in ${r.retryAfterMinutes} minute${r.retryAfterMinutes === 1 ? "" : "s"}, or set a new password below.`
            : "That email and password do not match. If you have not set a password yet, or have forgotten it, set one below.",
      });
    } catch (err) {
      setState({ status: "error", error: errorMessage(err) });
    }
  }

  async function sendResetLink(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "sending" });
    try {
      const r = await trpc.auth.requestPasswordLink.mutate({ email });
      setState({ status: "reset-sent", ...(r.devLink ? { devLink: r.devLink } : {}) });
    } catch (err) {
      setState({ status: "error", error: errorMessage(err) });
    }
  }

  function switchTo(next: Mode) {
    setMode(next);
    setPassword("");
    setState({ status: "idle" });
  }

  if (state.status === "sent") {
    return (
      <div className="stack">
        <div className="notice ok">
          Password accepted. We have emailed a link to <strong>{email.trim()}</strong> to finish signing in. It works once and
          expires in 15 minutes.
        </div>
        <DevLink link={state.devLink} label="Finish signing in" />
      </div>
    );
  }

  if (state.status === "reset-sent") {
    return (
      <div className="stack">
        <div className="notice ok">
          If that address can sign in, a link to set your password is on its way. It expires in 30 minutes. After you choose
          one, come back here and sign in with it.
        </div>
        <DevLink link={state.devLink} label="Set the password" />
        <button type="button" className="tertiary" onClick={() => switchTo("signin")}>
          Back to sign in
        </button>
      </div>
    );
  }

  const sending = state.status === "sending";
  const error = state.status === "error" ? <div className="notice bad">{state.error}</div> : null;

  if (mode === "reset") {
    return (
      <form onSubmit={sendResetLink} className="stack">
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          First time here, or forgotten your password? We will email you a link to choose one.
        </p>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        {error}
        <button type="submit" className="primary" disabled={sending}>
          {sending ? "Sending…" : "Email me a link to set my password"}
        </button>
        <button type="button" className="tertiary" onClick={() => switchTo("signin")}>
          I have a password — sign in
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={signIn} className="stack">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error}
      <button type="submit" className="primary" disabled={sending}>
        {sending ? "Checking…" : "Sign in"}
      </button>
      <button type="button" className="tertiary" onClick={() => switchTo("reset")}>
        First time, or forgot your password? Set one
      </button>
    </form>
  );
}

/** Development only: no email provider, so the server hands the link back instead. */
function DevLink({ link, label }: { link?: string; label: string }) {
  if (!link) return null;
  return (
    <div className="notice">
      <strong>Development:</strong> no email provider configured, so here is the link: <a href={link}>{label}</a>
    </div>
  );
}
