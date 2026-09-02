import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { fmtUsd } from "@/lib/format";
import { customerCounts, feedbackMetrics, listUsers } from "@/server/admin";
import { requireAdmin } from "@/server/admin-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

export default async function AdminOverview() {
  const session = await requireAdmin();
  const [counts, users, fb] = await Promise.all([customerCounts(), listUsers(), feedbackMetrics()]);
  const costMonth = users.reduce((n, u) => n + u.costMonthUsd, 0);
  const costTotal = users.reduce((n, u) => n + u.costTotalUsd, 0);
  return (
    <AdminShell session={session}>
      <p className="kicker">Operator overview</p>
      <h1>dayMarkable at a glance</h1>
      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Customers</p>
          <div className="stat">{counts.total}</div>
          <div className="meta" style={{ marginTop: 8 }}>trial {counts.trial} · active {counts.active} · past due {counts.past_due} · canceled {counts.canceled}</div>
          <p style={{ marginTop: 12, marginBottom: 0 }}><Link href="/admin/users">Users table →</Link></p>
        </div>
        <div className="card">
          <p className="kicker">Token cost</p>
          <div className="stat">{fmtUsd(costMonth)}</div>
          <div className="meta" style={{ marginTop: 8 }}>this month · {fmtUsd(costTotal)} to date · from run_costs</div>
        </div>
        <div className="card">
          <p className="kicker">Conversion quality</p>
          <div className="stat">{fb.average ? fb.average.toFixed(1) : "—"}</div>
          <div className="meta" style={{ marginTop: 8 }}>{fb.count} rating{fb.count === 1 ? "" : "s"} · <Link href="/admin/feedback">details →</Link></div>
        </div>
      </div>
      <div className="grid two">
        <div className="dark-panel">
          <p className="kicker">Revenue</p>
          <div className="stat">$—</div>
          <div className="soon" style={{ marginTop: 8 }}>MRR · ARR · LIGHTS UP WITH STRIPE IN PHASE 2</div>
        </div>
        <div className="dark-panel">
          <p className="kicker">Trials</p>
          <div className="stat">—</div>
          <div className="soon" style={{ marginTop: 8 }}>IN TRIAL · TRIAL→PAID · CANCELED IN TRIAL · PHASE 2</div>
        </div>
      </div>
    </AdminShell>
  );
}
