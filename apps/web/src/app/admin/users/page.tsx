import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { fmtDate, fmtDateTime, fmtUsd } from "@/lib/format";
import { listUsers } from "@/server/admin";
import { matchesUserQuery } from "@/server/admin-core";
import { requireAdmin } from "@/server/admin-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Users" };

/** Compact token counts: an operator reads 41.2k faster than 41,203. */
function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

/** Calibration is the single largest accuracy lever, so a missing one is worth flagging, not dashing. */
function calibration(status: string | null, accuracy: number | null): { label: string; bad: boolean } {
  if (status === "captured") return { label: accuracy === null ? "yes" : `yes · ${(accuracy * 100).toFixed(0)}%`, bad: false };
  if (status === "pending") return { label: "sheet sent", bad: false };
  if (status === "skipped") return { label: "skipped", bad: true };
  return { label: "never", bad: true };
}

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ deleted?: string; q?: string }> }) {
  const session = await requireAdmin();
  const { deleted, q } = await searchParams;
  const all = await listUsers();
  const query = (q ?? "").trim();
  const users = query ? all.filter((u) => matchesUserQuery(u, query)) : all;
  return (
    <AdminShell session={session} wide>
      <p className="kicker">Users</p>
      <h1>Every registered account</h1>
      {deleted ? <div className="notice ok" style={{ marginBottom: 16 }}>Account deleted. The deletion is recorded in the audit log.</div> : null}
      <p className="muted" style={{ fontSize: 13 }}>
        Pages and tokens are per night that actually ran, not per calendar day — a night nobody wrote on the tablet
        produced nothing and should not drag the average down. Confidence is the mean across every task, event and
        meeting decoded for that account; low confidence with no calibration sample is the pairing worth acting on.
      </p>
      <form method="get" className="row" style={{ gap: 8, alignItems: "flex-end", marginBottom: 16 }}>
        <div className="field" style={{ flex: 1, maxWidth: 420, marginBottom: 0 }}>
          <label htmlFor="q">Find an account</label>
          <input id="q" name="q" type="search" defaultValue={query} placeholder="email, role, industry, plan or status" autoComplete="off" />
        </div>
        <button type="submit">Search</button>
        {query ? <Link href="/admin/users" className="tertiary">Clear</Link> : null}
        <span className="meta">
          {query ? `${users.length} of ${all.length} accounts` : `${all.length} account${all.length === 1 ? "" : "s"}`}
        </span>
      </form>
      <div className="card table-wrap" style={{ padding: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Login email</th>
              <th>Status</th>
              <th>Plan</th>
              <th>Service start</th>
              <th>Tokens / day</th>
              <th>Pages / night</th>
              <th>On-demand</th>
              <th>Confidence</th>
              <th>Calibrated</th>
              <th>Role · industry</th>
              <th>Cost month</th>
              <th>Cost to date</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const cal = calibration(u.calibrationStatus, u.calibrationAccuracy);
              return (
                <tr key={u.id}>
                  <td><Link href={`/admin/users/${u.id}`}>{u.email}</Link></td>
                  <td><span className="badge">{u.status}</span></td>
                  <td>{u.plan ?? <span className="meta">none</span>}</td>
                  <td className="meta">{fmtDate(u.serviceStartedAt.toISOString().slice(0, 10))}</td>
                  <td className="mono">{tokens(u.tokensPerDay)}</td>
                  <td className="mono">{u.pagesPerNight.toFixed(1)}<span className="meta"> / {u.nights}n</span></td>
                  <td className="mono">{u.onDemandRuns}<span className="meta"> · {u.avgOnDemandPerDay.toFixed(2)}/d</span></td>
                  <td className="mono">{u.confidenceAvg === null ? <span className="meta">—</span> : `${(u.confidenceAvg * 100).toFixed(0)}%`}</td>
                  <td style={cal.bad ? { color: "#8a2b2b" } : undefined}>{cal.label}</td>
                  <td className="meta">{u.role ? `${u.role}${u.industry ? ` · ${u.industry}` : ""}` : "not given"}</td>
                  <td>{fmtUsd(u.costMonthUsd)}</td>
                  <td>{fmtUsd(u.costTotalUsd)}</td>
                  <td className="meta">{fmtDateTime(u.lastRunAt)}</td>
                </tr>
              );
            })}
            {users.length === 0 ? (
              <tr><td colSpan={13} className="muted">{query ? `Nothing matches "${query}".` : "No accounts yet."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="meta" style={{ marginTop: 12 }}>
        Cancel and prorated refund live on each account — open one to use them.
      </p>
    </AdminShell>
  );
}
