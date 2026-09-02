"use client";
import { useState } from "react";
import type { getRegistry, listDocuments } from "@/server/services";
import { fmtDate } from "@/lib/format";

type Docs = Awaited<ReturnType<typeof listDocuments>>["documents"];
type Registry = Awaited<ReturnType<typeof getRegistry>>;

const TABS = [
  { id: "files", label: "Notebooks" },
  { id: "calendar", label: "Calendar" },
  { id: "actions", label: "Action list" },
  { id: "meetings", label: "Meeting notes" },
];

export function DocumentsView({ documents, registry, initialTab }: { documents: Docs; registry: Registry; initialTab: string }) {
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : "files");
  const [open, setOpen] = useState<string | null>(documents.find((d) => d.cached)?.id ?? null);

  return (
    <div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "files" ? (
        <div className="stack">
          <div className="row">
            {documents.length === 0 ? <span className="muted">No notebooks yet.</span> : null}
            {documents.map((d) => (
              <button key={d.id} className={open === d.id ? "small" : "small secondary"} disabled={!d.cached} onClick={() => setOpen(d.id)} title={d.cached ? `${d.pageCount} pages` : "left the 1-day cache"}>
                {d.name} <span className="mono">{d.pageCount}p</span>
              </button>
            ))}
            {open ? <a className="btn secondary small" href={`/api/documents/${open}`} target="_blank" rel="noreferrer">Open in new tab</a> : null}
          </div>
          {open ? <iframe className="viewer" src={`/api/documents/${open}#view=FitH`} title="Document viewer" /> : null}
        </div>
      ) : null}

      {tab === "calendar" ? (
        <div className="card">
          {registry.events.length === 0 ? <p className="muted">No upcoming commitments decoded.</p> : null}
          <ul className="list">
            {registry.events.map((e) => (
              <li key={e.id}>
                <span className="mono" style={{ minWidth: 110 }}>{e.date ? fmtDate(e.date) : "undated"}{e.startTime ? ` ${e.startTime}` : ""}</span>
                <span>{e.title}{e.location ? <span className="muted"> · {e.location}</span> : null}{e.people.length ? <div className="meta">{e.people.join(", ")}</div> : null}</span>
              </li>
            ))}
          </ul>
          {registry.meetingRequests.length ? (
            <>
              <p className="kicker" style={{ marginTop: 16 }}>Invites waiting for confirmation</p>
              <ul className="list">
                {registry.meetingRequests.map((m) => (
                  <li key={m.id}>
                    <span className="badge">{m.state}</span>
                    <span>{m.topic}<div className="meta">{[m.proposedDate ? fmtDate(m.proposedDate) : null, m.proposedTime, m.attendees.join(", ")].filter(Boolean).join(" · ")}</div></span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "actions" ? (
        <div className="card">
          <p className="kicker">{registry.actions.length} open · tick on paper to close</p>
          <ul className="list">
            {registry.actions.map((t) => (
              <li key={t.id}>
                <span className="box" aria-hidden />
                <span>{t.text}<div className="meta">{[t.due ? fmtDate(t.due) : "no date", t.priority === "high" ? "HIGH" : null, t.kind === "follow_up" ? "follow-up" : null, t.people.join(", ") || null, t.carriedCount ? `carried ${t.carriedCount}×` : null, `from ${t.source.notebook} p${t.source.pageIndex + 1}`].filter(Boolean).join(" · ")}</div></span>
              </li>
            ))}
          </ul>
          {registry.inbox.length ? (
            <>
              <p className="kicker" style={{ marginTop: 16 }}>Inbox — confirm on the planner</p>
              <ul className="list">
                {registry.inbox.map((i) => (
                  <li key={i.id}><span className="box" aria-hidden /><span>{i.text}<div className="meta">{i.kind} · {Math.round(i.confidence * 100)}% sure{i.detail ? ` · ${i.detail}` : ""}</div></span></li>
                ))}
              </ul>
            </>
          ) : null}
          {registry.doneRecently.length ? (
            <>
              <p className="kicker" style={{ marginTop: 16 }}>Done this week</p>
              <ul className="list">
                {registry.doneRecently.map((t) => (
                  <li key={t.id}><span className="box done" aria-hidden /><span className="muted">{t.text}</span></li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "meetings" ? (
        <div className="stack">
          {registry.meetings.length === 0 ? <div className="card muted">No meetings decoded yet. Title a page with the meeting and date.</div> : null}
          {registry.meetings.map((m) => (
            <article className="card" key={m.id}>
              <h2>{m.topic}</h2>
              <p className="meta">{m.date ? fmtDate(m.date) : "undated"}{m.time ? ` · ${m.time}` : ""} · with {m.attendees.length ? m.attendees.join(", ") : "—"} · from {m.source.notebook} p{m.source.pageIndex + 1}</p>
              <p style={{ whiteSpace: "pre-wrap" }}>{m.text}</p>
              {m.decisions.length ? (<><p className="kicker">Decisions</p><ul>{m.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></>) : null}
              {m.actions.length ? (<><p className="kicker">Actions</p><ul>{m.actions.map((a, i) => <li key={i}>{a}</li>)}</ul></>) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
