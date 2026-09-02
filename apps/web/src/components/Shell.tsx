import Link from "next/link";
import { getSessionUser } from "@/server/auth";
import { lastSyncLabel } from "@/server/services";
import { CompassRose, Wordmark } from "./Brand";
import { NavLinks } from "./NavLinks";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const synced = user ? await lastSyncLabel(user.id) : null;
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="dayMarkable home">
          <CompassRose size={28} />
          <Wordmark size={20} />
        </Link>
        {user ? <NavLinks /> : null}
        {synced ? <span className="synced">{synced}</span> : null}
      </header>
      <main>{children}</main>
      <div className="footer">
        © 2026 dayMarkable · NOT AFFILIATED WITH reMARKABLE AS
        <span>·</span>
        <Link href="/account">Privacy</Link>
      </div>
    </div>
  );
}
