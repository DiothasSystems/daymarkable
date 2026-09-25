"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Two steps when ADMIN_2FA_EMAIL is set (server/admin-2fa.ts): the password, then the six-digit
 * code it mails. The code step belongs to this browser — the server tied it to a cookie set here —
 * so there is no link to click from the mail, only a code to type back.
 */
export function AdminLoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<{ step: "password" } | { step: "code"; sentTo: string }>({ step: "password" });
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  function enter() {
    router.push("/admin");
    router.refresh();
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true, error: null });
    const res = await fetch("/admin/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loginId, password }) });
    const body = (await res.json().catch(() => ({}))) as { message?: string; needsCode?: boolean; sentTo?: string };
    setPassword("");
    if (!res.ok) {
      setState({ busy: false, error: body.message ?? `Sign-in failed (${res.status})` });
      return;
    }
    if (body.needsCode) {
      setStage({ step: "code", sentTo: body.sentTo ?? "the admin address" });
      setState({ busy: false, error: null });
      return;
    }
    enter();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true, error: null });
    const res = await fetch("/admin/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    if (res.ok) {
      enter();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string; restart?: boolean };
    setCode("");
    if (body.restart) setStage({ step: "password" });
    setState({ busy: false, error: body.message ?? `Verification failed (${res.status})` });
  }

  if (stage.step === "code") {
    return (
      <form onSubmit={submitCode} className="stack">
        <div className="notice ok">Password accepted. A six-digit code is on its way to {stage.sentTo}. It lasts 10 minutes.</div>
        <div className="field">
          <label htmlFor="admin-code">Code</label>
          <input
            id="admin-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            style={{ letterSpacing: "0.3em", fontFamily: "var(--font-mono)", fontSize: 20 }}
          />
        </div>
        {state.error ? <div className="notice bad">{state.error}</div> : null}
        <button type="submit" className="primary" disabled={state.busy || code.length !== 6}>
          {state.busy ? "Checking…" : "Verify"}
        </button>
        <button type="button" className="tertiary" onClick={() => { setStage({ step: "password" }); setCode(""); setState({ busy: false, error: null }); }}>
          Start again
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="stack">
      <div className="field">
        <label htmlFor="admin-id">Login id</label>
        <input id="admin-id" type="text" autoComplete="username" required value={loginId} onChange={(e) => setLoginId(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="admin-pw">Password</label>
        <input id="admin-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {state.error ? <div className="notice bad">{state.error}</div> : null}
      <button type="submit" className="primary" disabled={state.busy}>{state.busy ? "Checking…" : "Sign in"}</button>
    </form>
  );
}
