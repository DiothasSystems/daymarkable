import { AdminShell } from "@/components/AdminShell";
import { requireAdmin } from "@/server/admin-guard";
import { capacitySnapshot } from "@/server/ops";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Capacity" };

const GB = 1024 ** 3;

function mins(secs: number): string {
  if (secs < 90) return `${Math.round(secs)}s`;
  return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

/** ok / watch / act, with the card styling this codebase already uses for good and bad. */
const VERDICT: Record<string, { label: string; className: string }> = {
  ok: { label: "OK", className: "card" },
  watch: { label: "WATCH", className: "card" },
  act: { label: "ACT", className: "card danger" },
};

export default async function AdminCapacity() {
  const session = await requireAdmin();
  const c = await capacitySnapshot();
  const v = VERDICT[c.headroom.verdict]!;
  const peak = Math.max(...c.recentNights.map((n) => n.secs), 1);
  const windowMins = Math.round(c.windowSecs / 60);

  return (
    <AdminShell session={session} wide>
      <p className="kicker">Capacity</p>
      <h1>When to add capacity, and what to add.</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Measured from this host&apos;s own runs by the method in <code>docs/CAPACITY.md</code>: a run costs a fixed
        amount to list and diff the whole reMarkable account, plus a marginal amount per page decoded. The two have to
        be separated or the per-page figure reads about three times worse than it is. The planning window is{" "}
        {windowMins} minutes — 00:01 local, when the automatic run fires, to 06:00, by which time the notebooks want to
        be on the tablet.
      </p>

      <div className={v.className} style={{ marginBottom: 24 }}>
        <p className="kicker">Verdict · {v.label}</p>
        <div className="stat" style={{ fontSize: 22, lineHeight: 1.3 }}>{c.headroom.reason}</div>
        {!c.multiTenant ? (
          <p className="meta" style={{ marginTop: 10, marginBottom: 0 }}>
            The scheduler serves one account (<code>ensureDefaultUser</code>, from <code>USER_EMAIL</code>). Every
            projection below is what the host would hold <em>once the Phase 2 multi-tenant scheduler exists</em> — it is
            not a statement that a second customer would be served today.
          </p>
        ) : null}
      </div>

      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Cost of a night</p>
          <div className="stat">{mins(c.perUserSecs)}</div>
          <div className="meta" style={{ marginTop: 8 }}>
            per account at {c.medianPages} pages · {Math.round(c.cost.fixedSecs)}s fixed + {c.cost.perPageSecs.toFixed(1)}s/page
            {c.cost.estimated ? <><br /><strong>estimated</strong> — not enough runs yet, using the documented defaults</> : <><br />from {c.cost.fixedFrom} idle and {c.cost.perPageFrom} working runs</>}
          </div>
        </div>
        <div className="card">
          <p className="kicker">Accounts that fit</p>
          <div className="stat">{c.usersConcurrent.toLocaleString()}</div>
          <div className="meta" style={{ marginTop: 8 }}>
            at {c.concurrency} concurrent runs · {c.usersSerial.toLocaleString()} if runs are serialized
          </div>
        </div>
        <div className="card">
          <p className="kicker">Window used</p>
          <div className="stat">{(c.utilisation * 100).toFixed(c.utilisation < 0.1 ? 1 : 0)}%</div>
          <div className="meta" style={{ marginTop: 8 }}>
            {c.accounts} active account{c.accounts === 1 ? "" : "s"} × {mins(c.perUserSecs)} against {windowMins} min × {c.concurrency}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Nightly wall clock · last {c.recentNights.length} nights</p>
        {c.recentNights.length === 0 ? (
          <p className="muted">No finished runs yet.</p>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110, marginTop: 12 }}>
              {[...c.recentNights].reverse().map((n) => (
                <div
                  key={n.day}
                  title={`${n.day} · ${mins(n.secs)} · ${n.runs} run${n.runs === 1 ? "" : "s"} · ${n.pages} pages`}
                  style={{
                    flex: 1,
                    minWidth: 6,
                    height: `${Math.max(3, (n.secs / peak) * 100)}%`,
                    background: n.secs > c.windowSecs ? "#8a2b2b" : "var(--gold, #C9973F)",
                    borderRadius: "2px 2px 0 0",
                  }}
                />
              ))}
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              Tallest bar is {mins(peak)} against a {windowMins}-minute window. Several runs can land on one date, so
              this is their sum — the window holds the total, not the longest.
            </div>
          </>
        )}
      </div>

      <div className="grid two" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Host</p>
          <table>
            <tbody>
              <tr><td>Cores</td><td className="mono">{c.host.cores}</td></tr>
              <tr><td>Load (1 min)</td><td className="mono">{c.host.loadAvg.toFixed(2)} · {(c.host.loadAvg / Math.max(1, c.host.cores) * 100).toFixed(0)}% of {c.host.cores} cores</td></tr>
              <tr>
                <td>Memory</td>
                <td className="mono">
                  {((c.host.memTotalBytes - c.host.memFreeBytes) / GB).toFixed(1)} / {(c.host.memTotalBytes / GB).toFixed(1)} GiB
                  {" · "}{c.host.memUsedPct.toFixed(0)}%
                </td>
              </tr>
              <tr>
                <td>Disk</td>
                <td className="mono">
                  {c.host.diskTotalBytes === 0 ? "unavailable" : <>{((c.host.diskTotalBytes - c.host.diskFreeBytes) / GB).toFixed(0)} / {(c.host.diskTotalBytes / GB).toFixed(0)} GB · {c.host.diskUsedPct.toFixed(0)}%</>}
                </td>
              </tr>
              <tr><td>Swap</td><td className="meta">none — a memory spike is an OOM kill, not a slowdown</td></tr>
            </tbody>
          </table>
          <p className="meta" style={{ marginBottom: 0 }}>
            Load is read inside the container but reflects the host. A figure near zero here during the day is expected:
            the work happens just after midnight.
          </p>
        </div>

        <div className="card">
          <p className="kicker">What binds first</p>
          <ol className="list" style={{ marginTop: 8 }}>
            <li>
              <strong>The single-user scheduler</strong>
              <span className="meta"> — {c.multiTenant ? "multi-tenant" : "now: one account, by design"}</span>
            </li>
            <li>
              <strong>reMarkable rate limits</strong>
              <span className="meta"> — {c.treeListings.toLocaleString()} tree listings a night ({c.accounts} × 8 per run). One account doing four runs in 75 minutes already earned a 429.</span>
            </li>
            <li>
              <strong>Token spend</strong>
              <span className="meta"> — depends on how much customers write, not on this host. See Expenses.</span>
            </li>
            <li>
              <strong>This host</strong>
              <span className="meta"> — last, above roughly a thousand accounts.</span>
            </li>
          </ol>
          <p className="meta" style={{ marginBottom: 0 }}>
            Cheapest headroom first, none of it a bigger VPS: <code>--workers</code> on uvicorn; stagger run start times
            across the hour instead of all at 00:01; one tree listing per run instead of eight; then move rendering
            off-box.
          </p>
        </div>
      </div>

      <div className="card table-wrap" style={{ padding: 16 }}>
        <p className="kicker">Projection at other writing volumes</p>
        <p className="muted" style={{ fontSize: 13 }}>
          A heavier writer costs more per night, so capacity is a function of how much your customers write — not a
          single number. {c.medianPages} pages is this install&apos;s current median.
        </p>
        <table>
          <thead><tr><th>Pages a night</th><th>Per account</th><th>Serialized</th><th>At {c.concurrency} concurrent</th></tr></thead>
          <tbody>
            {[4, 8, 16, 31].map((pages) => {
              const per = c.cost.fixedSecs + c.cost.perPageSecs * pages;
              return (
                <tr key={pages} style={pages === c.medianPages ? { fontWeight: 600 } : undefined}>
                  <td className="mono">{pages}</td>
                  <td className="mono">{mins(per)}</td>
                  <td className="mono">{Math.floor(c.windowSecs / per).toLocaleString()}</td>
                  <td className="mono">{Math.floor((c.windowSecs * c.concurrency) / per).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
