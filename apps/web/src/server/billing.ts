import "server-only";
import { eq, schema } from "@daymarkable/db";
import { buildTrialEndingMail } from "@daymarkable/mail";
import { publicUrl, serviceUrl } from "@/lib/hosts";
import {
  accountStatusFor,
  isPlan,
  type Plan,
  PLAN_COPY,
  PRICE_LOOKUP,
  isLiveStripeStatus,
  stripeDate,
  stripeForm,
  trialDaysFor,
  verifyStripeSignature,
} from "./billing-core";
import { getRuntime } from "./runtime";

/**
 * Stripe, over its REST API with fetch, the same way packages/mail talks to Resend. No SDK: the
 * three calls this needs are a form post each, and the webhook signature is an HMAC that
 * node:crypto already does. Everything that decides something lives in billing-core.ts.
 *
 * Rule 14: payments are handled here in apps/web and nowhere else.
 */

const API = "https://api.stripe.com/v1";

export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

/** The address that is exempt from checkout, because it owns the installation. */
export function ownerEmail(): string | undefined {
  return process.env.USER_EMAIL || undefined;
}

async function stripeApi(path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const body = params ? stripeForm(params) : undefined;
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/x-www-form-urlencoded" }),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey.slice(0, 255) } : {}),
    },
    ...(body === undefined ? {} : { body }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error ?? {}) as { message?: string; code?: string };
    // Never log the key, and never log the customer's card details, which Stripe does not return.
    throw new Error(`stripe ${res.status}${err.code ? ` ${err.code}` : ""}: ${err.message ?? "request failed"}`);
  }
  return json;
}

/**
 * Price ids differ between a sandbox and live, so they are looked up by their stable key instead
 * of configured. Cached for the life of the process; a price is immutable once used, so the only
 * way this goes stale is a deploy, which restarts it anyway.
 */
const priceIds = new Map<Plan, string>();

async function priceIdFor(plan: Plan): Promise<string> {
  const cached = priceIds.get(plan);
  if (cached) return cached;
  const lookup = PRICE_LOOKUP[plan];
  const res = await stripeApi(`/prices?lookup_keys[0]=${encodeURIComponent(lookup)}&active=true&limit=1`);
  const first = (res.data as Array<{ id?: string }> | undefined)?.[0];
  if (!first?.id) {
    throw new Error(`no active Stripe price with lookup key "${lookup}". Create it in this environment first.`);
  }
  priceIds.set(plan, first.id);
  return first.id;
}

export interface CheckoutUser {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  trialUsedAt: Date | null;
}

/**
 * A Checkout Session, which is where the card is taken. Hosted by Stripe, so no card details ever
 * reach this server and the page the customer types into is not ours to get wrong.
 *
 * The trial is set here rather than on the price, so support can vary it for one person without
 * touching the catalogue, and it is offered only to an account that has never had one. The card
 * is collected up front and the subscription cancels if it is somehow missing at trial end,
 * which is what the terms promise.
 */
export async function createCheckoutSession(user: CheckoutUser, plan: Plan): Promise<string> {
  const session = await stripeApi(
    "/checkout/sessions",
    {
      mode: "subscription",
      line_items: [{ price: await priceIdFor(plan), quantity: 1 }],
      ...(user.stripeCustomerId ? { customer: user.stripeCustomerId } : { customer_email: user.email }),
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      payment_method_collection: "always",
      subscription_data: {
        // Null for an account that has already had its trial: that one starts paying at once.
        trial_period_days: trialDaysFor(user),
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { user_id: user.id },
      },
      // Not straight to /setup. The browser comes back the instant the card clears, which is
      // usually before the webhook saying the subscription exists, and the guard on /setup would
      // send them back to the offer they had just paid. The return route settles that first.
      success_url: `${serviceUrl()}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl()}/billing?checkout=cancelled`,
    },
    // One session per user per plan per minute: a double-clicked button cannot open two.
    `checkout:${user.id}:${plan}:${Math.floor(Date.now() / 60_000)}`,
  );
  const url = session.url;
  if (typeof url !== "string") throw new Error("Stripe returned a session with no URL");
  return url;
}

// ---------------------------------------------------------------- webhook

type Json = Record<string, unknown>;

function objectOf(event: Json): Json {
  return ((event.data as Json | undefined)?.object as Json | undefined) ?? {};
}

