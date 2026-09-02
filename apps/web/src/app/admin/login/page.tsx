import { redirect } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { adminEnabled, getAdminSession } from "@/server/admin";
import { AdminLoginForm } from "./AdminLoginForm";

export const metadata = { title: "Admin sign in" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect("/admin");
  const enabled = adminEnabled();
  return (
    <AdminShell session={null}>
      <div className="card" style={{ maxWidth: 440, margin: "8vh auto 0" }}>
        <p className="kicker">Operator portal</p>
        <h2>Admin sign in</h2>
        <p className="muted" style={{ fontSize: 14 }}>Credentials come from the host's environment (ADMIN_LOGIN_ID and a bcrypt ADMIN_PASSWORD_HASH). This login is separate from user accounts, rate-limited, and every attempt is audited.</p>
        {enabled ? <AdminLoginForm /> : <div className="notice bad">Admin portal is not configured on this host. Set ADMIN_LOGIN_ID and ADMIN_PASSWORD_HASH (bcrypt) in the environment and restart.</div>}
      </div>
    </AdminShell>
  );
}
