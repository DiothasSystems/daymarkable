import { AdminShell } from "@/components/AdminShell";
import { fmtDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/admin-guard";
import { listWaitlist, waitlistCounts } from "@/server/waitlist";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Waiting list" };

/**
 * Who is waiting, and the one button that lets them in. Inviting an address is what makes the
 * sign-in guard accept it, so this page is the door to the whole product.
 */
export default async function AdminWaitlist({ searchParams }: { searchParams: Promise<{ invited?: string; error?: string }> }) {
  const session = await requireAdmin();
  const [rows, counts] = await Promise.all([listWaitlist(), waitlistCounts()]);
  const { invited, error } = await searchParams;

  return (
    <AdminShell session={session}>
      <p className="kicker">Waiting list</p>
      <h1>Who gets in</h1>
      <p className="muted">
        Registration is closed, so an address can only open an account once it is invited here. The invitation carries no token: it
        points at the sign-in page, and they still have to prove they hold the mailbox.
      </p>

      {invited ? <div className="notice ok" style={{ marginBottom: 18 }}>Invited {invited}. They can sign in now.</div> : null}
      {error ? <div className="notice bad" style={{ marginBottom: 18 }}>{error}</div> : null}

      <div className="grid three" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="kicker">Waiting</p>
          <div className="stat">{counts.waiting}</div>
        </div>
        <div className="card">
          <p className="kicker">Invited, not yet in</p>
          <div className="stat">{counts.invited}</div>
        </div>
        <div className="card">
          <p className="kicker">Signed up</p>
          <div className="stat">{counts.joined}</div>
        </div>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Nobody has asked yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>State</th>
                  <th>Asked</th>
                  <th>Invited</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.email}</td>
                    <td>
                      <span className={`badge ${r.state === "joined" ? "ok" : r.state === "invited" ? "warn" : ""}`}>{r.state}</span>
                    </td>
                    <td className="meta">{fmtDateTime(r.createdAt)}</td>
                    <td className="meta">{r.invitedAt ? fmtDateTime(r.invitedAt) : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.state === "joined" ? null : (
                        <form method="post" action={`/admin/api/waitlist/${r.id}/invite`}>
                          <button type="submit" className="secondary small">
                            {r.state === "invited" ? "Send again" : "Invite"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
