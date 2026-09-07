import type { Metadata } from "next";
import { MarketingShell } from "@/components/MarketingShell";

export const metadata: Metadata = { title: "Privacy", description: "What dayMarkable keeps, for how long, and what it never does with your handwriting." };

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section mk-prose">
        <div className="mk-kicker">Privacy</div>
        <h1 className="mk-h1 sm">We read your handwriting. We keep it for a day.</h1>
        <p style={{ marginTop: 18 }}>dayMarkable exists to read your private notes, so the privacy rules are part of the product's design, enforced in code, and short enough to read in full.</p>

        <h2>What we collect</h2>
        <ul>
          <li>Your email address, timezone, settings, and a device token for your reMarkable account, stored encrypted.</li>
          <li>Each night, the notebook pages you changed that day, the images rendered from them, and the planner, action list, and meeting-notes documents generated from them.</li>
          <li>The structured items extracted from those pages — tasks, events, meeting notes, meeting requests — kept encrypted so tomorrow's planner can be updated without re-reading your notes.</li>
          <li>Your calibration sample and lexicon, if you provide them, and the corrections you make on the web.</li>
          <li>Run history: counts, timings, model usage, and cost. Never the text of a page.</li>
        </ul>

        <h2>How long we keep it</h2>
        <ul>
          <li>Page downloads, rendered images, and generated documents live in a one-day rolling cache. Each run deletes the previous night's cache as its final step and logs the deletion. A 48-hour storage lifecycle rule is the failsafe.</li>
          <li>Nothing is archived beyond one day. There is no history of your pages to browse, export, or breach.</li>
          <li>Extracted items and your settings are kept while your account exists, and deleted with it.</li>
        </ul>

        <h2>Who sees it</h2>
        <ul>
          <li>Page images are sent to Anthropic's Claude API for reading, under terms that do not permit training on your data.</li>
          <li>Meeting notes are emailed to your login address only. The night's PDFs may also go to one delivery address you typed into your own settings and confirmed by clicking a link sent to it. No address is ever taken from a page.</li>
          <li>Calendar invites reach other people only when you confirm a draft, through the calendar you connected.</li>
          <li>Operators can see ratings, comments, run counts, and account status through an audited admin portal. They cannot see note content there.</li>
        </ul>

        <h2>What we log</h2>
        <p>Counts and hashes, not text. A log line says "6 pages, 11 tasks", never what the tasks were.</p>

        <h2>Your controls</h2>
        <ul>
          <li>Choose which folders are read. Turn off per-meeting email. Remove the delivery address at any time.</li>
          <li>Deleting your account removes settings, extracted items, cached files, and the device token immediately.</li>
        </ul>
        <p className="meta" style={{ marginTop: 32 }}>LAST UPDATED SEPTEMBER 2026 · NOT AFFILIATED WITH reMARKABLE AS</p>
      </section>
    </MarketingShell>
  );
}
