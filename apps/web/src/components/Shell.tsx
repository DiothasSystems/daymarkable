import Link from "next/link";
import { publicUrl } from "@/lib/hosts";
import { getSessionUser } from "@/server/auth";
import { accountBadge } from "@/server/billing-core";
import { lastSyncLabel } from "@/server/services";
import { CompassRose, Wordmark } from "./Brand";
import { NavLinks } from "./NavLinks";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const synced = user ? await lastSyncLabel(user.id) : null;
  const badge = user ? accountBadge(user) : null;
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
        {/*
          Which account this is, and what is happening to it. Signing in is by emailed link and
          the session lasts a month, so without this there is nothing on screen saying which of
          your addresses you are looking at, or that a trial is three days from its first charge.
        */}
        {user ? (
          <div className="acct">
            <Link href="/account" className="acct-who" title={`Signed in as ${user.email}`}>
              <span className="acct-email">{user.email}</span>
              {badge ? <span className={`badge ${badge.tone}`}>{badge.text}</span> : null}
            </Link>
            {/* A post, not a link: a sign-out on a GET can be fired by a prefetch or an image. */}
            <form action="/auth/logout" method="post">
              <button type="submit" className="acct-out">Sign out</button>
            </form>
          </div>
        ) : null}
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
