import { AdminShell } from "@/components/AdminShell";
import { fmtUsd } from "@/lib/format";
import { requireAdmin } from "@/server/admin-guard";
import { marginPct, marginUsd, monthlyRecognizedUsd } from "@/server/finance-core";
import { revenueSummary } from "@/server/ops";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Revenue" };

const LABEL: Record<string, string> = { week: "Week", month: "Month", quarter: "Quarter", year: "Year" };

export default async function AdminRevenue() {
  const session = await requireAdmin();
  const r = await revenueSummary();
  const paying = r.subs.monthly + r.subs.annual;
  const month = r.periods.find((p) => p.period === "month")!;
  const margin = marginUsd(month.recognizedUsd, r.monthTokenCostUsd);
  const pct = marginPct(month.recognizedUsd, r.monthTokenCostUsd);

  return (
    <AdminShell session={session}>
      <p className="kicker">Revenue</p>
      <h1>What the subscriptions are worth.</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Recognized revenue spreads an annual plan across the twelve months it covers, so a month with an annual renewal
        in it reads the same as any other month. Billed cash is what Stripe actually charged in the period — over a full
        year the two agree, inside one month they should not. Monthly is {fmtUsd(r.prices.monthly)} and annual{" "}
        {fmtUsd(r.prices.annual)}, which recognizes at {fmtUsd(monthlyRecognizedUsd("annual"))} a month.
      </p>

      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Paying accounts</p>
          <div className="stat">{paying}</div>
          <div className="meta" style={{ marginTop: 8 }}>
            {r.subs.monthly} monthly · {r.subs.annual} annual
            {r.pastDue ? <> · <strong>{r.pastDue} past due</strong></> : null}
          </div>
        </div>
        <div className="card">
          <p className="kicker">Recognized this month</p>
          <div className="stat">{fmtUsd(month.recognizedUsd)}</div>
          <div className="meta" style={{ marginTop: 8 }}>{fmtUsd(month.billedUsd)} billed as cash</div>
        </div>
        <div className={margin < 0 ? "card danger" : "card"}>
          <p className="kicker">Gross margin this month</p>
          <div className="stat">{fmtUsd(margin)}</div>
          <div className="meta" style={{ marginTop: 8 }}>
            {pct === null ? "no revenue yet" : `${pct.toFixed(0)}% after ${fmtUsd(r.monthTokenCostUsd)} of tokens`}
          </div>
        </div>
      </div>

      <div className="card table-wrap" style={{ padding: 16, marginBottom: 24 }}>
        <p className="kicker">By period, at the current subscriber mix</p>
        <table>
          <thead><tr><th>Period</th><th>Recognized</th><th>Billed (cash)</th></tr></thead>
          <tbody>
            {r.periods.map((p) => (
              <tr key={p.period}>
                <td>{LABEL[p.period]}</td>
                <td>{fmtUsd(p.recognizedUsd)}</td>
                <td>{fmtUsd(p.billedUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="meta" style={{ marginTop: 8 }}>
          A run rate, not a forecast: it assumes today's mix holds and nobody churns.
        </div>
      </div>

      <div className="grid three">
        <div className="card"><p className="kicker">In trial</p><div className="stat">{r.trialing}</div><div className="meta" style={{ marginTop: 8 }}>not yet paying</div></div>
        <div className="card"><p className="kicker">Past due</p><div className="stat">{r.pastDue}</div><div className="meta" style={{ marginTop: 8 }}>Stripe could not charge</div></div>
        <div className="card"><p className="kicker">Canceled</p><div className="stat">{r.canceled}</div><div className="meta" style={{ marginTop: 8 }}>churned to date</div></div>
      </div>
    </AdminShell>
  );
}
