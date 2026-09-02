import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { listUsers } from "@/server/admin";
import { requireAdmin } from "@/server/admin-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Users" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const session = await requireAdmin();
  const { deleted } = await searchParams;
  const users = await listUsers();
  return (
    <AdminShell session={session}>
      <p className="kicker">Users</p>
      <h1>Every registered account</h1>
      {deleted ? <div className="notice ok" style={{ marginBottom: 16 }}>Account deleted. The deletion is recorded in the audit log.</div> : null}
      <div className="card table-wrap" style={{ padding: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Login email</th>
              <th>Status</th>
              <th>Tablet</th>
              <th>Runs</th>
              <th>Avg pages / day</th>
              <th>Avg runs / day</th>
              <th>On-demand / day</th>
              <th>Cost month</th>
              <th>Cost to date</th>
              <th>Rating</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><Link href={`/admin/users/${u.id}`}>{u.email}</Link></td>
                <td><span className="badge">{u.status}</span></td>
                <td>{u.paired ? "paired" : "—"}</td>
                <td>{u.runs}{u.failedRuns ? <span className="meta"> · {u.failedRuns} failed</span> : null}</td>
                <td>{u.avgPagesPerDay.toFixed(1)}</td>
                <td>{u.avgRunsPerDay.toFixed(2)}</td>
                <td>{u.avgOnDemandPerDay.toFixed(2)}</td>
                <td>{fmtUsd(u.costMonthUsd)}</td>
                <td>{fmtUsd(u.costTotalUsd)}</td>
                <td>{u.ratingAvg ? `${u.ratingAvg.toFixed(1)} (${u.ratingCount})` : "—"}</td>
                <td className="meta">{fmtDateTime(u.lastRunAt)}</td>
              </tr>
            ))}
            {users.length === 0 ? <tr><td colSpan={11} className="muted">No accounts yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
