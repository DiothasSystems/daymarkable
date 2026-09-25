"use client";
import { useEffect, useState } from "react";
import type { getAccount } from "@/server/services";
import { errorMessage, trpc } from "@/lib/trpc";

type Account = Awaited<ReturnType<typeof getAccount>>;
type Conventions = Account["settings"]["conventions"];

const MEANINGS = [
  { id: "action", label: "An action for my list" },
  { id: "follow_up", label: "A follow-up with someone" },
  { id: "schedule", label: "Something to put on my calendar" },
  { id: "note", label: "A note to keep, not a task" },
  { id: "priority", label: "High priority" },
];

/** Enough rows that a writer with several marks is not filling them in one at a time. */
const STARTER_MARK_ROWS = 3;

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
        <div className="hint">ScriptumIQ stores the resulting device token encrypted; the code itself is never kept.</div>
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
/** Where the generated notebooks land on the tablet. */
/** Close the Notes notebook each week and file the finished week onto the tablet. */
export function WeeklyNotesArchive({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const { state, error, save } = useSaver(async (v: boolean) => trpc.account.updateSettings.mutate({ weeklyNotesArchive: v }));
  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>
        Newest notes are always at the top of the Notes notebook. With this on, each Sunday&apos;s run files the week
        that just ended into <span className="mono">ScriptumIQ/Archive</span> as{" "}
        <span className="mono">Notes - Week of MM-DD-YYYY</span>, and the live notebook starts the new week empty.
      </p>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>
          File a notebook per week
          <div className="hint">Off keeps every note in one notebook, which grows without limit.</div>
        </span>
      </label>
      <div className="row">
        <button onClick={() => void save(on)} disabled={state === "saving"}>Save</button>
        <Status state={state} error={error} />
      </div>
    </div>
  );
}

