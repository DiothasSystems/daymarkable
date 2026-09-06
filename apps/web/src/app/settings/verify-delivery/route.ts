import { verifyDeliveryEmail } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The link in the confirmation email. Deliberately NOT behind the session guard: it is opened
 * from a mailbox, which may not be the browser the user is signed in on. The single-use,
 * expiring token is the proof — of the address, not of the person.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const ok = token ? await verifyDeliveryEmail(token) : false;
  return Response.redirect(new URL(ok ? "/account?delivery=confirmed" : "/account?delivery=expired", req.url), 303);
}
