"use client";
import { useState } from "react";
import { errorMessage, trpc } from "@/lib/trpc";
import type { getCalibration } from "@/server/services";

type Calibration = Awaited<ReturnType<typeof getCalibration>>;

/**
 * Handwriting calibration. Claude's vision models cannot be fine-tuned, so "training" here is
 * context: a passage in the writer's own vocabulary, copied out by hand, becomes a few-shot
 * example of their letterforms that rides in every decode.
 */
export function CalibrationPanel({ initial, onDone, compact = false }: { initial: Calibration; onDone?: () => void; compact?: boolean }) {
  const [cal, setCal] = useState(initial);
  const [role, setRole] = useState(initial.profile?.role ?? "");
  const [industry, setIndustry] = useState(initial.profile?.industry ?? "");
  const [context, setContext] = useState(initial.profile?.context ?? "");
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function generate() {
    setState("working");
    setError(null);
    setNote(null);
    try {
      const r = await trpc.calibration.create.mutate({ role, industry, context });
      setNote(`Sheet sent to your tablet as "${r.notebookName}"${r.lexiconAdded ? `, and ${r.lexiconAdded} terms added to your vocabulary` : ""}.`);
      setCal(await trpc.calibration.get.query());
      setState("idle");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  async function calibrate() {
    setState("working");
    setError(null);
    setNote(null);
    try {
      const r = await trpc.calibration.calibrate.mutate();
      if (!r.ok) {
        setError(r.message);
        setState("idle");
        return;
      }
      setNote(r.firstRunId ? `${r.message} Reading your last 7 days now — the lists appear on Today in a few minutes.` : r.message);
      setCal(await trpc.calibration.get.query());
      setState("idle");
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  async function skip() {
    setState("working");
    try {
      await trpc.calibration.skip.mutate();
      setCal(await trpc.calibration.get.query());
      setState("idle");
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  if (cal.captured) {
    const pct = Math.round((cal.captured.accuracy ?? 0) * 100);
    return (
      <div className="stack">
        <div className="notice ok">
          Handwriting sample captured{cal.captured.capturedAt ? ` on ${new Date(cal.captured.capturedAt).toLocaleDateString()}` : ""}. The decoder read back <strong>{pct}%</strong> of the passage, and now carries an image of your handwriting in every request.
        </div>
        <details>
          <summary className="kicker" style={{ cursor: "pointer" }}>What it read versus what you copied</summary>
          <div className="grid two" style={{ marginTop: 12 }}>
            <div><p className="kicker">You copied</p><pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{cal.captured.expectedText}</pre></div>
            <div><p className="kicker">It read</p><pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{cal.captured.transcribedText}</pre></div>
          </div>
        </details>
        <button className="secondary small" onClick={() => setCal({ ...cal, captured: null })}>Write a new sample</button>
      </div>
    );
  }

  if (cal.active?.status === "pending") {
    return (
      <div className="stack">
        <div className="notice">
          <strong>The sheet is on your tablet.</strong> Sync the reMarkable, open <strong>{cal.active.notebookName}</strong> in the dayMarkable folder, and copy the printed lines onto the ruled lines beneath them in your normal hand. Sync again, then press Calibrate below.
        </div>
        <details>
          <summary className="kicker" style={{ cursor: "pointer" }}>The passage you were given</summary>
          <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{cal.active.expectedText}</pre>
        </details>
        {note ? <div className="notice ok">{note}</div> : null}
        {error ? <div className="notice bad">{error}</div> : null}
        <div className="row">
          <button className="primary" onClick={() => void calibrate()} disabled={state === "working"}>
            {state === "working" ? "Reading your handwriting…" : "I have written it — calibrate"}
          </button>
          <button className="secondary small" onClick={() => void generate()} disabled={state === "working"}>Different passage</button>
          <button className="tertiary small" onClick={() => void skip()} disabled={state === "working"}>Skip calibration</button>
        </div>
        <small className="meta">Calibrating reads just that one page, then starts your first extraction of the last 7 days.</small>
      </div>
    );
  }

  return (
    <div className="stack">
      {!compact ? (
        <p className="muted" style={{ fontSize: 14 }}>
          dayMarkable reads your handwriting far better when it has seen a sample of it. Tell us what you do, and we write a short passage using the words, names and symbols from your own field. You copy it out once on the tablet, press Calibrate, and from then on every page is read against that sample.
        </p>
      ) : null}
      <div className="grid two">
        <div className="field">
          <label htmlFor="cal-role">Your role</label>
          <input id="cal-role" type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. VP of Product" />
        </div>
        <div className="field">
          <label htmlFor="cal-industry">Industry or field</label>
          <input id="cal-industry" type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. broadband / telecom hardware" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cal-context">Anything else worth knowing (optional)</label>
        <textarea id="cal-context" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Customers, products and colleagues whose names come up often: Plume, Optum, TR-369, Priya…" />
        <div className="hint">Names you list here go straight into your vocabulary list, which is the single biggest accuracy improvement available.</div>
      </div>
      {note ? <div className="notice ok">{note}</div> : null}
      {error ? <div className="notice bad">{error}</div> : null}
      <div className="row">
        <button className="primary" onClick={() => void generate()} disabled={state === "working" || (!role.trim() && !industry.trim())}>
          {state === "working" ? "Writing your passage…" : "Send a sample sheet to my tablet"}
        </button>
        <button className="tertiary" onClick={() => void skip()} disabled={state === "working"}>Skip for now</button>
      </div>
      <div className="notice">
        <strong>Skipping is fine, with a caveat.</strong> Without a sample the decoder reads your writing cold. Expect more names and numbers to land in the Inbox for confirmation rather than straight onto the action list, and expect to correct more items by hand. You can do this any time from Account.
      </div>
    </div>
  );
}

/** Editable vocabulary list: names, companies and acronyms this writer uses. */
export function LexiconEditor({ initial }: { initial: string[] }) {
  const [text, setText] = useState(initial.join("\n"));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    try {
      const saved = await trpc.calibration.setLexicon.mutate({ terms: text.split("\n").map((t) => t.trim()).filter(Boolean) });
      setText(saved.join("\n"));
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>
        One term per line: people, companies, products, standards, acronyms. When the ink is ambiguous the decoder prefers these spellings over similar-looking ordinary words. Corrections you make elsewhere are added here automatically.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 180, fontFamily: "var(--font-mono)", fontSize: 13 }} placeholder={"Plume\nOptum\nTR-369\nPriya Raman"} />
      <div className="row">
        <button onClick={() => void save()} disabled={state === "saving"}>Save vocabulary</button>
        {state === "saved" ? <small className="mono">saved</small> : null}
        <small className="meta">{text.split("\n").filter((t) => t.trim()).length} terms</small>
      </div>
      {error ? <div className="notice bad">{error}</div> : null}
    </div>
  );
}
