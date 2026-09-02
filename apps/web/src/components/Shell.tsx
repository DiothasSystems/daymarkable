import Link from "next/link";
import { getSessionUser } from "@/server/auth";
import { NavLinks } from "./NavLinks";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="beacon" aria-hidden />
          dayMarkable
        </Link>
        {user ? <NavLinks /> : null}
      </header>
      <main>{children}</main>
      <div className="footer">Write it down. Wake up organized.</div>
    </div>
  );
}
