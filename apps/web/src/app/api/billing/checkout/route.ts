import { publicUrl } from "@/lib/hosts";
import { getSessionUser } from "@/server/auth";
import { billingConfigured, createCheckoutSession, isPlan } from "@/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens a Stripe Checkout Session and sends the browser to it.
 *
 * A plain form post, so the button works before any JavaScript has loaded, and a redirect rather
 * than a JSON payload, so the card is typed on Stripe's page and never passes through here.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  const back = (message: string) => Response.redirect(new URL(`/billing?error=${encodeURIComponent(message)}`, publicUrl()), 303);

  if (!user) return Response.redirect(new URL("/login", publicUrl()), 303);
  if (!billingConfigured()) return back("Billing is not switched on for this installation.");

  const form = await req.formData();
  const plan = String(form.get("plan") ?? "");
  if (!isPlan(plan)) return back("Choose a plan.");

  try {
    const url = await createCheckoutSession(user, plan);
    return Response.redirect(url, 303);
  } catch (err) {
    // The message names the Stripe failure, never the key and never anything the customer typed.
    console.error(`[billing] could not open checkout for ${user.id}: ${(err as Error).message}`);
    return back("Could not reach Stripe just now. Nothing was charged; please try again.");
  }
}
