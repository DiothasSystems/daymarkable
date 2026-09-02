import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { getUserDetail } from "@/server/admin";
import { requireAdmin } from "@/server/admin-guard";
import { DeleteAccountForm } from "./DeleteAccountForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · User" };

export default async function AdminUserDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const u = detail.user;
  return (
    <AdminShell session={session}>
      <p className="kicker"><Link href="/admin/users">Users</Link> · {u.status}</p>
      <h1>{u.email}</h1>
      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="card"><p className="kicker">Usage</p><div className="stat">{u.avgPagesPerDay.toFixed(1)}</div><div className="meta" style={{ marginTop: 8 }}>pages / day · {u.runs} runs ({u.onDemandRuns} on-demand, {u.failedRuns} failed) · {u.pagesDecoded} pages decoded</div></div>
        <div className="card"><p className="kicker">Token cost</p><div className="stat">{fmtUsd(u.costMonthUsd)}</div><div className="meta" style={{ marginTop: 8 }}>this month · {fmtUsd(u.costTotalUsd)} to date</div></div>
        <div className="card"><p className="kicker">Account</p><div className="meta">created {fmtDateTime(u.createdAt)}<br />onboarded {fmtDateTime(u.onboardedAt)}<br />timezone {u.timezone}<br />tablet {u.paired ? "paired" : "not paired"}<br />rating {u.ratingAvg ? `${u.ratingAvg.toFixed(1)} over ${u.ratingCount}` : "—"}</div></div>
      </div>

      <div className="grid two" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Cost by model · stage</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Model</th><th>Mode</th><th>Pages</th><th>In tok</th><th>Out tok</th><th>USD</th></tr></thead>
              <tbody>
                {detail.costs.map((c) => (
                  <tr key={`${c.model}|${c.mode}`}><td className="mono">{c.model}</td><td>{c.mode}</td><td>{c.pages}</td><td>{Number(c.inTok).toLocaleString()}</td><td>{Number(c.outTok).toLocaleString()}</td><td>{fmtUsd(c.usd)}</td></tr>
                ))}
                {detail.costs.length === 0 ? <tr><td colSpan={6} className="muted">No decode costs yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <p className="kicker">Recent runs</p>
          <ul className="list">
            {detail.runs.slice(0, 10).map((r) => (
              <li key={r.id}>
                <span className={`badge ${r.kind === "nightly" ? "auto" : "demand"}`}>{r.kind === "nightly" ? "auto" : `on-demand #${r.seq}`}</span>
                <span>{r.localDate} <span className="meta">· {r.status} · {r.stats ? `${r.stats.pagesDecoded} pages · $${r.stats.costUsd.toFixed(4)}` : ""}{r.error ? ` · ${r.error}` : ""}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="dark-panel"><p className="kicker">Cancel service</p><div className="soon">STRIPE SUBSCRIPTION · PHASE 2</div></div>
        <div className="dark-panel"><p className="kicker">Refund prorated</p><div className="soon">UNUSED DAYS VIA STRIPE · PHASE 2</div></div>
        <div className="card danger">
          <p className="kicker">Delete account</p>
          <p className="muted" style={{ fontSize: 13 }}>Full deletion: account, tokens, working set, run history, costs, feedback, and every cached file. Irreversible and audited.</p>
          <DeleteAccountForm userId={u.id} email={u.email} />
        </div>
      </div>

      <div className="card">
        <p className="kicker">Audit trail for this account</p>
        <ul className="list">
          {detail.audit.map((a) => (
            <li key={a.id}><span className="meta" style={{ minWidth: 150 }}>{fmtDateTime(a.createdAt)}</span><span><strong>{a.action}</strong> <span className="meta">by {a.adminLoginId} from {a.ip} {a.detail ? JSON.stringify(a.detail) : ""}</span></span></li>
          ))}
          {detail.audit.length === 0 ? <li className="muted">No admin actions on this account.</li> : null}
        </ul>
      </div>
    </AdminShell>
  );
}
