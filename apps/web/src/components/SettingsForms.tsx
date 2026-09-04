"use client";
import { useEffect, useState } from "react";
import type { getAccount } from "@/server/services";
import { errorMessage, trpc } from "@/lib/trpc";

type Account = Awaited<ReturnType<typeof getAccount>>;
type Conventions = Account["settings"]["conventions"];

const MEANINGS = [
  { id: "action", label: "Action" },
  { id: "follow_up", label: "Follow-up" },
  { id: "priority", label: "High priority" },
  { id: "schedule", label: "Schedule this" },
];

function useSaver<T>(fn: (v: T) => Promise<unknown>) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const save = async (v: T) => {
    setState("saving");
    setError(null);
    try {
      await fn(v);
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  };
  return { state, error, save };
}

function Status({ state, error }: { state: string; error: string | null }) {
  if (state === "saved") return <small className="mono">saved</small>;
  if (state === "error") return <small className="notice bad">{error}</small>;
  return null;
}

// ------------------------------------------------------------ pairing
export function PairingWizard({ tablet, onPaired }: { tablet: Account["tablet"]; onPaired?: () => void }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const { state, error, save } = useSaver(async (c: string) => {
    const r = await trpc.account.pairTablet.mutate({ code: c.trim().toLowerCase() });
    setResult(`Paired. ${r.documents} documents in ${r.folders} folders.`);
    onPaired?.();
  });
  return (
    <div className="stack">
      {tablet.paired ? (
        <div className="notice ok">
          Tablet paired {new Date(tablet.pairedAt).toLocaleDateString()}. {tablet.lastError ? <span className="badge bad">last error: {tablet.lastError}</span> : tablet.lastOkAt ? `Last cloud contact ${new Date(tablet.lastOkAt).toLocaleString()}.` : ""}
        </div>
      ) : null}
      <ol style={{ paddingLeft: 20, margin: 0 }}>
        <li>Open <a href="https://my.remarkable.com/device/browser/connect" target="_blank" rel="noreferrer">my.remarkable.com/device/browser/connect</a> and sign in.</li>
        <li>Copy the 8-character one-time code.</li>
        <li>Paste it here within a few minutes.</li>
      </ol>
      <div className="field">
        <label htmlFor="code">One-time code</label>
        <input id="code" type="text" inputMode="text" autoCapitalize="off" maxLength={8} className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abcdefgh" />
        <div className="hint">dayMarkable stores the resulting device token encrypted; the code itself is never kept.</div>
      </div>
      <div className="row">
        <button className="primary" disabled={code.trim().length !== 8 || state === "saving"} onClick={() => void save(code)}>{state === "saving" ? "Pairing…" : tablet.paired ? "Re-pair" : "Pair tablet"}</button>
        <Status state={state} error={error} />
      </div>
      {result ? <div className="notice ok">{result}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------ watch folders
export function WatchFolders({ initial, includePdfs, paired }: { initial: string[]; includePdfs: boolean; paired: boolean }) {
  const [folders, setFolders] = useState<Array<{ path: string; label: string; notebooks: number }> | null>(null);
  const [selected, setSelected] = useState<string[]>(initial);
  const [pdfs, setPdfs] = useState(includePdfs);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { state, error, save } = useSaver(async () => trpc.account.updateSettings.mutate({ watchFolders: selected, includePdfs: pdfs }));

  useEffect(() => {
    if (!paired) return;
    trpc.account.tabletFolders.query().then(setFolders, (e) => setLoadError(errorMessage(e)));
  }, [paired]);

  const toggle = (p: string) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  return (
    <div className="stack">
      <p className="muted">Pick the folders dayMarkable reads. Nothing selected means every notebook. Your own dayMarkable planner pages are always read so ticks close the loop.</p>
      {!paired ? <div className="notice">Pair the tablet first to list folders.</div> : null}
      {loadError ? <div className="notice bad">{loadError}</div> : null}
      {paired && !folders && !loadError ? <small className="mono">loading folders…</small> : null}
      {folders ? (
        <div>
          {folders.map((f) => (
            <label key={f.path} className="check">
              <input type="checkbox" checked={selected.includes(f.path)} onChange={() => toggle(f.path)} />
              <span>{f.label} <span className="meta">{f.notebooks} notebook{f.notebooks === 1 ? "" : "s"}</span></span>
            </label>
          ))}
        </div>
      ) : null}
      <label className="check"><input type="checkbox" checked={pdfs} onChange={(e) => setPdfs(e.target.checked)} /><span>Also read annotated PDFs (ebooks are never read)</span></label>
      <div className="row"><button onClick={() => void save(undefined)} disabled={state === "saving"}>Save folders</button><Status state={state} error={error} /></div>
    </div>
  );
}

// ------------------------------------------------------------ timezone
export function TimezonePicker({ initial }: { initial: string }) {
  const [zones, setZones] = useState<string[]>([initial]);
  const [tz, setTz] = useState(initial);
  const { state, error, save } = useSaver(async (z: string) => trpc.account.updateTimezone.mutate({ timezone: z }));
  useEffect(() => {
    trpc.account.timezones.query().then(setZones).catch(() => {});
  }, []);
  return (
    <div className="stack">
      <p className="muted">Runs happen at 03:00 in this timezone. The date on every planner page follows it too.</p>
      <div className="field">
        <label htmlFor="tz">Timezone</label>
        <select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {zones.includes(tz) ? null : <option value={tz}>{tz}</option>}
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <div className="hint">Device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
      </div>
      <div className="row"><button onClick={() => void save(tz)} disabled={state === "saving"}>Save timezone</button><Status state={state} error={error} /></div>
    </div>
  );
}

// ------------------------------------------------------------ ink conventions
export function ConventionsPicker({ initial, catalog }: { initial: Conventions; catalog: Account["conventionCatalog"] }) {
  const [active, setActive] = useState<Conventions["active"]>(initial.active);
  const { state, error, save } = useSaver(async () => trpc.account.updateSettings.mutate({ conventions: { active } }));
  const find = (id: string) => active.find((a) => a.id === id);
  const set = (id: string, patch: Partial<Conventions["active"][number]> | null) =>
    setActive((list) => {
      const rest = list.filter((a) => a.id !== id);
      if (patch === null) return rest;
      const prev = find(id) ?? { id, meaning: "action" };
      return [...rest, { ...prev, ...patch }];
    });
  return (
    <div className="stack">
      <p className="muted">Tell dayMarkable which of your marks mean something. Only enabled marks carry meaning; an underline means nothing if you leave it off.</p>
      {catalog.map((c) => {
        const on = find(c.id);
        return (
          <div key={c.id} className="check" style={{ flexWrap: "wrap" }}>
            <input type="checkbox" checked={!!on} onChange={(e) => set(c.id, e.target.checked ? {} : null)} />
            <span style={{ flex: "1 1 220px" }}>
              <strong>{c.label}</strong>
              <div className="hint">{c.visual}</div>
            </span>
            {on ? (
              <span className="row" style={{ flex: "1 1 220px" }}>
                <select value={on.meaning} onChange={(e) => set(c.id, { meaning: e.target.value })} aria-label={`${c.label} meaning`}>
                  {MEANINGS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                {c.takesKeyword ? <input type="text" placeholder="keyword, e.g. TODO" value={on.keyword ?? ""} onChange={(e) => set(c.id, { keyword: e.target.value })} aria-label="keyword" /> : null}
              </span>
            ) : null}
          </div>
        );
      })}
      <div className="row"><button onClick={() => void save(undefined)} disabled={state === "saving"}>Save conventions</button><Status state={state} error={error} /></div>
    </div>
  );
}

// ------------------------------------------------------------ email prefs
export function EmailPrefs({ initial, email }: { initial: Account["settings"]["email"]; email: string }) {
  const [prefs, setPrefs] = useState(initial);
  const { state, error, save } = useSaver(async () => trpc.account.updateSettings.mutate({ email: prefs }));
  return (
    <div className="stack">
      <p className="muted">Everything goes to <strong>{email}</strong>, the address you sign in with. dayMarkable never emails anyone else.</p>
      <label className="check"><input type="checkbox" checked={prefs.meetingNotes} onChange={(e) => setPrefs({ ...prefs, meetingNotes: e.target.checked })} /><span>One email per decoded meeting (subject: topic — date time)</span></label>
      <label className="check"><input type="checkbox" checked={prefs.runSummary} onChange={(e) => setPrefs({ ...prefs, runSummary: e.target.checked })} /><span>Nightly run summary</span></label>
      <label className="check"><input type="checkbox" checked={prefs.inviteConfirmations} onChange={(e) => setPrefs({ ...prefs, inviteConfirmations: e.target.checked })} /><span>Invite confirmation links (when a calendar is connected)</span></label>
      <div className="row"><button onClick={() => void save(undefined)} disabled={state === "saving"}>Save email preferences</button><Status state={state} error={error} /></div>
    </div>
  );
}

// ------------------------------------------------------------ decode tuning (dogfood)
export function DecodeTuning({ threshold, decodeModel, escalationModel }: { threshold: number; decodeModel: string | null; escalationModel: string | null }) {
  const [t, setT] = useState(threshold);
  const [m, setM] = useState(decodeModel ?? "");
  const [e, setE] = useState(escalationModel ?? "");
  const { state, error, save } = useSaver(async () => trpc.account.updateSettings.mutate({ confidenceThreshold: t, decodeModel: m.trim() || null, escalationModel: e.trim() || null }));
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="thr">Confidence threshold ({t.toFixed(2)})</label>
        <input id="thr" type="range" min={0.3} max={0.95} step={0.05} value={t} onChange={(ev) => setT(Number(ev.target.value))} style={{ width: "100%" }} />
        <div className="hint">Items read below this confidence go to the Inbox instead of the Action List.</div>
      </div>
      <div className="grid two">
        <div className="field"><label htmlFor="m">Decode model override</label><input id="m" type="text" className="mono" placeholder="(use nightly rotation)" value={m} onChange={(ev) => setM(ev.target.value)} /></div>
        <div className="field"><label htmlFor="e">Escalation model override</label><input id="e" type="text" className="mono" placeholder="(use DECODE_ESCALATION_MODEL)" value={e} onChange={(ev) => setE(ev.target.value)} /></div>
      </div>
      <div className="row"><button onClick={() => void save(undefined)} disabled={state === "saving"}>Save tuning</button><Status state={state} error={error} /></div>
    </div>
  );
}
