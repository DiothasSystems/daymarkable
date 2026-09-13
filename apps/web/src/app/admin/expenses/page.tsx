import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { fmtUsd } from "@/lib/format";
import { requireAdmin } from "@/server/admin-guard";
import { monthlyRecognizedUsd } from "@/server/finance-core";
import { expenseSummary } from "@/server/ops";
import { isPlan } from "@/server/billing-core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Expenses" };

const LABEL: Record<string, string> = { week: "Last 7 days", month: "Last 30 days", quarter: "Last 91 days", year: "Last 365 days" };

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export default async function AdminExpenses() {
  const session = await requireAdmin();
  const e = await expenseSummary();
  const totalTokens = e.byModel.reduce((n, m) => n + m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens, 0);
  const monthUsd = e.periods.find((p) => p.period === "month")?.usd ?? 0;

  return (
    <AdminShell session={session}>
      <p className="kicker">Expenses</p>
      <h1>Token spend, in dollars.</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Every run records input, output and cache tokens with a dollar cost per model per stage, so these are our own
        figures rather than a reconciliation against Anthropic's invoice. Batch runs are already halved and 1h cache
        writes are already priced at 2x input, so the totals here are what the nights actually cost.
      </p>

      <div className="grid three" style={{ marginBottom: 24 }}>
        {e.periods.slice(0, 3).map((p) => (
          <div className="card" key={p.period}>
            <p className="kicker">{LABEL[p.period]}</p>
            <div className="stat">{fmtUsd(p.usd)}</div>
          </div>
        ))}
      </div>

      <div className="card table-wrap" style={{ padding: 16, marginBottom: 24 }}>
        <p className="kicker">By model · last 30 days · {tokens(totalTokens)} tokens</p>
        <table>
          <thead>
            <tr><th>Model</th><th>Mode</th><th>Pages</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>USD</th><th>$ / page</th></tr>
          </thead>
          <tbody>
            {e.byModel.map((m) => (
              <tr key={`${m.model}|${m.mode}`}>
                <td className="mono">{m.model}</td>
                <td>{m.mode}</td>
                <td className="mono">{m.pages}</td>
                <td className="mono">{tokens(m.inputTokens)}</td>
                <td className="mono">{tokens(m.outputTokens)}</td>
                <td className="mono">{tokens(m.cacheReadTokens)}</td>
                <td className="mono">{tokens(m.cacheWriteTokens)}</td>
                <td>{fmtUsd(m.usd)}</td>
                <td className="mono">{m.pages > 0 ? fmtUsd(m.usd / m.pages) : "—"}</td>
              </tr>
            ))}
            {e.byModel.length === 0 ? <tr><td colSpan={9} className="muted">Nothing decoded in the last 30 days.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap" style={{ padding: 16 }}>
        <p className="kicker">By account · this month · {fmtUsd(monthUsd)} total</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Margin is what that account pays us this month less what its pages cost to read. Negative is the number worth
          knowing: a heavy writer on the monthly plan can cost more to serve than they pay, and nothing else here says so.
        </p>
        <table>
          <thead><tr><th>Account</th><th>Plan</th><th>Pages</th><th>Token cost</th><th>Pays / month</th><th>Margin</th></tr></thead>
          <tbody>
            {e.byUser.map((u) => {
              const pays = isPlan(u.plan) ? monthlyRecognizedUsd(u.plan) : 0;
              const margin = pays - u.usd;
              return (
                <tr key={u.userId}>
                  <td><Link href={`/admin/users/${u.userId}`}>{u.email}</Link></td>
                  <td>{u.plan ?? <span className="meta">none</span>}</td>
                  <td className="mono">{u.pages}</td>
                  <td>{fmtUsd(u.usd)}</td>
                  <td>{pays > 0 ? fmtUsd(pays) : <span className="meta">—</span>}</td>
                  <td style={pays > 0 && margin < 0 ? { color: "#8a2b2b", fontWeight: 600 } : undefined}>
                    {pays > 0 ? fmtUsd(margin) : <span className="meta">not paying</span>}
                  </td>
                </tr>
              );
            })}
            {e.byUser.length === 0 ? <tr><td colSpan={6} className="muted">No spend this month.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
