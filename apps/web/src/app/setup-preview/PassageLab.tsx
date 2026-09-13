/** TEMPORARY — validation tool, delete this whole folder when calibration is signed off. */
"use client";
import { useState } from "react";
import { previewPassage, type PassagePreview } from "./actions";

/**
 * Profiles chosen to stress different vocabularies, because the passage is only worth anything
 * if the proper nouns and acronyms change with the writer. A student and a cardiologist should
 * not produce the same page.
 */
const PRESETS: { label: string; role: string; industry: string; context: string }[] = [
  { label: "Student — engineering", role: "Student", industry: "university — mechanical engineering", context: "" },
  { label: "Student — high school", role: "Student", industry: "high school", context: "AP Biology, AP US History, Mr. Delgado, Ms. Whitfield" },
  { label: "VP of Product", role: "VP of Product", industry: "broadband / telecom hardware", context: "Plume, Optum, TR-369, Priya Raman" },
  { label: "Physician", role: "Attending physician", industry: "cardiology", context: "" },
  { label: "Attorney", role: "Partner", industry: "intellectual property litigation", context: "" },
  { label: "Teacher", role: "Fifth grade teacher", industry: "elementary education", context: "" },
  { label: "Site manager", role: "Site manager", industry: "commercial construction", context: "" },
  { label: "Research scientist", role: "Research scientist", industry: "molecular biology", context: "" },
];

/** The coverage the generation prompt demands. Checked here so a thin passage is obvious. */
const COVERAGE: { label: string; test: (t: string) => boolean }[] = [
  { label: "all ten digits", test: (t) => "0123456789".split("").every((d) => t.includes(d)) },
  { label: "4-digit number", test: (t) => /\d{4}/.test(t) },
  { label: "decimal", test: (t) => /\d\.\d/.test(t) },
  { label: "two date forms", test: (t) => /\d\/\d/.test(t) && /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(t) },
  { label: "two time forms", test: (t) => /\d{4}\b/.test(t) && /\d:\d{2}\s*[ap]m/i.test(t) },
  { label: "asterisk line", test: (t) => /^\s*\*/m.test(t) },
  { label: "underline", test: (t) => /_[^_\n]+_/.test(t) },
  { label: "TODO line", test: (t) => /^\s*TODO/m.test(t) },
  { label: "strikethrough", test: (t) => t.includes("~~") },
  { label: "arrow", test: (t) => t.includes("->") },
  { label: "ampersand", test: (t) => t.includes("&") },
  { label: "percentage", test: (t) => /%/.test(t) },
  { label: "dollar amount", test: (t) => /\$\d/.test(t) },
  { label: "parentheses", test: (t) => t.includes("(") && t.includes(")") },
  { label: "slash", test: (t) => /\w\/\w/.test(t) },
];

export function PassageLab() {
  const [role, setRole] = useState(PRESETS[0]!.role);
  const [industry, setIndustry] = useState(PRESETS[0]!.industry);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PassagePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(p: (typeof PRESETS)[number]) {
    setRole(p.role);
    setIndustry(p.industry);
    setContext(p.context);
  }

  async function go() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await previewPassage({ role, industry, context });
      if ("error" in r && r.error) setError(r.error);
      else setResult(r as PassagePreview);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lineLimit = result ? result.lines >= 10 && result.lines <= 13 : false;
  const widthLimit = result ? result.longestLine < 46 : false;

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="kicker">Preset profiles</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="secondary"
              onClick={() => pick(p)}
              aria-pressed={role === p.role && industry === p.industry}
              style={role === p.role && industry === p.industry ? { borderWidth: 2 } : undefined}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="lab-role">Your role</label>
            <input id="lab-role" type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. VP of Product" />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="lab-industry">Industry or field</label>
            <input id="lab-industry" type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. broadband / telecom hardware" />
          </div>
        </div>
        <label htmlFor="lab-context">Anything else worth knowing (optional)</label>
        <textarea id="lab-context" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Customers, products and colleagues whose names come up often" />

        <div className="row" style={{ marginTop: 12, alignItems: "center", gap: 12 }}>
          <button className="primary" onClick={() => void go()} disabled={busy || (!role.trim() && !industry.trim())}>
            {busy ? "Generating…" : "Generate the passage"}
          </button>
          <small className="mono">one standard-API call · nothing is saved or uploaded</small>
        </div>
        {error ? <p style={{ color: "#8a2b2b" }}>{error}</p> : null}
      </div>

      {result ? (
        <>
          {result.fallbackReason ? (
            <div className="card" style={{ marginBottom: 16, borderColor: "#8a2b2b", borderWidth: 2 }}>
              <p className="kicker" style={{ color: "#8a2b2b" }}>Fallback — this is NOT a tailored passage</p>
              <p style={{ margin: 0 }}>
                The generation call did not produce a usable passage, so the generic business-notes fallback was
                substituted. Everyone gets the same page, seeded with two fictional names.
              </p>
              <p className="mono" style={{ marginBottom: 0 }}>{result.fallbackReason}</p>
            </div>
          ) : null}

          <div className="card" style={{ marginBottom: 16 }}>
            <p className="kicker">The passage</p>
            <pre style={{ fontFamily: "var(--font-mono)", fontSize: 13, whiteSpace: "pre-wrap", margin: 0 }}>{result.text}</pre>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <p className="kicker">Lexicon terms this would seed ({result.terms.length})</p>
            <p className="mono" style={{ margin: 0 }}>{result.terms.length ? result.terms.join(" · ") : "(none)"}</p>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <p className="kicker">Prompt coverage</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {COVERAGE.map((c) => {
                const ok = c.test(result.text);
                return (
                  <span
                    key={c.label}
                    className="mono"
                    style={{ fontSize: 12, padding: "2px 8px", borderRadius: 3, border: "1px solid var(--border)", color: ok ? "inherit" : "#8a2b2b" }}
                  >
                    {ok ? "✓" : "✗"} {c.label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <p className="kicker">Diagnostics</p>
            <table>
              <tbody>
                <tr><td>model</td><td className="mono">{result.model}</td></tr>
                <tr><td>stop reason</td><td className="mono">{result.stopReason ?? "—"}</td></tr>
                <tr><td>output tokens</td><td className="mono">{result.outputTokens}</td></tr>
                <tr><td>cost</td><td className="mono">${result.costUsd.toFixed(5)}</td></tr>
                <tr><td>lines</td><td className="mono">{result.lines} {lineLimit ? "✓ (10–13)" : "✗ (wants 10–13)"}</td></tr>
                <tr><td>longest line</td><td className="mono">{result.longestLine} {widthLimit ? "✓ (<46)" : "✗ (wants <46)"}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <p className="kicker">The sheet as it would reach the tablet</p>
            <iframe
              title="Calibration sheet"
              src={`data:application/pdf;base64,${result.pdfBase64}`}
              style={{ width: "100%", height: 620, border: "1px solid var(--border)", borderRadius: 4 }}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
