import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { requireAdmin } from "@/server/admin-guard";
import { tokenPlan } from "@/server/ops";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Tokens" };

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export default async function AdminTokens({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const session = await requireAdmin();
  const { error, saved } = await searchParams;
  const plan = await tokenPlan();
  const s = plan.settings;
  const runway = plan.runwayDays;
  const low = runway !== null && runway <= s.warnDays;
  const peak = Math.max(...plan.days.map((d) => d.usd), 0.000001);

  return (
    <AdminShell session={session}>
      <p className="kicker">Token management</p>
      <h1>What the nights cost, and how long the credit lasts.</h1>
      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      {saved ? <div className="notice ok" style={{ marginBottom: 16 }}>Balance recorded. The warning clock is reset.</div> : null}

      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Burn rate</p>
          <div className="stat">{fmtUsd(plan.burnPerDayUsd)}</div>
          <div className="meta" style={{ marginTop: 8 }}>per day, over the last 7 days that actually spent</div>
        </div>
        <div className="card">
          <p className="kicker">Expected next night</p>
          <div className="stat">{fmtUsd(plan.expectedNightlyUsd)}</div>
          <div className="meta" style={{ marginTop: 8 }}>
            14-night mean · {fmtUsd(plan.expectedPerAccountUsd)} per account · {plan.activeAccounts} active
          </div>
        </div>
        <div className={low ? "card danger" : "card"}>
          <p className="kicker">Runway</p>
          <div className="stat">{runway === null ? "—" : `${runway.toFixed(0)} d`}</div>
          <div className="meta" style={{ marginTop: 8 }}>
            {s.anthropicBalanceUsd === null
              ? "record a balance below to see this"
              : runway === null
                ? "nothing is being spent"
                : `runs out around ${fmtDateTime(plan.runwayUntil)} · warns at ${s.warnDays} d`}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Anthropic credit balance</p>
        <p className="muted" style={{ fontSize: 13 }}>
          This is typed in, not fetched, and that is not an oversight. Anthropic publishes no credit-balance endpoint:
          the Usage and Cost Admin API reports historical usage and spend only, and it is unavailable to individual
          accounts in any case. So read the remaining credit off{" "}
          <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer">Console → Billing</a> and
          record it here. Everything above is computed from our own <code>run_costs</code>, which has the advantage of
          being attributable per account. Recording a new balance resets the warning clock.
        </p>
        <form action="/admin/api/ops/balance" method="post" className="stack">
          <div className="grid three">
            <div className="field">
              <label htmlFor="balance">Credit remaining (USD)</label>
              <input id="balance" name="balance" type="number" className="mono" min={0} step={0.01} defaultValue={s.anthropicBalanceUsd ?? ""} placeholder="e.g. 42.50" />
              <div className="hint">{s.balanceAsOf ? `last recorded ${fmtDateTime(s.balanceAsOf)}` : "never recorded"}</div>
            </div>
            <div className="field">
              <label htmlFor="warnDays">Warn at (days of runway)</label>
              <input id="warnDays" name="warnDays" type="number" className="mono" min={1} max={365} step={1} defaultValue={s.warnDays} />
              <div className="hint">1 to 365</div>
            </div>
            <div className="field">
              <label htmlFor="warnEmail">Warning goes to</label>
              <input id="warnEmail" type="text" className="mono" value={s.warnEmail} readOnly disabled />
              <div className="hint">{s.lastWarnedAt ? `last warned ${fmtDateTime(s.lastWarnedAt)}` : "not warned yet"}</div>
            </div>
          </div>
          <div className="row"><button type="submit">Record balance</button></div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <p className="kicker">Spend per day · last 30 days</p>
        {plan.days.length === 0 ? (
          <p className="muted">No decode costs recorded yet.</p>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120, marginTop: 12 }}>
            {[...plan.days].reverse().map((d) => (
              <div
                key={d.day}
                title={`${d.day} · ${fmtUsd(d.usd)}`}
                style={{
                  flex: 1,
                  minWidth: 4,
                  height: `${Math.max(2, (d.usd / peak) * 100)}%`,
                  background: "var(--gold, #C9973F)",
                  borderRadius: "2px 2px 0 0",
                }}
              />
            ))}
          </div>
        )}
        <div className="meta" style={{ marginTop: 8 }}>
          Projected month at the current nightly mean: {fmtUsd(plan.projectedMonthUsd)}
        </div>
      </div>

      <div className="card table-wrap" style={{ padding: 16 }}>
        <p className="kicker">Where the tokens went · last 30 days</p>
        <table>
          <thead>
            <tr><th>Model</th><th>Mode</th><th>Pages</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>USD</th></tr>
          </thead>
          <tbody>
            {plan.byModel.map((m) => (
              <tr key={`${m.model}|${m.mode}`}>
                <td className="mono">{m.model}</td>
                <td>{m.mode}</td>
                <td className="mono">{m.pages}</td>
                <td className="mono">{tokens(m.inputTokens)}</td>
                <td className="mono">{tokens(m.outputTokens)}</td>
                <td className="mono">{tokens(m.cacheReadTokens)}</td>
                <td className="mono">{tokens(m.cacheWriteTokens)}</td>
                <td>{fmtUsd(m.usd)}</td>
              </tr>
            ))}
            {plan.byModel.length === 0 ? <tr><td colSpan={8} className="muted">Nothing decoded in the last 30 days.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
