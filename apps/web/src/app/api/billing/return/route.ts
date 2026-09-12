import { publicUrl, serviceUrl } from "@/lib/hosts";
import { getSessionUser } from "@/server/auth";
import { applyCheckoutSession } from "@/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Stripe sends the customer once the card clears.
 *
 * It exists because the browser comes back faster than the webhook does. Sending them straight
 * to /setup meant the guard there still saw an account with no subscription and bounced them to
 * the offer they had just paid for. So the subscription is fetched and written here first, and
 * only then are they let through.
 *
 * The webhook still arrives and writes the same thing, which changes nothing: both apply the
 * state Stripe describes rather than adjusting what is stored.
 */
export async function GET(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.redirect(new URL("/login", publicUrl()), 303);

  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (sessionId) {
    try {
      await applyCheckoutSession(sessionId, user.id);
    } catch (err) {
      // Not fatal. The webhook is the reliable path; this one only saves the customer a wait.
      console.error(`[billing] could not settle checkout on return for ${user.id}: ${(err as Error).message}`);
    }
  }
  return Response.redirect(new URL("/setup?checkout=done", serviceUrl()), 303);
}