/** The id Stripe gives back for a nested object is either the string or the expanded object. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") return (v as { id: string }).id;
  return null;
}

async function findUserId(subscription: Json): Promise<string | null> {
  const fromMetadata = (subscription.metadata as { user_id?: unknown } | undefined)?.user_id;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  const customer = idOf(subscription.customer);
  if (!customer) return null;
  const rt = await getRuntime();
  const row = await rt.db.query.users.findFirst({ where: eq(schema.users.stripeCustomerId, customer) });
  return row?.id ?? null;
}

function planOf(subscription: Json): Plan | null {
  const item = ((subscription.items as Json | undefined)?.data as Array<Json> | undefined)?.[0];
  const lookup = ((item?.price as Json | undefined)?.lookup_key ?? null) as string | null;
  if (lookup === PRICE_LOOKUP.monthly) return "monthly";
  if (lookup === PRICE_LOOKUP.annual) return "annual";
  const interval = ((item?.price as Json | undefined)?.recurring as Json | undefined)?.interval;
  return interval === "year" ? "annual" : interval === "month" ? "monthly" : null;
}

/** Write what a subscription now says onto the account it belongs to. */
async function applySubscription(subscription: Json): Promise<void> {
  const userId = await findUserId(subscription);
  if (!userId) {
    console.warn("[billing] subscription event with no account to apply it to");
    return;
  }
  const rt = await getRuntime();
  const plan = planOf(subscription);
  const existing = await rt.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  await rt.db
    .update(schema.users)
    .set({
      status: accountStatusFor(String(subscription.status ?? "")),
      stripeSubscriptionId: idOf(subscription.id),
      stripeCustomerId: idOf(subscription.customer),
      ...(plan ? { plan } : {}),
      trialEndsAt: stripeDate(subscription.trial_end),
      // Set the first time a trial is seen and never cleared, so it survives a later
      // subscription that has none. This is what makes a trial once per account.
      ...(subscription.trial_end && !existing?.trialUsedAt ? { trialUsedAt: new Date() } : {}),
      currentPeriodEnd: stripeDate(subscription.current_period_end),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
}

/**
 * Stripe sends this three days before the trial converts, which is the reminder the terms
 * promise. Stripe is the clock here rather than a cron of ours, so the reminder cannot drift
 * away from the charge it is warning about.
 */
async function sendTrialReminder(subscription: Json): Promise<void> {
  const userId = await findUserId(subscription);
  if (!userId) return;
  const rt = await getRuntime();
  const user = await rt.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return;
  const plan = planOf(subscription) ?? (user.plan === "annual" ? "annual" : "monthly");
  const copy = PLAN_COPY[plan];
  await rt.mail.send(
    buildTrialEndingMail(user.email, user.id, {
      planLabel: copy.label,
      amount: copy.amount,
      endsAt: stripeDate(subscription.trial_end),
      accountUrl: `${serviceUrl()}/account`,
      timeZone: user.timezone,
    }),
  );
}

/**
 * Settle the subscription on the way back from checkout, rather than waiting for the webhook.
 *
 * Stripe says to do both: the webhook is the reliable path and this is the immediate one, and
 * since each writes the state Stripe describes rather than adjusting what is stored, whichever
 * arrives second changes nothing. Without this the customer returns before the webhook and the
 * guard sends them back to the offer they have just paid for.
 */
export async function applyCheckoutSession(sessionId: string, userId: string): Promise<boolean> {
  const session = await stripeApi(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[0]=subscription`);
  // A session id is guessable in principle, so it only counts if it says it belongs to this user.
  if (session.client_reference_id !== userId) {
    console.warn("[billing] a checkout session was returned for the wrong account");
    return false;
  }
  const subscription = session.subscription;
  if (!subscription || typeof subscription !== "object") return false;
  await applySubscription(subscription as Json);
  return true;
}

/**
 * The subscription this customer already has, if any. Used before opening checkout, so that a
 * customer who paid but whose return went wrong recovers what they bought instead of buying it
 * a second time.
 */
export async function findLiveSubscription(customerId: string): Promise<Json | null> {
  const res = await stripeApi(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`);
  const list = (res.data as Json[] | undefined) ?? [];
  return list.find((s) => isLiveStripeStatus(String(s.status ?? ""))) ?? null;
}

/** Write a subscription we fetched ourselves onto the account, as the webhook would. */
export async function adoptSubscription(subscription: Json): Promise<void> {
  await applySubscription(subscription);
}

export interface WebhookResult {
  handled: boolean;
  type: string;
}

/**
 * Events are deliberately idempotent: each one writes the state Stripe has just described rather
 * than adjusting what is already stored, so a redelivery, which Stripe does on any non-2xx, lands
 * on the same answer.
 */
export async function handleStripeEvent(event: Json): Promise<WebhookResult> {
  const type = String(event.type ?? "");
  const object = objectOf(event);

  switch (type) {
    case "checkout.session.completed": {
      const userId = (typeof object.client_reference_id === "string" && object.client_reference_id) || null;
      const customer = idOf(object.customer);
      if (userId && customer) {
        const rt = await getRuntime();
        await rt.db.update(schema.users).set({ stripeCustomerId: customer, updatedAt: new Date() }).where(eq(schema.users.id, userId));
      }
      // The subscription events that follow carry the status; this only ties the customer on.
      return { handled: true, type };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(object);
      return { handled: true, type };
    case "customer.subscription.trial_will_end":
      await sendTrialReminder(object);
      return { handled: true, type };
    case "invoice.paid":
    case "invoice.payment_failed": {
      // Status comes from the subscription events; the invoice is fetched only when Stripe has
      // not sent one, which happens if an endpoint was added mid-subscription.
      const subscriptionId = idOf(object.subscription);
      if (subscriptionId) await applySubscription(await stripeApi(`/subscriptions/${subscriptionId}`));
      return { handled: true, type };
    }
    default:
      return { handled: false, type };
  }
}

/** Verify and parse, or say why not. The caller answers 400 so Stripe stops retrying a bad body. */
export function readStripeEvent(payload: string, signature: string | null): { ok: true; event: Json } | { ok: false; reason: string } {
  const check = verifyStripeSignature(payload, signature, process.env.STRIPE_WEBHOOK_SECRET ?? "");
  if (!check.ok) return check;
  try {
    return { ok: true, event: JSON.parse(payload) as Json };
  } catch {
    return { ok: false, reason: "body is not JSON" };
  }
}

export { isPlan };

// ---------------------------------------------------------------- operator actions (admin only)

export interface SubscriptionSnapshot {
  id: string;
  status: string;
  plan: Plan | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** The most recent paid invoice, which is what a prorated refund is taken from. */
  lastPaid: { paymentIntent: string | null; amountUsd: number; refundedUsd: number } | null;
}

/** What the operator screens need to show before offering cancel or refund. */
export async function subscriptionSnapshot(subscriptionId: string): Promise<SubscriptionSnapshot> {
  const sub = (await stripeApi(`/subscriptions/${subscriptionId}`)) as Json;
  const item = ((sub.items as Json | undefined)?.data as Json[] | undefined)?.[0];
  const invoices = (await stripeApi(`/invoices?subscription=${encodeURIComponent(subscriptionId)}&status=paid&limit=1`)) as Json;
  const inv = ((invoices.data as Json[] | undefined) ?? [])[0];
  const paidCents = Number(inv?.amount_paid ?? 0);
  const refundedCents = Number(
    (((inv?.payment_intent as Json | undefined)?.charges as Json | undefined)?.data as Json[] | undefined)?.[0]?.amount_refunded ?? 0,
  );
  return {
    id: String(sub.id),
    status: String(sub.status),
    plan: planOf(sub),
    periodStart: stripeDate((item as Json | undefined)?.current_period_start ?? sub.current_period_start),
    periodEnd: stripeDate((item as Json | undefined)?.current_period_end ?? sub.current_period_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    lastPaid: inv
      ? {
          paymentIntent: typeof inv.payment_intent === "string" ? inv.payment_intent : ((inv.payment_intent as Json | undefined)?.id as string | undefined) ?? null,
          amountUsd: paidCents / 100,
          refundedUsd: refundedCents / 100,
        }
      : null,
  };
}

/**
 * Cancel. At period end by default, which is the honest option: they paid for the period, so they
 * keep it. Immediate is for the case where they want out now and a refund is following.
 */
export async function cancelSubscription(subscriptionId: string, when: "period_end" | "now"): Promise<{ status: string; endsAt: Date | null }> {
  const sub =
    when === "now"
      ? ((await stripeApi(`/subscriptions/${subscriptionId}`, { cancel_at_period_end: "false" }, `cancel-now:${subscriptionId}`)) as Json)
      : ((await stripeApi(`/subscriptions/${subscriptionId}`, { cancel_at_period_end: "true" }, `cancel-end:${subscriptionId}`)) as Json);
  if (when === "now") {
    const gone = (await stripeApi(`/subscriptions/${subscriptionId}/cancel`, {}, `cancel-immediate:${subscriptionId}`)) as Json;
    return { status: String(gone.status), endsAt: stripeDate(gone.canceled_at) };
  }
  const item = ((sub.items as Json | undefined)?.data as Json[] | undefined)?.[0];
  return { status: String(sub.status), endsAt: stripeDate((item as Json | undefined)?.current_period_end ?? sub.current_period_end) };
}

/**
 * Refund an amount against the subscription's most recent paid invoice. The caller computes the
 * amount (finance-core `proratedRefund`) so the arithmetic is testable and the same number can be
 * shown to the operator before they commit to it.
 */
export async function refundAmount(subscriptionId: string, usd: number, reason: string): Promise<{ refundedUsd: number; refundId: string }> {
  const snap = await subscriptionSnapshot(subscriptionId);
  if (!snap.lastPaid?.paymentIntent) throw new Error("no paid invoice on this subscription to refund against");
  const cents = Math.round(usd * 100);
  if (cents <= 0) throw new Error("nothing left to refund for this period");
  const remaining = Math.round((snap.lastPaid.amountUsd - snap.lastPaid.refundedUsd) * 100);
  if (cents > remaining) throw new Error(`refund exceeds what is left on the invoice ($${(remaining / 100).toFixed(2)})`);
  const refund = (await stripeApi(
    "/refunds",
    { payment_intent: snap.lastPaid.paymentIntent, amount: String(cents), reason: "requested_by_customer", "metadata[note]": reason.slice(0, 200) },
    // One refund per subscription per period per amount: a double-click must not pay twice.
    `refund:${subscriptionId}:${snap.periodEnd?.toISOString() ?? "none"}:${cents}`,
  )) as Json;
  return { refundedUsd: Number(refund.amount ?? cents) / 100, refundId: String(refund.id) };
}
