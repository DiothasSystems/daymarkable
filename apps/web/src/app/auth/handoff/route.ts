/**
 * Where the app's WebView lands: redeem a one-time ticket, set the session cookie, go to the page.
 *
 * The ticket stands for a session that already exists — nothing is created here, and no new way
 * to sign in is opened. See server/handoff.ts for why the app cannot simply carry its bearer into
 * a WebView.
 */
import { cookies } from "next/headers";
import { publicUrl } from "@/lib/hosts";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { isPane, paneUrl, redeemHandoff } from "@/server/handoff";
import { getRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const pane = url.searchParams.get("pane");
  if (!token || !isPane(pane)) return Response.redirect(`${publicUrl()}/login`, 303);

  const rt = await getRuntime();
  const sessionId = await redeemHandoff(rt.db, token);
  // Spent, expired, or pointing at a session that has since ended. Say nothing about which.
  if (!sessionId) return Response.redirect(`${publicUrl()}/login?expired=1`, 303);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionId, sessionCookieOptions());
  return Response.redirect(paneUrl(pane), 303);
}
