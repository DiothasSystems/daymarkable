import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/MarketingShell";
import { appLinks } from "@/lib/app-links";

export const metadata: Metadata = {
  title: "The ScriptumIQ app",
  description: "Your Action List, calendar and daily notes on your phone, for when the tablet is at home.",
};
// The store links are read from the server's settings on each request, so setting one needs no rebuild.
export const dynamic = "force-dynamic";

const DOES = [
  "Your Action List, grouped by when it is due. Tick something off in a corridor and tonight's tablet pages agree.",
  "Fix a misread word, set a priority or type a due date, and approve or remove anything it was unsure of.",
  "Your calendar and every day's notes, newest first.",
  "Change something and the notebooks are rebuilt and sent back to your tablet.",
];

/**
 * The page the app mail points to, and the one place that always has the current store links
 * (ANDROID_APP_URL / IOS_APP_URL, lib/app-links.ts). A store not yet live says so rather than
 * linking anywhere. No price and no checkout here: the app is for subscribers, who subscribe first.
 */
export default function AppPage() {
  const links = appLinks();
  const stores = [
    { name: "iPhone", store: "App Store", url: links.ios },
    { name: "Android", store: "Google Play", url: links.android },
  ];
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section">
        <div className="mk-kicker">The phone app</div>
        <h1 className="mk-h1 sm">The same list, when the tablet is at home.</h1>
        <p className="mk-lede">
          The ScriptumIQ app is for subscribers. Sign in with the email address and password you use on this website. Your subscription stays here on the website; the app never asks for a card.
        </p>
        <div className="mk-cards">
          {stores.map((s) => (
            <div className="mk-card" key={s.name}>
              <div className="mk-card-title">{s.name}</div>
              {s.url ? (
                <p>
                  <a className="btn" href={s.url} rel="noopener">
                    Get it on {s.store}
                  </a>
                </p>
              ) : (
                <p>Coming soon to the {s.store}. Subscribers are emailed the moment it is out.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mk-paper">
        <div className="mk-wrap mk-section tight">
          <h2>What it does</h2>
          <div className="mk-bullets">
            {DOES.map((d) => (
              <div key={d}>
                <span>→</span> {d}
              </div>
            ))}
          </div>
          <p className="meta" style={{ marginTop: 24 }}>
            Not a subscriber yet? <Link href="/how-it-works">See how it works</Link>.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