export function OutputLocation({ initial }: { initial: boolean }) {
  const [toRoot, setToRoot] = useState(initial);
  const { state, error, save } = useSaver(async (v: boolean) => trpc.account.updateSettings.mutate({ outputToRoot: v }));
  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>Where Planner, Action List and Notes are written each night.</p>
      <label className="check">
        <input type="radio" name="outloc" checked={!toRoot} onChange={() => setToRoot(false)} />
        <span><strong>In a ScriptumIQ folder</strong><div className="hint">Tidy: everything ScriptumIQ writes lives in one place.</div></span>
      </label>
      <label className="check">
        <input type="radio" name="outloc" checked={toRoot} onChange={() => setToRoot(true)} />
        <span><strong>On the tablet's home screen</strong><div className="hint">The planner is the first thing you see when you pick up the tablet. Dated archives still go to ScriptumIQ/Archive so home stays clean.</div></span>
      </label>
      <div className="row">
        <button onClick={() => void save(toRoot)} disabled={state === "saving"}>Save location</button>
        <Status state={state} error={error} />
        {toRoot !== initial ? <small className="meta">moves on the next run, or press Send updated notebooks on Documents</small> : null}
      </div>
    </div>
  );
}

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
      <p className="muted">Pick the folders ScriptumIQ reads. Nothing selected means every notebook. Your own ScriptumIQ planner pages are always read so ticks close the loop.</p>
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
      <p className="muted">Runs happen a minute after midnight in this timezone, and the date on every planner page follows it. Travelling does not change it — your run stays on the zone you set here, and Sync now covers you while you are away.</p>
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
  // Catalogue marks are one-of-each, so keying them by id is fine. The writer's own marks are
  // repeatable and are kept in their own list — keying those by id was the bug, because a second
  // one replaced the first.
  const [active, setActive] = useState<Conventions["active"]>(initial.active.filter((a) => a.id !== "keyword"));
  const [marks, setMarks] = useState<{ keyword: string; meaning: string }[]>(() => {
    const own = initial.active.filter((a) => a.id === "keyword").map((a) => ({ keyword: a.keyword ?? "", meaning: a.meaning }));
    // Always leave a blank row or two to write in, so the list never looks finished when it is not.
    while (own.length < STARTER_MARK_ROWS) own.push({ keyword: "", meaning: "action" });
    return own;
  });
  const { state, error, save } = useSaver(async () => {
    // Blank rows are not an error, they are an empty row: drop them rather than refusing the save.
    const own = marks
      .map((m) => ({ id: "keyword" as const, meaning: m.meaning, keyword: m.keyword.trim() }))
      .filter((m) => m.keyword.length > 0);
    return trpc.account.updateSettings.mutate({ conventions: { active: [...active, ...own] } });
  });
  const setMark = (i: number, patch: { keyword?: string; meaning?: string }) =>
    setMarks((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const removeMark = (i: number) =>
    setMarks((list) => {
      const next = list.filter((_, j) => j !== i);
      return next.length ? next : [{ keyword: "", meaning: "action" }];
    });
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
      <p className="muted">
        Tell ScriptumIQ which of your marks mean something. Only the ones you turn on carry meaning — an underline
        means nothing if you leave it off. This is the single biggest thing you control: the decoder trusts your own
        markup over its guess at your wording.
      </p>
      {catalog.filter((c) => !c.takesKeyword).map((c) => {
        const on = find(c.id);
        return (
          <div key={c.id} className="check" style={{ flexWrap: "wrap" }}>
            <input type="checkbox" checked={!!on} onChange={(e) => set(c.id, e.target.checked ? {} : null)} />
            <span style={{ flex: "1 1 220px" }}>
              <strong>{c.label}</strong>
              <div className="hint">{c.visual}</div>
            </span>
            {on ? (
              <span className="row" style={{ flex: "1 1 240px" }}>
                <select value={on.meaning} onChange={(e) => set(c.id, { meaning: e.target.value })} aria-label={`${c.label} meaning`} style={{ width: "100%" }}>
                  {MEANINGS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </span>
            ) : null}
          </div>
        );
      })}

      <div className="field" style={{ marginTop: 8 }}>
        <label>Marks and words of your own</label>
        <div className="hint" style={{ marginBottom: 8 }}>
          Anything you write yourself: a symbol like <span className="mono">&gt;</span> or{" "}
          <span className="mono">#</span>, or a word like <span className="mono">TODO</span> or{" "}
          <span className="mono">F/U</span>. One per row, and as many rows as you use — they can mean different
          things. Case does not matter.
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {marks.map((m, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="text"
                className="mono"
                style={{ flex: "1 1 200px" }}
                maxLength={24}
                placeholder="e.g. TODO, &gt;, ?, F/U"
                value={m.keyword}
                onChange={(e) => setMark(i, { keyword: e.target.value })}
                aria-label={`Mark ${i + 1}`}
              />
              <select
                value={m.meaning}
                onChange={(e) => setMark(i, { meaning: e.target.value })}
                aria-label={`What mark ${i + 1} means`}
                style={{ flex: "1 1 240px" }}
              >
                {MEANINGS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <button className="tertiary small" onClick={() => removeMark(i)} aria-label={`Remove mark ${i + 1}`} type="button">Remove</button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="secondary small" type="button" onClick={() => setMarks((v) => [...v, { keyword: "", meaning: "action" }])}>Add another mark</button>
        </div>
      </div>

      <div className="row"><button onClick={() => void save(undefined)} disabled={state === "saving"}>Save conventions</button><Status state={state} error={error} /></div>
    </div>
  );
}


// ------------------------------------------------------------ delivery address
/**
 * Where the night's planner, action list and notes are delivered as PDFs.
 *
 * The address must confirm itself before anything is sent: it is typed by hand, and a slip like
 * "gmial.com" would otherwise mail this person's notes to a stranger every night (rule 10).
 */
export function DeliveryEmail({
  initial,
  verified,
  documents,
  perMeeting,
  loginEmail,
}: {
  initial: string | null;
  verified: string | null;
  documents: Account["settings"]["deliveryDocuments"];
  perMeeting: boolean;
  loginEmail: string;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [docs, setDocs] = useState(documents);
  const [meetingEmails, setMeetingEmails] = useState(perMeeting);
  const [sent, setSent] = useState(false);
  const [confirmed, setConfirmed] = useState(Boolean(verified));
  const { state, error, save } = useSaver(async () => {
    await trpc.account.updateSettings.mutate({ deliveryDocuments: docs, email: { meetingNotes: meetingEmails } });
    const r = await trpc.account.setDeliveryEmail.mutate({ email: value.trim() });
    setSent(r.sent);
    setConfirmed(r.verified);
  });
  const none = !docs.planner && !docs.actionList && !docs.meetingNotes;
  const dirty = value.trim().toLowerCase() !== (initial ?? "").toLowerCase();

  return (
    <div className="stack">
      <p className="muted">
        After every run, the same documents that go to the tablet are emailed as PDFs. Leave the address empty to send nothing.
      </p>
      <div className="field">
        <label htmlFor="delivery">Send to</label>
        <input id="delivery" type="email" placeholder="you@example.com" value={value} onChange={(e) => { setValue(e.target.value); setSent(false); }} />
      </div>
      <p className="kicker" style={{ marginTop: 6 }}>Documents</p>
      <label className="check"><input type="checkbox" checked={docs.meetingNotes} onChange={(e) => setDocs({ ...docs, meetingNotes: e.target.checked })} /><span>Notes (PDF)</span></label>
      <label className="check"><input type="checkbox" checked={docs.actionList} onChange={(e) => setDocs({ ...docs, actionList: e.target.checked })} /><span>Action List (PDF)</span></label>
      <label className="check"><input type="checkbox" checked={docs.planner} onChange={(e) => setDocs({ ...docs, planner: e.target.checked })} /><span>Planner (PDF — day, week, month, quarter, year, inbox)</span></label>
      <p className="kicker" style={{ marginTop: 12 }}>Also</p>
      <label className="check"><input type="checkbox" checked={meetingEmails} onChange={(e) => setMeetingEmails(e.target.checked)} /><span>One email per decoded meeting, with the note in the body, to {loginEmail}</span></label>
      {value.trim() && none ? <div className="notice">No documents ticked, so nothing will be attached.</div> : null}
      {value.trim() && !dirty ? (
        confirmed ? (
          <div className="notice ok">Confirmed — the next run will deliver here.</div>
        ) : (
          <div className="notice">
            Waiting for confirmation. Open the email sent to <strong>{value.trim()}</strong> and click the link; nothing is delivered until you do.
            {sent ? " (Sent just now.)" : null}
          </div>
        )
      ) : null}
      <div className="row">
        <button onClick={() => void save(undefined)} disabled={state === "saving"}>
          {value.trim() ? (dirty ? "Save and send confirmation" : confirmed ? "Save" : "Resend confirmation") : "Remove delivery address"}
        </button>
        <Status state={state} error={error} />
      </div>
    </div>
  );
}


// ------------------------------------------------------------ the two daily extras

/** The most topics honoured; matches packages/news so the form cannot promise more than it does. */
const MAX_TOPICS = 5;

/**
 * The overnight news brief. Topics are free text because that is the point — "broadband hardware",
 * "the school board", "Arsenal" — and they are searched as written rather than matched to a menu.
 */
export function DailyUpdateSettings({ initial }: { initial: { enabled: boolean; topics: string[] } }) {
  const [on, setOn] = useState(initial.enabled);
  const [topics, setTopics] = useState<string[]>(() => {
    const t = [...initial.topics];
    while (t.length < 3) t.push("");
    return t;
  });
  const { state, error, save } = useSaver(async () =>
    trpc.account.updateSettings.mutate({
      dailyUpdate: { enabled: on, topics: topics.map((t) => t.trim()).filter(Boolean).slice(0, MAX_TOPICS) },
    }),
  );
  const filled = topics.filter((t) => t.trim()).length;

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>
        Overnight, ScriptumIQ searches the news for the subjects you follow and writes a short brief — a few
        headlines each, a sentence or two apiece. It arrives on your tablet with everything else, so it is there
        with your coffee rather than in a feed.
      </p>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>
          Send me the Daily Update
          <div className="hint">Off means no news notebook at all. Nothing else changes.</div>
        </span>
      </label>
      {on ? (
        <div className="field">
          <label htmlFor="topic-0">What do you follow?</label>
          <div className="hint" style={{ marginBottom: 8 }}>
            Anything you would type into a search box. Work, business or personal — they sit in separate sections in
            the order you list them. {MAX_TOPICS} at most, because more than that and no topic gets enough of the page
            to be worth reading.
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {topics.map((topic, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <input
                  id={`topic-${i}`}
                  type="text"
                  style={{ flex: 1 }}
                  maxLength={80}
                  placeholder={i === 0 ? "e.g. broadband hardware" : i === 1 ? "e.g. my industry, my company, a competitor" : "e.g. a team, a city, a hobby"}
                  value={topic}
                  onChange={(e) => setTopics((v) => v.map((t, j) => (j === i ? e.target.value : t)))}
                  aria-label={`Topic ${i + 1}`}
                />
                <button
                  className="tertiary small"
                  type="button"
                  onClick={() => setTopics((v) => (v.length > 1 ? v.filter((_, j) => j !== i) : [""]))}
                  aria-label={`Remove topic ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {topics.length < MAX_TOPICS ? (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="secondary small" type="button" onClick={() => setTopics((v) => [...v, ""])}>Add another topic</button>
            </div>
          ) : null}
          {filled === 0 ? (
            <div className="hint" style={{ marginTop: 8 }}>
              With no topics there is nothing to search for, so no brief is written. Add at least one.
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="row">
        <button onClick={() => void save(undefined)} disabled={state === "saving"}>Save</button>
        <Status state={state} error={error} />
      </div>
    </div>
  );
}

/** Nothing to configure but on or off — the week is the week, and it is the same week for everyone. */
export function DailyPuzzleSettings({ initial }: { initial: { enabled: boolean } }) {
  const [on, setOn] = useState(initial.enabled);
  const { state, error, save } = useSaver(async (v: boolean) => trpc.account.updateSettings.mutate({ dailyPuzzle: { enabled: v } }));
  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>
        A puzzle a day, with its solution on the page behind it. Crosswords Monday, Wednesday and Friday — 25, 35 and
        50 answers as the week goes on, each on a page of its own with the clues overleaf; word search Tuesday and
        Saturday; sudoku Thursday and Sunday. One puzzle is made each day and everybody gets the same one, so it is
        general knowledge rather than your own vocabulary — and two people can compare notes on the same grid.
      </p>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>
          Send me the Daily Puzzle
          <div className="hint">Generated here, not fetched — it costs nothing and works whether or not you wrote anything that day.</div>
        </span>
      </label>
      <div className="row">
        <button onClick={() => void save(on)} disabled={state === "saving"}>Save</button>
        <Status state={state} error={error} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ password

/**
 * Changing the password happens by emailed link, not by typing the old one here. A signed-in
 * browser left open is exactly the situation where "type your current password" matters least and
 * the mailbox matters most — and one path for setting, resetting and changing means one path to get
 * right (server/sign-in.ts). The link does not sign anyone in; choosing a new password signs every
 * device out, this one included.
 */
export function PasswordSettings({ email, setAt }: { email: string; setAt: Date | string | null }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const when = setAt ? new Date(setAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

  async function send() {
    setState("sending");
    setError(null);
    try {
      await trpc.auth.requestPasswordLink.mutate({ email });
      setState("sent");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>
        Signing in takes your password, then a link we email to <strong>{email}</strong>.{" "}
        {when ? `Your password was last set on ${when}.` : "You have not set a password yet."}
      </p>
      {state === "sent" ? (
        <div className="notice ok">
          A link to {when ? "change" : "set"} your password is on its way to {email}. It lasts 30 minutes.
          {when ? " Changing it signs out every device, this one included." : null}
        </div>
      ) : (
        <div className="row">
          <button className="secondary" onClick={() => void send()} disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : when ? "Email me a link to change it" : "Email me a link to set one"}
          </button>
          {state === "error" ? <small className="notice bad">{error}</small> : null}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ forwarding meetings in

/**
 * The inbound calendar address.
 *
 * One address per account, and no mailbox behind it — the token in front of the @ is only how the
 * service knows whose planner a forwarded invite belongs on. The copy has to carry three facts the
 * customer would otherwise learn the hard way: forward from the account's own email address or the
 * invite is refused, rotating the address retires the old one immediately, and "forward" means the
 * EMAIL rather than the meeting.
 *
 * That last one is the only one of the three with a witness. Forwarding the message from an inbox is
 * seen by nobody, but Outlook's calendar view has a Forward of its own that can send the organiser a
 * Meeting Forward Notification naming the address it went to, and Google's "Add guests" writes the
 * address into ATTENDEE for every person on the invitation. Neither exposes anything the customer
 * wrote — a forward never reaches back into the organiser's calendar and nothing here replies (rule
 * 7) — but both hand a third party the token, which is the leak rule 17 says to expect and the
 * reason the rotate button is there. A customer who assumed this was private finds out by having
 * told the room.
 *
 * Hence the steps, and hence the one that looks like a contradiction: when the invitation is no
 * longer in the mailbox, Outlook's "Forward as iCalendar" is safe where plain "Forward" is not.
 * It is not a meeting forward at all — it hangs the .ics on an ordinary message — so it never
 * reaches the notification path. Google has no equivalent: Calendar cannot send a single event
 * anywhere except by inviting somebody, so Gmail's All Mail is the only route and the steps say so.
 */
export function CalendarInbox({
  initial,
  loginEmail,
  deliveryEmail,
}: {
  initial: string | null;
  loginEmail: string;
  /** A delivery address that has CONFIRMED itself. Unverified ones cannot send, so naming one here
      would promise something the sender check refuses (server/calendar-inbox.ts). */
  deliveryEmail: string | null;
}) {
  const [address, setAddress] = useState(initial);
  const [copied, setCopied] = useState(false);
  const { state, error, save } = useSaver(async () => {
    const r = await trpc.account.rotateCalendarAddress.mutate();
    setAddress(r.address);
  });

  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 14 }}>
        Forward a meeting invitation here — from Outlook, Google Calendar, anywhere — and it goes onto your planner
        pages. Single meetings and repeating ones both work, including the awkward ones: the third Thursday of the
        month, every other Tuesday until March. Updates and cancellations follow the meeting, so moving it in Outlook
        and forwarding again moves it here too.
      </p>
      {address ? (
        <>
          <div className="field">
            <label htmlFor="cal-address">Your calendar address</label>
            <div className="row" style={{ gap: 8 }}>
              <input id="cal-address" type="text" className="mono" style={{ flex: 1 }} value={address} readOnly />
              <button
                className="secondary small"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="hint">
              Send it from <strong>{loginEmail}</strong>
              {deliveryEmail ? <> or <strong>{deliveryEmail}</strong></> : null}. Mail from any other address is refused
              — the address above travels in mail headers and forwarding chains, so on its own it is not proof of who
              sent something.
            </div>

            {/* Its own point, not a continuation of the sender rule above — 4px would read as one blob. */}
            <div className="hint" style={{ marginTop: 10 }}>
              <strong>Forward the invitation email. Do not add this address as a guest.</strong> A guest is invited by
              the organiser, so the mail would arrive from them rather than from you and be refused — and the address
              would sit on the invitation for every guest to read.
            </div>

            <details style={{ marginTop: 10 }}>
              <summary className="hint" style={{ cursor: "pointer" }}>How to forward one</summary>
              <div className="hint" style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 4px" }}>
                  <strong>Google Calendar.</strong> Forward from Gmail, not from Calendar. Calendar has no forward for an
                  event at all — its only way to send one to somebody is Add guests, which invites them.
                </p>
                <ol style={{ paddingLeft: 20, margin: "0 0 10px" }}>
                  <li>
                    In Gmail, find the invitation: search the meeting title, or{" "}
                    <span className="mono">has:attachment invite.ics</span>. Invitations stay in All Mail after you
                    accept, so one you have already answered is still there.
                  </li>
                  <li>
                    Open it and use the <strong>⋮ menu at the top right of the message → Forward</strong>. Gmail often
                    hides the usual forward arrow on an invitation, which is why it can look as though there is none.
                  </li>
                  <li>Send it to the address above.</li>
                </ol>
                <p style={{ margin: "0 0 4px" }}>
                  <strong>Outlook.</strong> Forward the invitation from <strong>Mail</strong>, not from Calendar.
                </p>
                <ol style={{ paddingLeft: 20, margin: "0 0 10px" }}>
                  <li>
                    In Mail, find the invitation — in the Inbox, or in Deleted Items if Outlook filed it away when you
                    accepted.
                  </li>
                  <li>Forward it to the address above. A forward from Mail is an ordinary email and tells nobody.</li>
                  <li>
                    If the invitation is gone for good, open the meeting in Calendar and use{" "}
                    <strong>Forward → Forward as iCalendar</strong>, which attaches the meeting to an ordinary email.
                    Do not use plain <strong>Forward</strong> there: that one is a meeting forward, and classic Outlook
                    sends the organiser a notice saying where you sent it. Forward as iCalendar is a classic Outlook
                    desktop option — new Outlook and Outlook on the web may not offer it.
                  </li>
                </ol>
                <p style={{ margin: 0 }}>
                  <strong>Apple Calendar.</strong> Same again: forward the invitation from Mail rather than from the
                  event.
                </p>
              </div>
            </details>
          </div>
          <div className="row">
            <button className="secondary" onClick={() => void save(undefined)} disabled={state === "saving"}>
              Replace this address
            </button>
            <Status state={state} error={error} />
          </div>
          <div className="hint">Replacing it stops the old one working straight away. Anything already on your planner stays.</div>
        </>
      ) : (
        <div className="row">
          <button onClick={() => void save(undefined)} disabled={state === "saving"}>Create my calendar address</button>
          <Status state={state} error={error} />
        </div>
      )}
    </div>
  );
}
