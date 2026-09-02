import { verifyMagicLink } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Magic-link landing: verify, set the session cookie (route handlers may), redirect. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const user = token ? await verifyMagicLink(token) : null;
  const to = user ? (user.onboardedAt ? "/" : "/setup") : "/login?expired=1";
  return Response.redirect(new URL(to, req.url), 303);
}
