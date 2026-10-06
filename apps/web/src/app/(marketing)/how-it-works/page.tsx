import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";
import { Storyboard } from "@/components/storyboard/Storyboard";

export const metadata: Metadata = {
  title: "How it works",
  description: "A day with ScriptumIQ, from ten minutes of setup to the pages on your tablet the next morning.",
};

/** Where "See how it works" goes: the storyboard of a day, setup to morning. */
export default function HowItWorksPage() {
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section">
        <div className="mk-kicker">How it works</div>
        <h1 className="mk-h1 sm">A day with ScriptumIQ.</h1>
        <p className="mk-lede">
          Ten minutes to set up, then nothing to learn: you write the way you already do, wherever you are, and the
          next morning your tablet, your inbox and your phone are ready.
        </p>
        <Storyboard />
        <div className="mk-cta-row" style={{ marginTop: 56 }}>
          <Link href="/start" className="btn">Start free — 14 days</Link>
          <Link href="/product">Everything it does →</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
