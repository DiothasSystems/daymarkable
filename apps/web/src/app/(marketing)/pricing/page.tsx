import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";

export const metadata: Metadata = { title: "Pricing", description: "$10 a month or $100 a year after a 14-day free trial. One tablet, unlimited notebooks." };

const INCLUDED = [
  "Nightly decode of every changed page",
  "Daily, week, month, quarter, and year planner pages",
  "The living Action List and Meeting Notes notebooks",
  "One email per meeting, plus optional nightly PDF delivery",
  "Google Calendar or Outlook overlay and draft invites",
  "Three on-demand syncs per day from web or phone",
  "Handwriting calibration, lexicon, and remembered corrections",
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section mk-center">
        <div className="mk-kicker">Pricing</div>
        <h1 className="mk-h1 sm">One plan. Fourteen free nights first.</h1>
        <p className="mk-sub" style={{ marginBottom: 40 }}>Your card goes on file when you start and is charged only when the trial ends. We email you three days before, so nothing surprises you.</p>

        <div className="mk-plans">
          <div className="mk-plan">
            <div className="mk-kicker" style={{ marginBottom: 6 }}>Monthly</div>
            <div className="mk-price">$10<small>/ month</small></div>
            <p className="muted" style={{ fontSize: 14, margin: "10px 0 0" }}>Billed monthly. Cancel anytime from your account page.</p>
            <ul>{INCLUDED.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
          <div className="mk-plan featured">
            <span className="tag">Two months free</span>
            <div className="mk-kicker" style={{ marginBottom: 6 }}>Annual</div>
            <div className="mk-price">$100<small>/ year</small></div>
            <p className="muted" style={{ fontSize: 14, margin: "10px 0 0" }}>Billed once a year. Same plan, same everything.</p>
            <ul>{INCLUDED.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        </div>
        <Link href="/start" className="btn" style={{ padding: "15px 34px", fontSize: 16 }}>Start free — 14 days</Link>
        <div className="mk-foot">ONE TABLET · UNLIMITED NOTEBOOKS · UP TO 40 PAGES A NIGHT ON THIS PLAN</div>
      </section>

      <section className="mk-paper">
        <div className="mk-wrap mk-section tight">
          <div className="mk-faq">
            <div className="mk-kicker">Questions</div>
            <details>
              <summary>What do I need before I start?</summary>
              <p>A reMarkable tablet (reMarkable 2, Paper Pro, or Paper Pro Move) signed in to a reMarkable account with cloud sync turned on, and Wi-Fi at night. dayMarkable reads your notebooks through the reMarkable cloud, never from the device itself, so a tablet that is offline or not connected to an account has nothing for us to read. Read about <Link href="/remarkable">the tablet and where to buy one</Link>.</p>
            </details>
            <details>
              <summary>Do I need reMarkable's paid Connect subscription?</summary>
              <p>No. dayMarkable needs only the cloud sync that comes with a free reMarkable account. Connect adds features such as unlimited cloud storage and handwriting conversion in reMarkable's own apps; none of them is required, and dayMarkable does not use them.</p>
            </details>
            <details>
              <summary>Where do I manage billing?</summary>
              <p>On the web, from your account page. Payments are handled by Stripe. The phone experience is the same responsive site, so there is no app-store subscription and no app-store markup.</p>
            </details>
            <details>
              <summary>What happens if I write a lot?</summary>
              <p>The plan covers up to 40 changed pages a night, which is more than almost anyone writes. If you regularly exceed it we will talk to you about a Pro tier rather than quietly drop pages.</p>
            </details>
            <details>
              <summary>Does the price include the AI reading?</summary>
              <p>Yes. Nightly runs are batched and cost a fraction of the subscription; there are no per-page charges and no token meters to watch.</p>
            </details>
            <details>
              <summary>Can I cancel mid-cycle?</summary>
              <p>Yes. Cancelling stops the next charge and the nightly runs at the end of the paid period. Deleting your account removes your settings, registry, and any cached pages immediately.</p>
            </details>
            <details>
              <summary>Is there a free tier?</summary>
              <p>No, and there are no ads. A product that reads your handwritten notes should be paid for by you, not by a sponsor on your morning planner.</p>
            </details>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
