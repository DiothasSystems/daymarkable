import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";

export const metadata: Metadata = { title: "Support", description: "Help with pairing, accuracy, delivery, and billing." };

export default function SupportPage() {
  const supportEmail = process.env.SUPPORT_EMAIL?.trim() || null;
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section mk-prose">
        <div className="mk-kicker">Support</div>
        <h1 className="mk-h1 sm">Most things are fixed on your account page.</h1>
        <p style={{ marginTop: 18 }}>
          {supportEmail ? (
            <>Write to <a href={`mailto:${supportEmail}`}>{supportEmail}</a> from the address you signed in with, or reply to any email dayMarkable has sent you.</>
          ) : (
            <>Reply to any email dayMarkable has sent you — a sign-in link, a meeting summary, a delivery confirmation — and a person reads it.</>
          )}
        </p>

        <h2>Pairing and sync</h2>
        <ul>
          <li>The pairing code comes from my.remarkable.com/device/browser/connect and is valid for a few minutes. Generate a fresh one if it is rejected.</li>
          <li>If a night is skipped with a sync error, the reMarkable cloud format has usually changed. We track this closely; the planner is never written half-broken.</li>
          <li>Pages written before midnight but after 03:00 are read the next night. Use Sync now on the Today page if you need them sooner.</li>
        </ul>

        <h2>Accuracy</h2>
        <ul>
          <li>Add names, companies, and project words to your lexicon on the account page. Proper nouns are where misreads concentrate and this is the single biggest lever.</li>
          <li>Write the calibration sample if you skipped it during setup.</li>
          <li>Fix a misread item on the Documents page; recurring corrections are promoted to your lexicon automatically.</li>
          <li>Rate each run on the Runs page. Ratings and comments reach us; note content does not.</li>
        </ul>

        <h2>Email and delivery</h2>
        <ul>
          <li>Meeting-note emails go to your login address. Turn them off under Email on the account page.</li>
          <li>A delivery address receives PDFs only after it clicks its confirmation link. Check spam if it never arrives, then resend from settings.</li>
        </ul>

        <h2>Billing</h2>
        <p>Plan changes, card updates, and cancellation live on the account page. See <Link href="/pricing">pricing</Link> for what the plan includes.</p>
      </section>
    </MarketingShell>
  );
}
