import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime } from "@/lib/format";
import { REQUEST_STATUSES, listRequests } from "@/server/admin";
import { requireAdmin } from "@/server/admin-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Requests" };

const KIND: Record<string, string> = {
  feature: "Feature",
  document_format: "Page / format",
  bug: "Broken",
  other: "Other",
};

export default async function AdminRequests({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const session = await requireAdmin();
  const { error, saved } = await searchParams;
  const rows = await listRequests();
  const open = rows.filter((r) => r.status === "new").length;

  return (
    <AdminShell session={session} wide>
      <p className="kicker">Requests</p>
      <h1>What customers have asked for.</h1>
      {error ? <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div> : null}
      {saved ? <div className="notice ok" style={{ marginBottom: 16 }}>Updated.</div> : null}
      <p className="muted" style={{ fontSize: 13 }}>
        Kept in the customer&apos;s own words — the wording is the point, since &ldquo;a week on one page with the
        actions down the side&rdquo; is a layout and a summary of it is not. {open} awaiting a decision.
      </p>

      <div className="stack">
        {rows.map((r) => (
          <div className="card" key={r.id}>
            <div className="row between">
              <div className="row">
                <span className="badge">{KIND[r.kind] ?? r.kind}</span>
                <span className={`badge ${r.status === "new" ? "warn" : r.status === "shipped" ? "ok" : ""}`}>{r.status}</span>
                <Link href={`/admin/users/${r.userId}`}>{r.email}</Link>
              </div>
              <span className="meta">{fmtDateTime(r.createdAt)}</span>
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: "10px 0" }}>{r.body}</p>
            {r.adminNote ? <p className="meta">note: {r.adminNote}</p> : null}
            <form action={`/admin/api/requests/${r.id}`} method="post" className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`status-${r.id}`}>Status</label>
                <select id={`status-${r.id}`} name="status" defaultValue={r.status}>
                  {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor={`note-${r.id}`}>Note (operator only)</label>
                <input id={`note-${r.id}`} name="note" type="text" defaultValue={r.adminNote ?? ""} placeholder="why, or what it became" />
              </div>
              <button type="submit" className="small">Save</button>
            </form>
          </div>
        ))}
        {rows.length === 0 ? <div className="card muted">No requests yet.</div> : null}
      </div>
    </AdminShell>
  );
}
