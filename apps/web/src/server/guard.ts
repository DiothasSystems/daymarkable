import "server-only";
import { redirect } from "next/navigation";
import { publicUrl } from "@/lib/hosts";
import { getSessionUser, type SessionUser } from "./auth";
import { billingConfigured, ownerEmail } from "./billing";
import { needsCheckout } from "./billing-core";

/**
 * Server-component guard: signed in, then paid for, then onboarded.
 *
 * Billing comes before onboarding because there is no point pairing a tablet for an account that
 * has not started a subscription. It is skipped entirely while Stripe is unconfigured, which is
 * every Phase 0 install, and for the operator's own address, which would otherwise be locked out
 * of its own service. Checkout is a payment page, so it lives on the public host.
 */
export async function requireUser(options: { allowUnboarded?: boolean; allowUnpaid?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!options.allowUnpaid && needsCheckout(user, ownerEmail(), billingConfigured())) redirect(`${publicUrl()}/billing`);
  if (!user.onboardedAt && !options.allowUnboarded) redirect("/setup");
  return user;
}
