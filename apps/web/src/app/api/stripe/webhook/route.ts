import { handleStripeEvent, readStripeEvent } from "@/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Stripe tells us what happened: a trial started, a card was charged, one failed, someone
 * cancelled. This is the only thing that moves an account between trial, active, past due and
 * canceled, because Stripe is the record and this server is not.
 *
 * The body is read as text and verified before it is parsed. Re-serialising the JSON would change
 * the bytes and break the signature, and an unverified event is just a stranger claiming an
 * account is paid for.
 *
 * A 400 means the body will never be acceptable, so Stripe should stop trying. A 500 means we
 * failed, so Stripe should retry, which is safe because applying an event twice lands on the same
 * state as applying it once.
 */
export async function POST(req: Request): Promise<Response> {
  const payload = await req.text();
  const parsed = readStripeEvent(payload, req.headers.get("stripe-signature"));
  if (!parsed.ok) {
    console.warn(`[billing] rejected a webhook: ${parsed.reason}`);
    return new Response(parsed.reason, { status: 400 });
  }

  try {
    const { handled, type } = await handleStripeEvent(parsed.event);
    // Counts and types only. An event carries a customer's name and address; none of it is logged.
    if (!handled) console.log(`[billing] ignored event type ${type}`);
    return Response.json({ received: true });
  } catch (err) {
    console.error(`[billing] handler failed for ${String(parsed.event.type)}: ${(err as Error).message}`);
    return new Response("handler failed", { status: 500 });
  }
}
