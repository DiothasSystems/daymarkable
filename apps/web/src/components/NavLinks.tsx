"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/documents", label: "Documents" },
  { href: "/runs", label: "Runs" },
  { href: "/account", label: "Account" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href || (l.href !== "/" && path.startsWith(l.href)) ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
