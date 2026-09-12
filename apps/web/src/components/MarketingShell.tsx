import Link from "next/link";
import { serviceUrl } from "@/lib/hosts";
import { getSessionUser } from "@/server/auth";
import { CompassRose, Wordmark } from "./Brand";
import "./marketing.css";

/**
 * The public site's frame: emblem + wordmark, section links, and either "Start free" or
 * "Open dayMarkable" depending on whether a session exists. Signed-in pages use Shell.
 */
export async function MarketingShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="shell mk">
      <header className="topbar mk-topbar">
        <Link href="/" className="brand" aria-label="dayMarkable home">
          <img src="/brand/emblem-96.png" alt="" width={40} height={40} className="mk-emblem" />
          <Wordmark size={22} />
        </Link>
        <nav className="nav mk-nav" aria-label="Site">
          <Link href="/#how">How it works</Link>
          <Link href="/#pages">Your pages</Link>
          <Link href="/product">Product</Link>
          <Link href="/remarkable">The tablet</Link>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <div className="mk-actions">
          {user ? (
            <>
              <span className="mk-who" title={`Signed in as ${user.email}`}>{user.email}</span>
              <form action="/auth/logout" method="post">
                <button type="submit" className="acct-out">Sign out</button>
              </form>
              <a href={`${serviceUrl()}/today`} className="btn small">Open dayMarkable</a>
            </>
          ) : (
            <>
              <Link href="/start" className="btn secondary small mk-start">Start free</Link>
              <Link href="/login" className="btn small">Login</Link>
            </>
          )}
        </div>
      </header>
      <main className="mk-main">{children}</main>
      <footer className="mk-footer">
        <div className="mk-footer-inner">
          <div className="brand">
            <CompassRose size={24} color="#b8862f" />
            <Wordmark size={16} />
          </div>
          <nav className="mk-footer-links" aria-label="Legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/support">Support</Link>
          </nav>
          <span className="mk-footer-note">© 2026 dayMarkable · Not affiliated with reMarkable AS</span>
        </div>
      </footer>
    </div>
  );
}
