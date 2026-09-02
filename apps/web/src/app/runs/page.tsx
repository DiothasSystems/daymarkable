import { Shell } from "@/components/Shell";
import { RateRun } from "@/components/RateRun";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { requireUser } from "@/server/guard";
import { listRuns } from "@/server/services";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs" };

export default async function RunsPage() {
  const user = await requireUser();
  const runs = await listRuns(user.id, 60);
  return (
    <Shell>
      <p className="kicker">History</p>
      <h1>Runs</h1>
      <p className="muted">Automatic runs happen at 03:00 in your timezone on the Batch API. On-demand runs come from Sync now (web or mobile) and use the standard API. Rate how well each run read your handwriting.</p>
      {runs.length === 0 ? <div className="card">No runs yet.</div> : null}
      <div className="stack">
        {runs.map((r) => (
          <div className="card" key={r.id}>
            <div className="row between">
              <div className="row">
                <span className={`badge ${r.kind === "nightly" ? "auto" : "demand"}`}>{r.label}{r.kind === "on_demand" ? ` #${r.seq}` : ""}</span>
                <span className={`badge ${r.status === "succeeded" ? "ok" : r.status === "failed" ? "bad" : "warn"}`}>{r.status}</span>
                <strong>{r.localDate}</strong>
                <span className="muted">{fmtDateTime(r.startedAt, user.timezone)}</span>
              </div>
              <span className="mono muted">{r.models || "—"} · {fmtUsd(r.costUsd)}</span>
            </div>
            {r.stats ? (
              <p className="meta" style={{ margin: "8px 0" }}>
                {r.stats.docsChanged}/{r.stats.docsSeen} notebooks changed · {r.stats.pagesDecoded} pages read ({r.stats.pagesFailed} failed) · {r.stats.tasksFound} tasks · {r.stats.eventsFound} events · {r.stats.meetingsFound} meetings · {r.stats.checkboxUpdates} ticks · {r.stats.emailsSent} emails · purged {r.stats.purgedRunId ? `${r.stats.purgedFiles} files / ${(r.stats.purgedBytes / 1024).toFixed(0)} KB` : "nothing"}
              </p>
            ) : null}
            {r.error ? <div className="notice bad">{r.error}</div> : null}
            {r.status === "succeeded" ? <RateRun runId={r.id} initialRating={r.rating?.rating ?? null} initialComment={r.rating?.comment ?? null} compact /> : null}
          </div>
        ))}
      </div>
    </Shell>
  );
}
