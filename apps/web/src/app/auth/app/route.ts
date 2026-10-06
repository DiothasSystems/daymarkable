import { publicUrl } from "@/lib/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sign-in link mailed to someone signing in from the PHONE APP.
 *
 * It differs from the web's link only in its path, and the path is the point: Android hands links
 * under /auth/app to the installed ScriptumIQ app (an App Link, verified by
 * /.well-known/assetlinks.json), so tapping it on the phone opens the app, which spends the token and
 * finishes signing itself in. A web sign-in keeps /auth/verify and so keeps opening in the browser —
 * claiming every /auth link would drag a browser sign-in into the app.
 *
 * Opened anywhere else — a laptop, a phone without the app — it is simply /auth/verify: a session is
 * still created in exactly one place, from exactly one kind of link (rule 18), and the waiting app
 * picks it up as before.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return Response.redirect(`${publicUrl()}/auth/verify?token=${encodeURIComponent(token)}`, 307);
}
