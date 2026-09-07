import type { Metadata } from "next";
import { MarketingShell } from "@/components/MarketingShell";

export const metadata: Metadata = { title: "Terms", description: "The terms of the dayMarkable service." };

export default function TermsPage() {
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section mk-prose">
        <div className="mk-kicker">Terms of service</div>
        <h1 className="mk-h1 sm">Plain terms for a plain service.</h1>

        <h2>The service</h2>
        <p>dayMarkable reads notebooks from the reMarkable account you pair, extracts tasks, events, and meeting notes with AI, and writes planner and notebook documents back to that tablet and to your email. It is an independent product and is not affiliated with, endorsed by, or supported by reMarkable AS.</p>

        <h2>Your account</h2>
        <ul>
          <li>One account per person, signed in by email link. You are responsible for keeping that mailbox secure.</li>
          <li>You may pair one tablet. You must own or be authorized to use the reMarkable account you connect.</li>
          <li>You may run up to three on-demand syncs in any rolling 24 hours; the nightly run covers everything else.</li>
        </ul>

        <h2>Billing</h2>
        <ul>
          <li>The trial lasts 14 days. A card is required to start and is charged when the trial ends unless you cancel first. We email you three days before the first charge.</li>
          <li>Plans are $10 per month or $100 per year, billed through Stripe on this website only. Cancel anytime; service continues to the end of the paid period.</li>
          <li>Refunds for unused time may be issued at our discretion, prorated.</li>
        </ul>

        <h2>Accuracy</h2>
        <p>Handwriting recognition is imperfect. Items the decoder is unsure of are placed in an Inbox for you to confirm, and calendar invites are drafts until you approve them. You remain responsible for the commitments you act on; your ink is the record, the summary is an index.</p>

        <h2>Acceptable use</h2>
        <p>Do not use the service to process notebooks you are not entitled to, to send invites to people who have not agreed to be contacted, or in any way that violates reMarkable's terms for your own account.</p>

        <h2>Changes and termination</h2>
        <p>We may change these terms with notice by email. You may delete your account at any time from the account page; we may suspend accounts that violate these terms.</p>

        <p className="meta" style={{ marginTop: 32 }}>LAST UPDATED SEPTEMBER 2026</p>
      </section>
    </MarketingShell>
  );
}
