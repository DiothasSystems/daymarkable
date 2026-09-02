"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Admin">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href || (l.href !== "/admin" && path.startsWith(l.href)) ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
