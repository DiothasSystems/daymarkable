"use client";
import { useEffect, useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";

const KINDS = [
  { id: "feature", label: "A feature" },
  { id: "document_format", label: "A page layout or document format" },
  { id: "bug", label: "Something that is broken" },
  { id: "other", label: "Something else" },
] as const;

const STATUS: Record<string, string> = { new: "received", planned: "planned", shipped: "shipped", declined: "not planned" };

type Mine = { id: string; kind: string; body: string; status: string; createdAt: string | Date };

/**
 * Reaches the operator directly. Requests are stored verbatim rather than summarized, because the
 * point of reading them is the wording — "a week on one page with the actions down the side" is a
 * layout, and paraphrasing it loses the layout.
 */
export function FeatureRequestForm() {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("feature");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);

  async function load() {
    try {
      setMine((await trpc.requests.mine.query()) as Mine[]);
    } catch {
      /* the form still works if the list cannot be fetched */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function send() {
    setState("sending");
    setMessage(null);
    try {
      await trpc.requests.submit.mutate({ kind, body });
      setBody("");
      setState("sent");
      setMessage("Sent. We read every one.");
      await load();
    } catch (err) {
      setMessage(errorMessage(err));
      setState("error");
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="field">
        <label htmlFor="req-kind">What kind of request</label>
        <select id="req-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="req-body">What would you like</label>
        <textarea
          id="req-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ minHeight: 130 }}
          placeholder="The more specific the better: what should be on the page, and what are you doing with it?"
        />
        <div className="hint">{body.trim().length} characters · nothing from your notes is attached, only what you type here</div>
      </div>
      <div className="row">
        <button onClick={() => void send()} disabled={state === "sending" || body.trim().length < 10}>
          {state === "sending" ? "Sending…" : "Send request"}
        </button>
        {message ? <small className={state === "error" ? "" : "mono"} style={state === "error" ? { color: "#8a2b2b" } : undefined}>{message}</small> : null}
      </div>

      {mine.length ? (
        <>
          <p className="kicker" style={{ marginTop: 18 }}>What you have sent</p>
          <ul className="list">
            {mine.map((r) => (
              <li key={r.id}>
                <span className="badge">{STATUS[r.status] ?? r.status}</span>
                <span>{r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
