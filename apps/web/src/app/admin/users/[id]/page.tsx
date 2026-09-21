import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { TUNING_MAX, TUNING_MIN, billingView, getUserDetail } from "@/server/admin";
import { userDailyCosts, userOpsFacts } from "@/server/ops";
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
  const [facts, daily] = await Promise.all([userOpsFacts(id), userDailyCosts(id, 30)]);
  if (!detail) notFound();
  const u = detail.user;
  // Per page and per night, which is what says whether this account is expensive to serve — a
  // total only says how long they have been a customer.
  const perPage = u.pagesDecoded > 0 ? u.costTotalUsd / u.pagesDecoded : null;
  const nights = daily.filter((d) => d.costUsd > 0);
  const perNight = nights.length ? nights.reduce((n, d) => n + d.costUsd, 0) / nights.length : null;
  const peakDay = Math.max(...daily.map((d) => d.costUsd), 0.000001);
  return (
    <AdminShell session={session} wide>
      <p className="kicker"><Link href="/admin/users">Users</Link> · {u.status}</p>
      <h1>{u.email}</h1>
      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      {tuned ? <div className="notice ok" style={{ marginBottom: 16 }}>Decode tuning saved.</div> : null}
      {billed ? <div className="notice ok" style={{ marginBottom: 16 }}>{billed}</div> : null}
      <div className="grid four" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Token cost</p>
          <div className="stat">{fmtUsd(u.costMonthUsd)}</div>
          <div className="meta" style={{ marginTop: 8 }}>this month · {fmtUsd(u.costTotalUsd)} to date</div>
        </div>
        <div className="card">
          <p className="kicker">Cost per night</p>
          <div className="stat">{perNight === null ? "—" : fmtUsd(perNight)}</div>
          <div className="meta" style={{ marginTop: 8 }}>
            over {nights.length} night{nights.length === 1 ? "" : "s"} that cost anything · {perPage === null ? "—" : `${fmtUsd(perPage)} per page`}
          </div>
        </div>
        <div className="card">
          <p className="kicker">Pages read</p>
          <div className="stat">{u.avgPagesPerDay.toFixed(1)}</div>
          <div className="meta" style={{ marginTop: 8 }}>per day · {u.pagesDecoded} decoded over {u.runs} run{u.runs === 1 ? "" : "s"} ({u.onDemandRuns} on-demand, {u.failedRuns} failed)</div>
        </div>
        <div className="card">
          <p className="kicker">Account</p>
          <div className="meta">created {fmtDateTime(u.createdAt)}<br />onboarded {fmtDateTime(u.onboardedAt)}<br />timezone {u.timezone}<br />tablet {u.paired ? "paired" : "not paired"}<br />rating {u.ratingAvg ? `${u.ratingAvg.toFixed(1)} over ${u.ratingCount}` : "—"}</div>
        </div>
      </div>

      <div className="card table-wrap" style={{ marginBottom: 24, padding: 16 }}>
        <p className="kicker">Day by day · last 30 days with a run</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Grouped by the run&apos;s LOCAL date, not a UTC day — a night starts at 00:07 local and an on-demand sync can
          land at any hour, so a UTC bucket would split one night across two rows. A day with a run and{" "}
          <strong>$0.00</strong> is not a gap in the data: it means nothing on the tablet changed, which is rule 2
          working and the whole unit-economics lever.
        </p>
        <table>
          <thead>
            <tr><th>Date</th><th>Runs</th><th>Pages</th><th>Tokens</th><th>Model</th><th>Cost</th><th style={{ width: "22%" }} /></tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.localDate}>
                <td className="mono">{d.localDate}</td>
                <td className="mono">
                  {d.runs}
                  {d.onDemand > 0 ? <span className="meta"> · {d.onDemand} on-demand</span> : null}
                  {d.failed > 0 ? <span className="badge bad" style={{ marginLeft: 6 }}>{d.failed} failed</span> : null}
                </td>
                <td className="mono">{d.pages}</td>
                <td className="mono">{d.tokens > 0 ? Math.round(d.tokens).toLocaleString() : "—"}</td>
                <td className="mono">{d.models || <span className="meta">none</span>}</td>
                <td className="mono">{fmtUsd(d.costUsd)}</td>
                <td>
                  <div style={{ background: "var(--gold, #C9973F)", height: 10, borderRadius: 2, width: `${Math.max(2, (d.costUsd / peakDay) * 100)}%`, opacity: d.costUsd > 0 ? 1 : 0.15 }} />
                </td>
              </tr>
            ))}
            {daily.length === 0 ? <tr><td colSpan={7} className="muted">This account has never run.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Options this customer has chosen</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Read-only. Being able to see a preference is a different thing from being able to change it, and nothing on
          this screen edits their settings.
        </p>
        <div className="grid three">
          {facts.options.map((group) => (
            <div key={group.heading}>
              <p className="kicker" style={{ marginBottom: 8 }}>{group.heading}</p>
              <table>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.label}>
                      <td style={{ width: "50%" }}>{row.label}</td>
                      <td>
                        <span className={row.on === undefined ? "mono" : row.on ? "badge ok" : "badge"}>{row.value}</span>
                        {row.detail ? <div className="meta" style={{ marginTop: 4 }}>{row.detail}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Accuracy and calibration</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Calibration is the largest thing an operator can point at when an account complains about accuracy: a written
          sample teaches the decoder this person&apos;s letterforms, and an account that skipped it is being read without
          one. The lexicon is the next largest.
        </p>
        <div className="grid two">
          <table>
            <tbody>
              <tr>
                <td>Calibrated</td>
                <td>
                  {facts.calibration ? (
                    <>
                      <span className={facts.calibration.status === "scored" ? "badge ok" : "badge warn"}>{facts.calibration.status}</span>
                      {facts.calibration.accuracy === null ? null : (
                        <span className="mono" style={{ marginLeft: 8 }}>{(facts.calibration.accuracy * 100).toFixed(0)}% accuracy</span>
                      )}
                      {facts.calibration.capturedAt ? <div className="meta" style={{ marginTop: 4 }}>captured {fmtDateTime(facts.calibration.capturedAt)}</div> : null}
                    </>
                  ) : (
                    <>
                      <span className="badge bad">never started</span>
                      <div className="meta" style={{ marginTop: 4 }}>read without a handwriting sample</div>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td>Mean decoded confidence</td>
                <td className="mono">{facts.confidenceAvg === null ? "—" : `${(facts.confidenceAvg * 100).toFixed(1)}% over ${facts.confidenceItems} items`}</td>
              </tr>
              <tr><td>Vocabulary terms</td><td className="mono">{facts.lexiconTerms}</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td>Role</td><td>{facts.role ?? <span className="meta">not given</span>}</td></tr>
              <tr><td>Industry</td><td>{facts.industry ?? <span className="meta">not given</span>}</td></tr>
              <tr><td>Nights read</td><td className="mono">{facts.nights}</td></tr>
              <tr><td>Tokens / day</td><td className="mono">{Math.round(facts.tokensPerDay).toLocaleString()}</td></tr>
            </tbody>
          </table>
        </div>
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
          <p className="kicker">Totals</p>
          <div className="meta">
            {detail.runs.length} run{detail.runs.length === 1 ? "" : "s"} on record
            <br />{detail.runs.filter((r) => r.status === "succeeded").length} succeeded · {detail.runs.filter((r) => r.status === "failed").length} failed
            <br />{fmtUsd(detail.runs.reduce((n, r) => n + (r.cost?.usd ?? 0), 0))} of decode cost across them
            <br />Every run is listed below with the model that read it.
          </div>
        </div>
      </div>

      <div className="card table-wrap" style={{ marginBottom: 24, padding: 16 }}>
        <p className="kicker">Every run · model and cost</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Model and cost come from <code>run_costs</code>, so a night that escalated shows both models rather than one
          averaged figure. Two rows for one date means a failed attempt and its retry. The customer never sees these
          columns — their own run history carries pages and findings only.
        </p>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Kind</th><th>Status</th><th>Started</th><th>Took</th>
              <th>Pages</th><th>Model</th><th>Mode</th><th>Tokens</th><th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {detail.runs.map((r) => {
              const secs = r.startedAt && r.finishedAt ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000) : null;
              return (
                <tr key={r.id}>
                  <td className="mono">{r.localDate}</td>
                  <td><span className={`badge ${r.kind === "nightly" ? "auto" : "demand"}`}>{r.kind === "nightly" ? "auto" : `#${r.seq}`}</span></td>
                  <td>
                    <span className={`badge ${r.status === "succeeded" ? "ok" : r.status === "failed" ? "bad" : "warn"}`}>{r.status}</span>
                    {r.error ? <div className="meta" style={{ maxWidth: 320 }}>{r.error}</div> : null}
                  </td>
                  <td className="meta">{fmtDateTime(r.startedAt)}</td>
                  <td className="mono">{secs === null ? "—" : secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}</td>
                  <td className="mono">{r.stats ? r.stats.pagesDecoded : "—"}</td>
                  <td className="mono">{r.cost?.models ?? <span className="meta">none</span>}</td>
                  <td className="mono">{r.cost?.modes ?? <span className="meta">—</span>}</td>
                  <td className="mono">{r.cost ? Math.round(r.cost.tokens).toLocaleString() : "—"}</td>
                  <td>{r.cost ? fmtUsd(r.cost.usd) : <span className="meta">$0.00</span>}</td>
                </tr>
              );
            })}
            {detail.runs.length === 0 ? <tr><td colSpan={10} className="muted">This account has never run.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Decode tuning · operator only</p>
        <p className="muted" style={{ fontSize: 13 }}>
          The customer cannot change these. The two thresholds do different jobs and are deliberately separate:{" "}
          <strong>escalate below</strong> decides whether a PAGE is read a second time on the escalation model, trading
          money for accuracy invisibly; <strong>inbox threshold</strong> decides whether an ITEM is confirmed before it
          reaches the Action List, trading the customer&apos;s attention for safety. Leave a model box empty to use the
          host default. Every change here is audited below.
        </p>
        <form action={`/admin/api/users/${u.id}/tuning`} method="post" className="stack">
          <div className="grid four">
            <div className="field">
              <label htmlFor="escalationThreshold">Escalate below</label>
              <input
                id="escalationThreshold"
                name="escalationThreshold"
                type="number"
                className="mono"
                min={0}
                max={0.95}
                step={0.05}
                placeholder={`default ${detail.tuning.defaultEscalationThreshold}`}
                defaultValue={detail.tuning.escalationThreshold ?? ""}
              />
              <div className="hint">
                {detail.tuning.escalationThreshold === null
                  ? `following the default of ${detail.tuning.defaultEscalationThreshold}`
                  : `overriding the default of ${detail.tuning.defaultEscalationThreshold}`}
                 · empty to follow it, 0 never escalates
              </div>
            </div>
            <div className="field">
              <label htmlFor="confidenceThreshold">Inbox threshold</label>
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
              <div className="hint">{TUNING_MIN} to {TUNING_MAX} · items read below this are confirmed in the Inbox</div>
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
