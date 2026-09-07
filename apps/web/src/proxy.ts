import { NextResponse, type NextRequest } from "next/server";
import { crossHostRedirect, splitHosts } from "@/lib/hosts";

/**
 * Keeps the public site on APP_URL and the signed-in service on SERVICE_URL (see lib/hosts.ts).
 * A request for the wrong host is redirected, path and query intact, so bookmarks, emails, and
 * the sign-in flow all land in the right place. With a single host this is a no-op.
 */
export function proxy(req: NextRequest) {
  if (!splitHosts()) return NextResponse.next();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const to = crossHostRedirect(host.split(",")[0]!.trim(), req.nextUrl.pathname, req.nextUrl.search);
  return to ? NextResponse.redirect(to, 307) : NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets (they are served on both hosts).
  matcher: ["/((?!_next/|hero/|brand/|icon\\.svg|favicon\\.ico).*)"],
};
