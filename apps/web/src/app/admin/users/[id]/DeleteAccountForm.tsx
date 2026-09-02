"use client";
import { useState } from "react";

/** Typed confirmation (rule 13): the button only arms once the account email is typed exactly. */
export function DeleteAccountForm({ userId, email }: { userId: string; email: string }) {
  const [typed, setTyped] = useState("");
  const armed = typed.trim().toLowerCase() === email;
  return (
    <form action={`/admin/api/users/${userId}/delete`} method="post" className="stack" onSubmit={(e) => { if (!armed || !window.confirm(`Delete ${email} and every file? This cannot be undone.`)) e.preventDefault(); }}>
      <div className="field">
        <label htmlFor="confirm">Type the account email to confirm</label>
        <input id="confirm" name="confirm" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={email} />
      </div>
      <button type="submit" className="danger" disabled={!armed}>Delete account permanently</button>
    </form>
  );
}
