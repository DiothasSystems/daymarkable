import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { TUNING_MAX, TUNING_MIN, billingView, getUserDetail } from "@/server/admin";
import { userOpsFacts } from "@/server/ops";
import { requireAdmin } from "@/server/admin-guard";
import { BillingActions } from "./BillingActions";
import { DeleteAccountForm } from "./DeleteAccountForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · User" };

export default async function AdminUserDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; tuned?: string; billed?: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const { error, tuned, billed } = await searchParams;
  const detail = await getUserDetail(id);
  const billing = await billingView(id);
  const facts = await userOpsFacts(id);
  if (!detail) notFound();
  const u = detail.user;
  return (
    <AdminShell session={session}>
      <p className="kicker"><Link href="/admin/users">Users</Link> · {u.status}</p>
      <h1>{u.email}</h1>
      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      {tuned ? <div className="notice ok" style={{ marginBottom: 16 }}>Decode tuning saved.</div> : null}
      {billed ? <div className="notice ok" style={{ marginBottom: 16 }}>{billed}</div> : null}
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

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Accuracy and calibration</p>
        <table>
          <tbody>
            <tr><td>Role</td><td>{facts.role ?? <span className="meta">not given</span>}</td></tr>
            <tr><td>Industry</td><td>{facts.industry ?? <span className="meta">not given</span>}</td></tr>
            <tr><td>Vocabulary terms</td><td className="mono">{facts.lexiconTerms}</td></tr>
            <tr>
              <td>Calibration</td>
              <td>
                {facts.calibration
                  ? `${facts.calibration.status}${facts.calibration.accuracy === null ? "" : ` · ${(facts.calibration.accuracy * 100).toFixed(0)}% accuracy`}${facts.calibration.capturedAt ? ` · ${fmtDateTime(facts.calibration.capturedAt)}` : ""}`
                  : "never started"}
              </td>
            </tr>
            <tr>
              <td>Mean decoded confidence</td>
              <td className="mono">
                {facts.confidenceAvg === null ? "—" : `${(facts.confidenceAvg * 100).toFixed(1)}% over ${facts.confidenceItems} items`}
              </td>
            </tr>
            <tr><td>Nights read</td><td className="mono">{facts.nights}</td></tr>
            <tr><td>Tokens / day</td><td className="mono">{Math.round(facts.tokensPerDay).toLocaleString()}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Decode tuning · operator only</p>
        <p className="muted" style={{ fontSize: 13 }}>
          The customer cannot change these. Items read below the threshold go to the Inbox for confirmation instead of
          onto the Action List, so raising it trades more confirmation work for fewer wrong items. Leave a model box
          empty to use the host default. Every change here is audited below.
        </p>
        <form action={`/admin/api/users/${u.id}/tuning`} method="post" className="stack">
          <div className="grid three">
            <div className="field">
              <label htmlFor="confidenceThreshold">Confidence threshold</label>
              <input
                id="confidenceThreshold"
                name="confidenceThreshold"
                type="number"
                className="mono"
                min={TUNING_MIN}
                max={TUNING_MAX}
                step={0.05}
                defaultValue={detail.tuning.confidenceThreshold}
              />
              <div className="hint">{TUNING_MIN} to {TUNING_MAX}</div>
            </div>
            <div className="field">
              <label htmlFor="decodeModel">Decode model override</label>
              <input id="decodeModel" name="decodeModel" type="text" className="mono" placeholder="(host default)" defaultValue={detail.tuning.decodeModel ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="escalationModel">Escalation model override</label>
              <input id="escalationModel" name="escalationModel" type="text" className="mono" placeholder="(host default)" defaultValue={detail.tuning.escalationModel ?? ""} />
            </div>
          </div>
          <div className="row"><button type="submit">Save tuning</button></div>
        </form>
      </div>

      <div className="grid three" style={{ marginBottom: 24 }}>
        {billing.snapshot ? (
          <BillingActions
            userId={u.id}
            email={u.email}
            status={billing.snapshot.status}
            plan={billing.snapshot.plan}
            periodEnd={billing.snapshot.periodEnd ? billing.snapshot.periodEnd.toISOString().slice(0, 10) : null}
            cancelAtPeriodEnd={billing.snapshot.cancelAtPeriodEnd}
            refund={billing.refundPreview}
          />
        ) : (
          <>
            <div className="dark-panel">
              <p className="kicker">Cancel service</p>
              <div className="soon">
                {!billing.configured ? "STRIPE NOT CONFIGURED" : billing.error ? `STRIPE: ${billing.error}` : "NO SUBSCRIPTION ON THIS ACCOUNT"}
              </div>
            </div>
            <div className="dark-panel"><p className="kicker">Refund prorated</p><div className="soon">NEEDS A LIVE SUBSCRIPTION</div></div>
          </>
        )}
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
