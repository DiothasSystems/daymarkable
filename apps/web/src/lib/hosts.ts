/**
 * One Next.js server, two hostnames.
 *
 *   APP_URL      https://daymarkable.com      the public site: marketing, sign-in, registration,
 *                                             and (Phase 2) every payment page
 *   SERVICE_URL  https://app.daymarkable.com  the signed-in service: Today, documents, runs,
 *                                             account settings, setup, admin
 *
 * When SERVICE_URL is unset both live on APP_URL (local development). This module is pure so
 * proxy.ts, route handlers, and server components can all share the same rules.
 */

const strip = (u: string) => u.replace(/\/$/, "");

export function publicUrl(): string {
  return strip(process.env.APP_URL || "http://localhost:3000");
}

export function serviceUrl(): string {
  return strip(process.env.SERVICE_URL || publicUrl());
}

export function splitHosts(): boolean {
  return new URL(publicUrl()).host !== new URL(serviceUrl()).host;
}

/**
 * The session cookie must be readable on both hosts, so it is scoped to their common parent
 * domain (daymarkable.com). Undefined means a host-only cookie: local dev, or hosts that share
 * no registrable domain (then the sign-in would not carry over, which the deploy docs forbid).
 */
export function sessionCookieDomain(): string | undefined {
  if (!splitHosts()) return undefined;
  const a = new URL(publicUrl()).hostname.split(".");
  const b = new URL(serviceUrl()).hostname.split(".");
  const suffix: string[] = [];
  while (a.length && b.length && a[a.length - 1] === b[b.length - 1]) {
    suffix.unshift(a.pop()!);
    b.pop();
  }
  return suffix.length >= 2 ? suffix.join(".") : undefined;
}

/** Paths that belong to the signed-in service host. */
const SERVICE_PREFIXES = ["/today", "/documents", "/runs", "/account", "/setup", "/settings", "/admin", "/api/documents", "/api/compare"];
/** Paths that belong to the public host. "/" is public too (exact match). */
const PUBLIC_PREFIXES = ["/product", "/remarkable", "/pricing", "/start", "/privacy", "/terms", "/support", "/login"];

const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(p + "/"));

export function isServicePath(path: string): boolean {
  return under(path, SERVICE_PREFIXES);
}

export function isPublicPath(path: string): boolean {
  return path === "/" || under(path, PUBLIC_PREFIXES);
}

/**
 * Where a request must go, or null to serve it here. `host` is the request's Host header.
 * Anything not claimed by either list (/auth/*, /api/trpc, assets) is served on both hosts.
 */
export function crossHostRedirect(host: string, path: string, search: string, pub = publicUrl(), svc = serviceUrl()): string | null {
  const pubHost = new URL(pub).host;
  const svcHost = new URL(svc).host;
  if (pubHost === svcHost) return null;
  if (host === svcHost) {
    if (path === "/") return `${svc}/today`;
    if (isPublicPath(path)) return `${pub}${path}${search}`;
    return null;
  }
  if (host === pubHost && isServicePath(path)) return `${svc}${path}${search}`;
  return null;
}
