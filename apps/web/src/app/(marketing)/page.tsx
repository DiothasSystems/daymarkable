import type { Metadata } from "next";
import Link from "next/link";
import { HeroBuild } from "@/components/hero/HeroBuild";
import { MarketingShell } from "@/components/MarketingShell";

export const metadata: Metadata = {
  title: { absolute: "dayMarkable — Your notes. Your next move." },
  description: "Every night dayMarkable reads the notebooks on your reMarkable tablet and returns a plan by morning: meeting summaries, action items, and planner pages ready for your pen.",
  openGraph: { title: "dayMarkable — Your notes. Your next move.", description: "You write by hand. We turn it into tomorrow.", images: ["/brand/full-lockup-1200.jpg"] },
};

const IconTick = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1e2a44" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M 8 12 L 11 15 L 17 8" /></svg>
);
const IconCalendar = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1e2a44" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></svg>
);
const IconMail = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1e2a44" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M 3 7 L 12 13 L 21 7" /></svg>
);

export default function LandingPage() {
  return (
    <MarketingShell>
      <HeroBuild />

      {/* HOW IT WORKS */}
      <section id="how" className="mk-band">
        <div className="mk-wrap mk-section">
          <div className="mk-kicker">How it works</div>
          <h2 className="mk-h2" style={{ marginBottom: 44 }}>Today's notes → tomorrow's actions. While you sleep.</h2>
          <div className="mk-steps">
            <div>
              <div className="mk-step-label">01 · YOU WRITE</div>
              <p>Take notes the way you always have — meetings, ideas, to-dos, margins and all. No tags, no syntax, no changing your habits.</p>
            </div>
            <div>
              <div className="mk-step-label">02 · WE READ · 03:00</div>
              <p>Overnight, dayMarkable reads only the pages you changed, finds the decisions, commitments, and follow-ups, and links every one back to the page it came from.</p>
            </div>
            <div>
              <div className="mk-step-label">03 · YOU WAKE UP READY</div>
              <p>By morning: a meeting-notes email in your inbox, a living Action List, and fresh daily, weekly, monthly, and yearly pages on your tablet — ready for your pen.</p>
            </div>
          </div>
        </div>
      </section>

      {/* YOUR PAGES */}
      <section id="pages" className="mk-wrap mk-section">
        <div className="mk-kicker">Delivered nightly</div>
        <h2 className="mk-h2">Pages that land on your tablet. Email that lands in your inbox.</h2>
        <p className="mk-sub">Every page keeps room for your handwriting — checkboxes to tick with a pen, ruled lines for new notes. The ink is always the authority; the summary is the index.</p>
        <div className="mk-cards">
          <div className="mk-card">
            <IconTick />
            <div className="mk-card-title">Daily page</div>
            <p>Today's actions and schedule on one sheet — carried-over items flagged, low-confidence reads held in an Inbox for you to confirm, notes space below.</p>
          </div>
          <div className="mk-card">
            <IconCalendar />
            <div className="mk-card-title">Week · Month · Quarter · Year</div>
            <p>At-a-glance calendars with your open actions down the side, your Google or Outlook calendar overlaid, refreshed every night as things get done.</p>
          </div>
          <div className="mk-card">
            <IconMail />
            <div className="mk-card-title">Meeting notes, twice</div>
            <p>Each meeting summarized with its decisions and follow-ups — a Meeting Notes notebook on the tablet and one email per meeting, quoting your own ink.</p>
          </div>
        </div>
        <div className="mk-quote">
          <span className="ref">MEETING-NOTES/Q3-PLANNING · p.6 · 14:32</span>
          <span className="ink">"vendor shortlist → Maya by Wed"</span>
          <span className="so">— became an action, due Wednesday, without you typing a thing.</span>
        </div>
      </section>

      {/* FOR WHOM */}
      <section className="mk-paper">
        <div className="mk-wrap mk-section tight mk-two">
          <div>
            <h2>Built for people who never stopped writing.</h2>
            <p>You think with a pen. You've tried the task apps and gone back to paper every time. dayMarkable doesn't ask you to change — it does the typing, filing, and reminding, and leaves the thinking in your hand.</p>
          </div>
          <div className="mk-bullets">
            <div><span>→</span> Nothing to install on the tablet — pages arrive like any notebook</div>
            <div><span>→</span> Your handwriting stays private — read, summarized, deleted within a day</div>
            <div><span>→</span> Tick a box with your pen — it's marked done by the next sync</div>
            <div><span>→</span> Every summary links to the page and line it came from</div>
          </div>
        </div>
      </section>

      {/* PRICING / CTA */}
      <section id="pricing" className="mk-wrap mk-section mk-center">
        <img src="/brand/emblem-96.png" alt="" width={88} height={88} style={{ marginBottom: 20 }} />
        <h2 className="mk-h2">Tonight's notes could be tomorrow's plan.</h2>
        <p className="mk-sub" style={{ marginBottom: 28 }}>$10/month or $100/year after a 14-day free trial. One tablet, unlimited notebooks. Cancel anytime.</p>
        <Link href="/start" className="btn" style={{ padding: "15px 34px", fontSize: 16 }}>Start free — connect your tablet</Link>
        <div className="mk-foot">FIRST SUMMARY IN YOUR INBOX TOMORROW · 03:00 · <Link href="/pricing">Plan details</Link></div>
      </section>
    </MarketingShell>
  );
}
