import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime } from "@/lib/format";
import { feedbackMetrics } from "@/server/admin";
import { requireAdmin } from "@/server/admin-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Feedback" };

export default async function AdminFeedback() {
  const session = await requireAdmin();
  const fb = await feedbackMetrics();
  const maxDist = Math.max(1, ...Object.values(fb.distribution));
  return (
    <AdminShell session={session}>
      <p className="kicker">Feedback</p>
      <h1>Conversion quality</h1>
      <p className="muted">Ratings and comments only. Note content is never shown here; it is purged within 24 hours anyway.</p>
      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Average</p>
          <div className="stat">{fb.average ? fb.average.toFixed(2) : "—"}</div>
          <div className="meta" style={{ marginTop: 8 }}>{fb.count} rating{fb.count === 1 ? "" : "s"} · 1 = unusable, 5 = read perfectly</div>
        </div>
        <div className="card">
          <p className="kicker">Distribution</p>
          <div className="bars" aria-label="Rating distribution">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <div key={n} className={n >= 4 ? "hi" : ""} style={{ height: `${(fb.distribution[n] / maxDist) * 100}%` }} title={`${n} stars: ${fb.distribution[n]}`} />
            ))}
          </div>
          <div className="meta" style={{ marginTop: 6, display: "flex", justifyContent: "space-between" }}><span>1★</span><span>2★</span><span>3★</span><span>4★</span><span>5★</span></div>
        </div>
        <div className="card">
          <p className="kicker">Trend · 8 weeks</p>
          <div className="bars" aria-label="Weekly average">
            {fb.trend.map((w) => (
              <div key={w.weekStart} className={w.average && w.average >= 4 ? "hi" : ""} style={{ height: `${((w.average ?? 0) / 5) * 100}%` }} title={`${w.weekStart}: ${w.average ? w.average.toFixed(1) : "—"} (${w.count})`} />
            ))}
          </div>
          <div className="meta" style={{ marginTop: 6 }}>{fb.trend[0]?.weekStart} → {fb.trend.at(-1)?.weekStart}</div>
        </div>
      </div>
      <div className="card">
        <p className="kicker">Lowest-rated runs · last 30 days</p>
        <ul className="list">
          {fb.lowest.map((r) => (
            <li key={r.id}>
              <span className="stars" aria-label={`${r.rating} stars`}>{"★".repeat(r.rating)}<span style={{ color: "var(--border-strong)" }}>{"★".repeat(5 - r.rating)}</span></span>
              <span>
                {r.comment ? <em>“{r.comment}”</em> : <span className="muted">no comment</span>}
                <div className="meta">{r.email} · {r.runKind ? `${r.runKind === "nightly" ? "automatic" : "on-demand"} run ${r.runDate}` : "overall"} · {fmtDateTime(r.createdAt)}</div>
              </span>
            </li>
          ))}
          {fb.lowest.length === 0 ? <li className="muted">No ratings in the last 30 days.</li> : null}
        </ul>
      </div>
    </AdminShell>
  );
}
