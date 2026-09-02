import Link from "next/link";
import { Shell } from "@/components/Shell";
import { SyncNow } from "@/components/SyncNow";
import { fmtDate, fmtDateTime, fmtUsd } from "@/lib/format";
import { requireUser } from "@/server/guard";
import { getRegistry, listDocuments, listRuns, quotaStatus } from "@/server/services";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await requireUser();
  const [reg, runs, quota, docs] = await Promise.all([getRegistry(user.id), listRuns(user.id, 1), quotaStatus(user.id), listDocuments(user.id)]);
  const last = runs[0] ?? null;
  const todayEvents = reg.events.filter((e) => e.date === reg.today || e.date === null);
  const upcoming = reg.events.filter((e) => e.date && e.date > reg.today).slice(0, 5);
  const planner = docs.documents.find((d) => d.kind === "planner");

  return (
    <Shell>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <p className="kicker">{fmtDate(reg.today, user.timezone)} · {user.timezone}</p>
          <h1>Today</h1>
        </div>
        <SyncNow quota={quota} running={last?.status === "running" ? last.id : null} />
      </div>

      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="card">
          <p className="kicker">Open actions</p>
          <div className="stat">{reg.actions.length}</div>
          <small>{reg.inbox.length} waiting in Inbox</small>
        </div>
        <div className="card">
          <p className="kicker">Last run</p>
          {last ? (
            <>
              <div className="row">
                <span className={`badge ${last.kind === "nightly" ? "auto" : "demand"}`}>{last.label}</span>
                <span className={`badge ${last.status === "succeeded" ? "ok" : last.status === "failed" ? "bad" : "warn"}`}>{last.status}</span>
              </div>
              <small>{fmtDateTime(last.finishedAt ?? last.startedAt, user.timezone)} · {last.stats ? `${last.stats.pagesDecoded} pages · ${fmtUsd(last.costUsd)}` : ""}</small>
            </>
          ) : (
            <small>No runs yet. Press Sync now or wait for 3AM.</small>
          )}
        </div>
        <div className="card">
          <p className="kicker">Planner</p>
          {planner && planner.cached ? (
            <a className="btn secondary" href={`/api/documents/${planner.id}`} target="_blank" rel="noreferrer">Open today's Planner</a>
          ) : (
            <small>Generated at the next run.</small>
          )}
          <div><Link href="/documents" className="muted" style={{ fontSize: "0.9rem" }}>All documents →</Link></div>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Calendar</h2>
          {todayEvents.length === 0 ? <p className="muted">Nothing on the calendar today.</p> : null}
          <ul className="list">
            {todayEvents.map((e) => (
              <li key={e.id}>
                <span className="mono" style={{ minWidth: 52 }}>{e.startTime ?? "all day"}</span>
                <span>{e.title}{e.location ? <span className="muted"> · {e.location}</span> : null}</span>
              </li>
            ))}
          </ul>
          {upcoming.length ? (
            <>
              <p className="kicker" style={{ marginTop: 14 }}>Coming up</p>
              <ul className="list">
                {upcoming.map((e) => (
                  <li key={e.id}>
                    <span className="mono" style={{ minWidth: 92 }}>{fmtDate(e.date)}{e.startTime ? ` ${e.startTime}` : ""}</span>
                    <span>{e.title}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div className="card">
          <h2>Actions</h2>
          {reg.actions.length === 0 ? <p className="muted">Nothing open. Write something down.</p> : null}
          <ul className="list">
            {reg.actions.slice(0, 10).map((t) => (
              <li key={t.id}>
                <span className="box" aria-hidden />
                <span>
                  {t.text}
                  <div className="meta">
                    {[t.due ? fmtDate(t.due) : null, t.priority === "high" ? "HIGH" : null, t.kind === "follow_up" ? "follow-up" : null, t.carriedCount ? `carried ${t.carriedCount}×` : null].filter(Boolean).join(" · ")}
                  </div>
                </span>
              </li>
            ))}
          </ul>
          {reg.actions.length > 10 ? <Link href="/documents?tab=actions" className="muted">All {reg.actions.length} actions →</Link> : null}
        </div>
      </div>
    </Shell>
  );
}
