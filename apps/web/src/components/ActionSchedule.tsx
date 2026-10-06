"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

type Priority = "high" | "normal" | "low";

/** What a stored priority is called on screen: "normal" is Medium (core PRIORITY_LABELS). */
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Medium" },
  { value: "high", label: "High" },
];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function short(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function tagFor(due: string, today: string): string {
  if (due < today) return `Late · ${short(due)}`;
  if (due === today) return "Today";
  if (due === addDays(today, 1)) return "Tomorrow";
  return short(due);
}

/** How a stored date is shown in the box: the way it would be typed, month first. */
function typed(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

const chip = (on: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  minHeight: 28,
  borderRadius: 14,
  fontSize: 13,
  border: `1px solid ${on ? "var(--midnight)" : "var(--border-strong)"}`,
  background: on ? "var(--midnight)" : "var(--notepaper)",
  color: on ? "var(--parchment)" : "var(--midnight)",
  cursor: "pointer",
});

/**
 * Give an action a priority or a due date — the website's version of the tablet's L / M / H boxes and
 * DUE line. The date is TYPED, as it is written on the tablet: "10/14", "Oct 14", "fri", "tomorrow".
 * The server reads it (core parseTypedDate) in the account's timezone, so the website and the app
 * cannot disagree, and says so when it cannot. It opens from the row's summary button (the due date,
 * or "No date"); emptying the box erases the date.
 */
export function ActionSchedule({ itemId, due, priority, today }: { itemId: string; due: string | null; priority: Priority; today: string }) {
  const router = useRouter();
  // Closed until asked: with Medium as the default, most actions have no date, and the controls
  // open on every one of them crowded the list. The summary button says what is set.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(due ? typed(due) : "");
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { dueText?: string; priority?: Priority }) {
    setBusy(true);
    setError(null);
    try {
      await trpc.items.update.mutate({ itemType: "task", itemId, patch });
      router.refresh();
      if (patch.dueText !== undefined) setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const submitDate = () => {
    const next = text.trim();
    if (next === (due ? typed(due) : "")) return;
    void save({ dueText: next });
  };

  if (!open) {
    return (
      <span className="row" style={{ gap: 8, marginTop: 4 }}>
        <button type="button" className="small secondary" style={{ minHeight: 28, padding: "2px 10px" }} onClick={() => setOpen(true)} aria-label="Change due date or priority">
          {due ? tagFor(due, today) : "No date"}
        </button>
        {priority !== "normal" ? <span className="meta" style={{ color: "var(--gold-text)" }}>{priority === "high" ? "HIGH" : "LOW"}</span> : null}
      </span>
    );
  }

  return (
    <span style={{ display: "block", marginTop: 8, opacity: busy ? 0.6 : 1 }}>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span className="meta" style={{ marginRight: 2 }}>Priority</span>
        {PRIORITIES.map((p) => (
          <button key={p.value} type="button" disabled={busy} style={chip(priority === p.value)} aria-pressed={priority === p.value} onClick={() => priority !== p.value && void save({ priority: p.value })}>
            {p.label}
          </button>
        ))}
        <label className="meta" style={{ margin: "0 2px 0 12px" }} htmlFor={`due-${itemId}`}>Due</label>
        <input
          id={`due-${itemId}`}
          type="text"
          inputMode="text"
          autoComplete="off"
          value={text}
          placeholder="10/14, Oct 14, Fri"
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onBlur={submitDate}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitDate();
            }
            if (e.key === "Escape") setText(due ? typed(due) : "");
          }}
          style={{ width: 150, minHeight: 30, fontSize: 14, padding: "3px 8px" }}
          aria-label="Due date"
        />
        <button type="button" className="tertiary small" style={{ marginLeft: 4 }} onClick={() => setOpen(false)}>Done</button>
      </span>
      {error ? <span className="meta" style={{ display: "block", color: "var(--bad, #a32d2d)", marginTop: 4 }}>{error}</span> : null}
    </span>
  );
}
