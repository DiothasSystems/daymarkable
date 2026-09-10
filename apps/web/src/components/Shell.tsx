import { publicUrl } from "@/lib/hosts";
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
        {/*
          The wordmark leaves the app for the public site, signed in or not. Inside the service
          the nav already carries every destination, so the mark is the way out to daymarkable.com
          rather than a second route to Today. A plain anchor, since this is a cross-host
          navigation when the two hosts are split.
        */}
        <a href={publicUrl()} className="brand" aria-label="dayMarkable — go to daymarkable.com">
          <CompassRose size={28} />
          <Wordmark size={20} />
        </a>
        {user ? <NavLinks /> : null}
        {synced ? <span className="synced">{synced}</span> : null}
      </header>
      <main>{children}</main>
      <div className="footer">
        © 2026 dayMarkable · NOT AFFILIATED WITH reMARKABLE AS
        <span>·</span>
        <a href={`${publicUrl()}/privacy`}>Privacy</a>
      </div>
    </div>
  );
}
