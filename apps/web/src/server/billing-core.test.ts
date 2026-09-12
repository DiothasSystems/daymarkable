import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accountBadge,
  accountStatusFor,
  isLiveStripeStatus,
  needsCheckout,
  serviceActive,
  stripeForm,
  trialDaysFor,
  verifyStripeSignature,
} from "./billing-core";

const SECRET = "whsec_test_secret";

function sign(payload: string, atSec: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${atSec}.${payload}`).digest("hex");
  return `t=${atSec},v1=${v1}`;
}

describe("subscription status", () => {
  it("maps Stripe's vocabulary onto the account statuses the app stores", () => {
    expect(accountStatusFor("trialing")).toBe("trial");
    expect(accountStatusFor("active")).toBe("active");
    expect(accountStatusFor("past_due")).toBe("past_due");
    expect(accountStatusFor("canceled")).toBe("canceled");
    expect(accountStatusFor("incomplete_expired")).toBe("canceled");
  });

  it("never reads an unknown status as paid", () => {
    for (const s of ["unpaid", "paused", "incomplete", "something_new", ""]) {
      expect(accountStatusFor(s)).not.toBe("active");
    }
  });

  it("keeps the nightly run going while a card is being retried, and stops once it is gone", () => {
    expect(serviceActive("trial")).toBe(true);
    expect(serviceActive("active")).toBe(true);
    expect(serviceActive("past_due")).toBe(true);
    expect(serviceActive("canceled")).toBe(false);
  });
});

describe("who has to pass through checkout", () => {
  const stranger = { email: "someone@example.com", status: "trial" as const, stripeSubscriptionId: null };

  it("nobody, while billing is unconfigured", () => {
    expect(needsCheckout(stranger, "jim@example.com", false)).toBe(false);
  });

  it("not the Phase 0 owner, who would otherwise be locked out of their own service", () => {
    expect(needsCheckout({ ...stranger, email: "Jim@Example.com " }, "jim@example.com", true)).toBe(false);
  });

  it("anyone else without a subscription Stripe has confirmed", () => {
    expect(needsCheckout(stranger, "jim@example.com", true)).toBe(true);
    expect(needsCheckout({ ...stranger, stripeSubscriptionId: "sub_1" }, "jim@example.com", true)).toBe(false);
  });

  it("and anyone whose subscription has ended, even though the id is still on the row", () => {
    expect(needsCheckout({ ...stranger, status: "canceled", stripeSubscriptionId: "sub_1" }, "jim@example.com", true)).toBe(true);
  });
});

describe("form encoding", () => {
  it("writes nested parameters the way Stripe reads them", () => {
    const body = stripeForm({
      mode: "subscription",
      line_items: [{ price: "price_1", quantity: 1 }],
      subscription_data: { trial_period_days: 14, metadata: { user_id: "u-1" } },
    });
    const q = new URLSearchParams(body);
    expect(q.get("mode")).toBe("subscription");
    expect(q.get("line_items[0][price]")).toBe("price_1");
    expect(q.get("line_items[0][quantity]")).toBe("1");
    expect(q.get("subscription_data[trial_period_days]")).toBe("14");
    expect(q.get("subscription_data[metadata][user_id]")).toBe("u-1");
  });

  it("drops empty values rather than sending them as the words undefined and null", () => {
    const q = new URLSearchParams(stripeForm({ customer: undefined, customer_email: null, mode: "subscription" }));
    expect(q.has("customer")).toBe(false);
    expect(q.has("customer_email")).toBe(false);
    expect(q.get("mode")).toBe("subscription");
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const now = 1_760_000_000_000;
  const nowSec = now / 1000;

  it("accepts one Stripe signed", () => {
    expect(verifyStripeSignature(body, sign(body, nowSec), SECRET, now)).toEqual({ ok: true });
  });

  it("accepts a header carrying several signatures, as it does during a secret roll", () => {
    const old = createHmac("sha256", "whsec_previous").update(`${nowSec}.${body}`).digest("hex");
    const header = `t=${nowSec},v1=${old},v1=${createHmac("sha256", SECRET).update(`${nowSec}.${body}`).digest("hex")}`;
    expect(verifyStripeSignature(body, header, SECRET, now).ok).toBe(true);
  });

  it("refuses a body that changed after it was signed", () => {
    const header = sign(body, nowSec);
    const tampered = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
    expect(verifyStripeSignature(tampered, header, SECRET, now)).toEqual({ ok: false, reason: "no signature matched" });
  });

  it("refuses a signature from the wrong secret", () => {
    expect(verifyStripeSignature(body, sign(body, nowSec, "whsec_someone_else"), SECRET, now).ok).toBe(false);
  });

  it("refuses one captured and replayed later", () => {
    const header = sign(body, nowSec);
    const muchLater = now + 10 * 60_000;
    expect(verifyStripeSignature(body, header, SECRET, muchLater)).toEqual({ ok: false, reason: "timestamp outside tolerance" });
  });

  it("refuses a missing, malformed or unsigned header, and a missing secret", () => {
    expect(verifyStripeSignature(body, null, SECRET, now).ok).toBe(false);
    expect(verifyStripeSignature(body, "nonsense", SECRET, now).ok).toBe(false);
    expect(verifyStripeSignature(body, `t=${nowSec}`, SECRET, now).ok).toBe(false);
    expect(verifyStripeSignature(body, sign(body, nowSec), "", now).ok).toBe(false);
  });

  it("refuses a signature that is not hex of the right length", () => {
    expect(verifyStripeSignature(body, `t=${nowSec},v1=zzzz`, SECRET, now).ok).toBe(false);
  });
});

describe("a trial is once per account", () => {
  it("offers one to an account that has never had it", () => {
    expect(trialDaysFor({ trialUsedAt: null })).toBe(14);
  });

  // Otherwise cancelling and subscribing again buys another fourteen free nights, and
  // repeating that buys the product for nothing.
  it("offers none to an account that has, however long ago", () => {
    expect(trialDaysFor({ trialUsedAt: new Date("2020-01-01") })).toBeNull();
  });

  it("knows which Stripe states mean a customer must not be sold a second subscription", () => {
    for (const s of ["trialing", "active", "past_due", "unpaid"]) expect(isLiveStripeStatus(s)).toBe(true);
    for (const s of ["canceled", "incomplete_expired", "paused", ""]) expect(isLiveStripeStatus(s)).toBe(false);
  });
});

describe("what the top bar says about an account", () => {
  const now = new Date("2026-09-12T12:00:00Z");
  const sub = { status: "trial" as const, stripeSubscriptionId: "sub_1", trialEndsAt: null as Date | null };

  // A fresh row reads trial because that is the column default, not because one started.
  it("says nothing until there is a subscription", () => {
    expect(accountBadge({ ...sub, stripeSubscriptionId: null }, now)).toBeNull();
  });

  it("counts the trial down in whole days, rounding up", () => {
    expect(accountBadge({ ...sub, trialEndsAt: new Date("2026-09-24T12:00:00Z") }, now)?.text).toBe("Trial, 12 days left");
    expect(accountBadge({ ...sub, trialEndsAt: new Date("2026-09-13T00:00:00Z") }, now)?.text).toBe("Trial, 1 day left");
    expect(accountBadge({ ...sub, trialEndsAt: new Date("2026-09-12T13:00:00Z") }, now)?.text).toBe("Trial, 1 day left");
  });

  it("warns over the last three days, which is when the reminder goes out", () => {
    expect(accountBadge({ ...sub, trialEndsAt: new Date("2026-09-16T12:00:00Z") }, now)?.tone).toBe("ok");
    expect(accountBadge({ ...sub, trialEndsAt: new Date("2026-09-15T12:00:00Z") }, now)?.tone).toBe("warn");
    expect(accountBadge({ ...sub, trialEndsAt: new Date("2026-09-12T01:00:00Z") }, now)).toEqual({ text: "Trial ends today", tone: "warn" });
  });

  it("names the states a customer needs to act on", () => {
    expect(accountBadge({ ...sub, status: "active" }, now)).toEqual({ text: "Active", tone: "ok" });
    expect(accountBadge({ ...sub, status: "past_due" }, now)).toEqual({ text: "Payment failed", tone: "bad" });
    expect(accountBadge({ ...sub, status: "canceled" }, now)).toEqual({ text: "Canceled", tone: "bad" });
    expect(accountBadge({ ...sub, status: "deleted" }, now)).toBeNull();
  });
});
