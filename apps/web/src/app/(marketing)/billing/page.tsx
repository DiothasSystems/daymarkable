import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingShell } from "@/components/MarketingShell";
import { serviceUrl } from "@/lib/hosts";
import { getSessionUser } from "@/server/auth";
import { billingConfigured, ownerEmail } from "@/server/billing";
import { needsCheckout, PLAN_COPY, TRIAL_DAYS } from "@/server/billing-core";

export const metadata: Metadata = { title: "Choose a plan" };
export const dynamic = "force-dynamic";

/**
 * Where an invited account starts its subscription. A payment page, so it sits on the public host
 * with the others, and the card itself is taken on Stripe's own checkout rather than here.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { checkout, error } = await searchParams;

  // Anyone who does not need to be here is sent where they were going.
  if (!needsCheckout(user, ownerEmail(), billingConfigured())) redirect(`${serviceUrl()}/today`);

  return (
    <MarketingShell>
      <section className="mk-wrap mk-section mk-center">
        <div className="mk-kicker">One last step</div>
        <h1 className="mk-h1 sm">Start your {TRIAL_DAYS} free nights.</h1>
        <p className="mk-sub" style={{ marginBottom: 32 }}>
          Signed in as {user.email}. Your card goes on file now and is charged only when the trial ends, and we email you three days
          before that happens. Cancel any time from your account page.
        </p>

        {checkout === "cancelled" ? (
          <div className="notice" style={{ maxWidth: 560, margin: "0 auto 28px", textAlign: "left" }}>
            Checkout was cancelled, so nothing was charged and no card was stored. Pick a plan whenever you are ready.
          </div>
        ) : null}
        {error ? (
          <div className="notice bad" style={{ maxWidth: 560, margin: "0 auto 28px", textAlign: "left" }}>{error}</div>
        ) : null}

        <div className="mk-plans">
          {(["monthly", "annual"] as const).map((plan) => (
            <div className={`mk-plan${plan === "annual" ? " featured" : ""}`} key={plan}>
              {plan === "annual" ? <span className="tag">Two months free</span> : null}
              <div className="mk-kicker" style={{ marginBottom: 6 }}>{PLAN_COPY[plan].label}</div>
              <div className="mk-price">{PLAN_COPY[plan].price}</div>
              <p className="muted" style={{ fontSize: 14, margin: "10px 0 18px" }}>{PLAN_COPY[plan].note}</p>
              <form method="post" action="/api/billing/checkout">
                <input type="hidden" name="plan" value={plan} />
                <button type="submit" className={plan === "annual" ? "primary" : "secondary"} style={{ width: "100%", justifyContent: "center" }}>
                  Start free — {TRIAL_DAYS} days
                </button>
              </form>
            </div>
          ))}
        </div>

        <div className="mk-foot">
          CARD REQUIRED · NOT CHARGED UNTIL DAY {TRIAL_DAYS + 1} · <Link href="/terms">Terms</Link> · <Link href="/pricing">What is included</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
