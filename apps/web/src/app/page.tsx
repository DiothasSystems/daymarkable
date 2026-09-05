import Link from "next/link";
import { TickBox } from "@/components/ItemActions";
import { Shell } from "@/components/Shell";
import { SyncNow } from "@/components/SyncNow";
import { fmtDate, fmtDateTime, fmtUsd } from "@/lib/format";
import { requireUser } from "@/server/guard";
import { dueTag, getRegistry, listDocuments, listRuns, quotaStatus } from "@/server/services";

export const dynamic = "force-dynamic";

function headline(meetings: number, actions: number, inbox: number, events: number): string {
  const parts: string[] = [];
  if (meetings) parts.push(`${meetings} meeting${meetings === 1 ? "" : "s"}`);
  if (events) parts.push(`${events} on the calendar`);
  if (actions) parts.push(`${actions} follow-up${actions === 1 ? "" : "s"}`);
  if (inbox) parts.push(`${inbox} to confirm`);
  if (!parts.length) return "Nothing new. Write something down tonight.";
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

export default async function TodayPage() {
  const user = await requireUser();
  const [reg, runs, quota, docs] = await Promise.all([getRegistry(user.id), listRuns(user.id, 1), quotaStatus(user.id), listDocuments(user.id)]);
  const last = runs[0] ?? null;
  const todayEvents = reg.events.filter((e) => e.date === reg.today || e.date === null);
  const upcoming = reg.events.filter((e) => e.date && e.date > reg.today).slice(0, 5);
  const planner = docs.documents.find((d) => d.kind === "planner");
  const recentMeetings = reg.meetings.filter((m) => m.date === reg.today || m.date === fmtIsoOffset(reg.today, -1)).slice(0, 3);

  return (
    <Shell>
      <div className="row between" style={{ marginBottom: 24, alignItems: "flex-end" }}>
        <div>
          <p className="kicker">Today · {fmtDate(reg.today, user.timezone)} · {user.timezone}</p>
          <h1>Good morning.</h1>
        </div>
        <SyncNow quota={quota} running={last?.status === "running" ? last.id : null} />
      </div>

      <div className="grid wide-left">
        <div className="card">
          <p className="kicker">Daily summary · {fmtDate(reg.today, user.timezone).toUpperCase()}</p>
          <div className="headline">{headline(recentMeetings.length, reg.actions.length, reg.inbox.length, todayEvents.length)}</div>
          {recentMeetings.length ? (
            <p className="muted" style={{ fontSize: 14, marginBottom: 20 }}>
              {recentMeetings.map((m) => `${m.topic}${m.decisions.length ? ` settled ${m.decisions.length} decision${m.decisions.length === 1 ? "" : "s"}` : ""}`).join(". ")}.
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 14, marginBottom: 20 }}>Every summary links back to the handwritten source. The ink is the authority; this page is the index.</p>
          )}
          {reg.actions.length === 0 ? <p className="muted">Nothing open.</p> : null}
          <ul className="list">
            {reg.actions.slice(0, 8).map((t) => {
              const tag = dueTag(t.due, reg.today);
              return (
                <li key={t.id}>
                  <TickBox itemType="task" itemId={t.id} label={`Mark done: ${t.text}`} />
                  <span>
                    {t.text}
                    <div className="meta">
                      {t.source.notebook.toUpperCase()} · p.{t.source.pageIndex + 1}
                      {t.carriedCount ? ` · carried ${t.carriedCount}d` : ""}
                    </div>
                  </span>
                  {tag ? <span className={`due${tag.soon ? " soon" : ""}`}>{tag.label}</span> : t.priority === "high" ? <span className="due soon">PRIORITY</span> : null}
                </li>
              );
            })}
          </ul>
          {reg.actions.length > 8 ? (
            <p style={{ marginTop: 14, marginBottom: 0 }}><Link href="/documents?tab=actions">All {reg.actions.length} actions →</Link></p>
          ) : null}
        </div>

        <div className="stack" style={{ gap: 24 }}>
          <div className="card">
            <p className="kicker">Calendar</p>
            {todayEvents.length === 0 ? <p className="muted" style={{ marginBottom: 0 }}>Nothing on the calendar today.</p> : null}
            <ul className="list">
              {todayEvents.map((e) => (
                <li key={e.id}>
                  <span className="mono" style={{ minWidth: 56, color: "var(--meta)" }}>{e.startTime ?? "all day"}</span>
                  <span>{e.title}{e.location ? <span className="muted"> · {e.location}</span> : null}</span>
                </li>
              ))}
            </ul>
            {upcoming.length ? (
              <>
                <p className="kicker" style={{ marginTop: 16 }}>Coming up</p>
                <ul className="list">
                  {upcoming.map((e) => (
                    <li key={e.id}>
                      <span className="mono" style={{ minWidth: 96, color: "var(--meta)" }}>{fmtDate(e.date)}{e.startTime ? ` ${e.startTime}` : ""}</span>
                      <span>{e.title}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="card">
            <p className="kicker">Last run</p>
            {last ? (
              <>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className={`badge ${last.kind === "nightly" ? "auto" : "demand"}`}>{last.label}</span>
                  <span className={`badge ${last.status === "succeeded" ? "ok" : last.status === "failed" ? "bad" : "warn"}`}>{last.status}</span>
                </div>
                <div className="meta">{fmtDateTime(last.finishedAt ?? last.startedAt, user.timezone)}{last.stats ? ` · ${last.stats.pagesDecoded} pages · ${fmtUsd(last.costUsd)}` : ""}</div>
              </>
            ) : (
              <p className="muted" style={{ marginBottom: 0 }}>No runs yet. Press Sync now or wait for 03:00.</p>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              {planner && planner.cached ? <a className="btn secondary small" href={`/api/documents/${planner.id}`} target="_blank" rel="noreferrer">Open today's planner</a> : null}
              <Link href="/documents" className="btn tertiary small">All documents →</Link>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function fmtIsoOffset(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
