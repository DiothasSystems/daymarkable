"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

/**
 * Click-to-fix text for a decoded item. The correction replaces the item and the words that
 * changed are promoted into the writer's vocabulary, so the same misread does not recur.
 */
export function EditableItem({ itemType, itemId, text, className }: { itemType: "task" | "event" | "meeting" | "inbox"; itemId: string; text: string; className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [saved, setSaved] = useState(text);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [learned, setLearned] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const next = value.trim();
    if (!next || next === saved) {
      setValue(saved);
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await trpc.corrections.fix.mutate({ itemType, itemId, text: next });
      setSaved(next);
      setEditing(false);
      setLearned(r.learned.length ? r.learned : null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setValue(saved);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className={className}>
        <button
          type="button"
          className="tertiary"
          style={{ padding: 0, minHeight: 0, textDecoration: "none", color: "inherit", fontWeight: "inherit", textAlign: "left", display: "inline" }}
          title="Click to fix what dayMarkable read"
          onClick={() => setEditing(true)}
        >
          {saved}
        </button>
        {learned ? <span className="meta"> · learned {learned.join(", ")}</span> : null}
        {error ? <span className="meta" style={{ color: "var(--bad)" }}> · {error}</span> : null}
      </span>
    );
  }

  return (
    <span className={className} style={{ display: "block" }}>
      <textarea
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") {
            setValue(saved);
            setEditing(false);
          }
        }}
        style={{ minHeight: 60, fontSize: 14 }}
      />
      <span className="row" style={{ marginTop: 6 }}>
        <button className="small" onClick={() => void commit()} disabled={busy}>{busy ? "Saving…" : "Fix it"}</button>
        <button className="small secondary" onClick={() => { setValue(saved); setEditing(false); }} disabled={busy}>Cancel</button>
        <small className="meta">Enter to save · Esc to cancel</small>
      </span>
    </span>
  );
}
