"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminLoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true, error: null });
    const res = await fetch("/admin/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loginId, password }) });
    if (res.ok) {
      router.push("/admin");
      router.refresh();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    setState({ busy: false, error: body.message ?? `Sign-in failed (${res.status})` });
    setPassword("");
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="field">
        <label htmlFor="admin-id">Login id</label>
        <input id="admin-id" type="text" autoComplete="username" required value={loginId} onChange={(e) => setLoginId(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="admin-pw">Password</label>
        <input id="admin-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ font: "inherit", padding: "10px 12px", borderRadius: 4, border: "1px solid var(--border-strong)", width: "100%", minHeight: 42 }} />
      </div>
      {state.error ? <div className="notice bad">{state.error}</div> : null}
      <button type="submit" className="primary" disabled={state.busy}>{state.busy ? "Checking…" : "Sign in"}</button>
    </form>
  );
}
