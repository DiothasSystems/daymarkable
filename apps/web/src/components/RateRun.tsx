"use client";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

export function RateRun({ runId, initialRating, initialComment, compact = false }: { runId: string | null; initialRating?: number | null; initialComment?: string | null; compact?: boolean }) {
  const [rating, setRating] = useState<number>(initialRating ?? 0);
  const [comment, setComment] = useState(initialComment ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(r = rating) {
    if (!r) return;
    setState("saving");
    try {
      await trpc.feedback.rate.mutate({ runId, rating: r, comment: comment || null });
      setState("saved");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <div className="stars" role="radiogroup" aria-label="Conversion quality">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} className={n <= rating ? "on" : ""} onClick={() => { setRating(n); if (compact) void save(n); }}>
              ★
            </button>
          ))}
        </div>
        {state === "saved" ? <small className="mono">saved</small> : null}
      </div>
      {!compact ? (
        <>
          <textarea placeholder="What was read well or badly? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="row">
            <button className="small" onClick={() => void save()} disabled={!rating || state === "saving"}>Save rating</button>
            {state === "error" ? <small className="notice bad">{error}</small> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
