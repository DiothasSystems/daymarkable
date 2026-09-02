import Link from "next/link";
import { CompassRose, Wordmark } from "./Brand";
import { AdminNav } from "./AdminNav";

export function AdminShell({ children, session }: { children: React.ReactNode; session: { loginId: string; expiresAt: Date } | null }) {
  return (
    <div className="shell">
      <header className="topbar admin-bar on-dark">
        <Link href="/admin" className="brand" aria-label="dayMarkable admin">
          <CompassRose size={28} />
          <Wordmark size={20} />
          <span className="admin-tag">ADMIN</span>
        </Link>
        {session ? <AdminNav /> : null}
        {session ? (
          <form action="/admin/api/logout" method="post" style={{ marginLeft: 8 }}>
            <button className="small secondary on-dark-btn" type="submit" title={`Session ends ${session.expiresAt.toLocaleTimeString()}`}>Sign out</button>
          </form>
        ) : null}
      </header>
      <main>{children}</main>
      <div className="footer">OPERATOR PORTAL · EVERY ACTION IS WRITTEN TO THE AUDIT LOG · SESSIONS EXPIRE AFTER 60 MINUTES</div>
    </div>
  );
}
