/**
 * Billing rules with no I/O in them, so they can be tested without Stripe and without a database.
 * The HTTP calls live in billing.ts; everything that decides something lives here.
 *
 * Rule 14: all payment processing happens in apps/web. Nothing in packages/ knows Stripe exists.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Fourteen free nights, then the card on file is charged. Stated on /pricing and in the terms. */
export const TRIAL_DAYS = 14;

/**
 * Prices are found by lookup key rather than id. A sandbox and the live account can carry the
 * same key, so one build works against either with nothing to configure per environment. Prices
 * are immutable once used, so a change of amount means a new key ending _v2, never an edit.
 */
export const PRICE_LOOKUP = {
  monthly: "daymarkable_monthly_v1",
  annual: "daymarkable_annual_v1",
} as const;

export type Plan = keyof typeof PRICE_LOOKUP;

export function isPlan(v: unknown): v is Plan {
  return v === "monthly" || v === "annual";
}

/** What the customer sees on /pricing, kept here so the two cannot drift apart silently. */
export const PLAN_COPY: Record<Plan, { label: string; price: string; amount: string; note: string }> = {
  monthly: { label: "Monthly", price: "$10 / month", amount: "$10", note: "Billed monthly. Cancel anytime." },
  annual: { label: "Annual", price: "$100 / year", amount: "$100", note: "Two months free. Same plan, same everything." },
};

/** Every state a Stripe subscription can be in. */
export type StripeStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type AccountStatus = "trial" | "active" | "past_due" | "canceled";

/**
 * Stripe's vocabulary is wider than ours. `unpaid` and `paused` should never arrive, because the
 * sandbox and live settings both cancel once retries are exhausted and no trial is set to pause,
 * but they are mapped rather than ignored so an unexpected one cannot leave an account reading
 * active while Stripe believes otherwise.
 */
export function accountStatusFor(status: string): AccountStatus {
  switch (status) {
    case "trialing":
      return "trial";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "past_due";
  }
}

/**
 * Whether the nightly run should happen. Service continues while Stripe retries a failed card,
 * because a card expiring is not a decision to leave, and stops when the subscription is gone.
 */
export function serviceActive(status: AccountStatus): boolean {
  return status === "trial" || status === "active" || status === "past_due";
}

export interface BillingUser {
  email: string;
  status: AccountStatus | "deleted";
  stripeSubscriptionId: string | null;
}

/**
 * How many trial days this account gets, or null for none.
 *
 * A trial is once per account, ever. Without that, cancelling and subscribing again buys
 * another fourteen free nights, and repeating it buys the product for nothing. So the second
 * subscription starts billing immediately, which is also what the terms describe.
 */
export function trialDaysFor(user: { trialUsedAt: Date | null }): number | null {
  return user.trialUsedAt ? null : TRIAL_DAYS;
}

/** The subscription states that mean an account is live and must not buy a second one. */
export function isLiveStripeStatus(status: string): boolean {
  return status === "trialing" || status === "active" || status === "past_due" || status === "unpaid";
}

/**
 * Whether this account still has to pass through checkout.
 *
 * The Phase 0 owner never does: that account predates billing, pays nothing, and would otherwise
 * be locked out of their own service by a missing card. Everyone else needs a subscription that
 * Stripe has confirmed, which is what having a subscription id means.
 */
export function needsCheckout(user: BillingUser, ownerEmail: string | undefined, billingConfigured: boolean): boolean {
  if (!billingConfigured) return false;
  const owner = (ownerEmail ?? "").trim().toLowerCase();
  if (owner && owner === user.email.trim().toLowerCase()) return false;
  if (user.status === "canceled" || user.status === "deleted") return true;
  return !user.stripeSubscriptionId;
}

/**
 * Stripe wants form encoding with bracketed paths, so `{ a: { b: 1 } }` goes out as `a[b]=1`.
 * Undefined and null are dropped rather than sent as the strings "undefined" and "null", which
 * Stripe would accept and then behave surprisingly about.
 */
export function stripeForm(params: Record<string, unknown>): string {
  const pairs: [string, string][] = [];
  const walk = (value: unknown, key: string): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${key}[${i}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, key ? `${key}[${k}]` : k);
      return;
    }
    pairs.push([key, String(value)]);
  };
  walk(params, "");
  return new URLSearchParams(pairs).toString();
}

/** Five minutes, matching Stripe's own guidance for how stale a delivery may be. */
export const SIGNATURE_TOLERANCE_SEC = 300;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Verify a webhook came from Stripe and not from someone who found the URL.
 *
 * The header carries a timestamp and one or more signatures; each is an HMAC of
 * `timestamp.body` under the endpoint's signing secret. The body must be the bytes as received,
 * because re-serialising the JSON changes it and the signature will not match.
 *
 * Both checks matter. Without the signature anyone can post an event saying an account is paid.
 * Without the timestamp a signature captured once could be replayed forever.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSec: number = SIGNATURE_TOLERANCE_SEC,
): SignatureCheck {
  if (!header) return { ok: false, reason: "no signature header" };
  if (!secret) return { ok: false, reason: "no signing secret configured" };

  let timestamp = "";
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1") candidates.push(v);
  }
  if (!timestamp || candidates.length === 0) return { ok: false, reason: "malformed signature header" };

  const sentSec = Number(timestamp);
  if (!Number.isFinite(sentSec)) return { ok: false, reason: "malformed timestamp" };
  if (Math.abs(nowMs / 1000 - sentSec) > toleranceSec) return { ok: false, reason: "timestamp outside tolerance" };

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  for (const candidate of candidates) {
    let given: Buffer;
    try {
      given = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "no signature matched" };
}

/** Seconds from Stripe to a Date, for the several timestamps an event carries. */
export function stripeDate(seconds: unknown): Date | null {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}
