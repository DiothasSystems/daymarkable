import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime } from "@/lib/format";
import { auditLog } from "@/server/admin";
import { requireAdmin } from "@/server/admin-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Audit log" };

export default async function AdminAudit() {
  const session = await requireAdmin();
  const rows = await auditLog(300);
  return (
    <AdminShell session={session}>
      <p className="kicker">Audit log</p>
      <h1>Every admin action</h1>
      <p className="muted">Append-only. Logins, failed logins, lockouts, and destructive actions land here; nothing in the code can edit or remove a row.</p>
      <div className="card table-wrap" style={{ padding: 16 }}>
        <table>
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target user</th><th>IP</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="meta" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.createdAt)}</td>
                <td>{a.adminLoginId}</td>
                <td><strong>{a.action}</strong></td>
                <td className="mono">{a.targetUserId ? a.targetUserId.slice(0, 8) : "—"}</td>
                <td className="mono">{a.ip ?? "—"}</td>
                <td className="mono" style={{ fontSize: 12 }}>{a.detail ? JSON.stringify(a.detail) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="muted">Nothing yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
