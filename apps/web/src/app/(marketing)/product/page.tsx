import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";

export const metadata: Metadata = {
  title: "Product",
  description: "What dayMarkable reads, what it writes back to your reMarkable, and what it never does.",
};

const FEATURES: { title: string; body: string }[] = [
  { title: "Nightly decode, changed pages only", body: "At 03:00 in your timezone, only the pages you wrote on that day are downloaded and read. Claude vision turns each page into structured items — tasks, events with dates and times, meeting requests, people, projects, and notes — each with a confidence score." },
  { title: "Your ink conventions", body: "Tell dayMarkable which markup means action, follow-up, priority, or schedule this: an asterisk, an underline, a highlighter stroke, circled or boxed text, an exclamation mark, a margin star, or keywords like TODO and F/U. Pick the ones you actually use." },
  { title: "The Daily Sheet", body: "One page: today's date, the calendar block, and a prioritized action list with checkboxes big enough for a pen. Items that have rolled over carry a subtle dot count so you can see how long they've waited." },
  { title: "Day · Week · Month · Quarter · Year", body: "A typeset planner notebook at every horizon, written back to the tablet each night. Every page keeps ruled space for handwriting, because every planner page is also an input form." },
  { title: "Calendar merge", body: "Connect Google Calendar or Outlook and your existing meetings appear on the planner pages alongside handwritten commitments. Read access only, until you say otherwise." },
  { title: "Meeting invites from ink — as drafts", body: "\"Set up 30 min with Priya next Tue\" becomes a draft invite in your calendar. Drafts are sent only after you tick the confirmation box or click the link. A misread name must never email a stranger." },
  { title: "Meeting notes, delivered twice", body: "Each meeting's pages become clean notes: a Meeting Notes notebook on the tablet, and one email per meeting to your login address with the topic, date, and time as the subject." },
  { title: "The living Action List", body: "One checkbox notebook, append-only. New items merge in by date and priority; nothing is ever re-issued as a fresh list that orphans open items. Items leave only when you tick them or drop them." },
  { title: "The closed loop", body: "Ticks, strike-throughs, and margin notes on dayMarkable's own pages are read the next night. Completed tasks roll off; new margin notes roll in. No app, no keyboard, no sync button." },
  { title: "Low confidence goes to the Inbox", body: "Anything the decoder is unsure about lands in the planner's \"Inbox — confirm these\" section, never silently on your action list. Correct a misread on the web and the correction is remembered." },
  { title: "Watch folders", body: "Choose which reMarkable folders dayMarkable reads. By default that's all your notebooks, excluding ebooks and PDFs." },
  { title: "Sync now", body: "Need it before 03:00? Run a sync on demand from the web, up to three times in a rolling 24 hours. An on-demand sync replaces that night's automatic run, so nothing is processed twice." },
  { title: "A viewer, not a regenerator", body: "The web app shows the same documents the tablet has — planner pages, meeting notes, the action list — plus run history and cost. Viewing never triggers decoding; the tablet stays the primary surface." },
  { title: "Accuracy that learns your hand", body: "During setup you write a short calibration passage tailored to your work. That sample, your lexicon of names and project words, and your past corrections travel with every page the decoder reads." },
];

export default function ProductPage() {
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section">
        <div className="mk-kicker">Product</div>
        <h1 className="mk-h1 sm">Notes in. Executive function out.</h1>
        <p className="mk-lede">reMarkable's own text conversion is manual, page-at-a-time, and produces text. dayMarkable is the missing layer: it reads what you wrote today and hands you tomorrow, organized, on the same device.</p>
        <div className="mk-cta-row">
          <Link href="/start" className="btn">Start free — 14 days</Link>
          <Link href="/pricing">See pricing →</Link>
        </div>
      </section>

      <section className="mk-band">
        <div className="mk-wrap mk-section tight">
          <div className="mk-kicker">The rule the whole product is built on</div>
          <h2 className="mk-h2">The model reads. The code organizes.</h2>
          <p style={{ fontSize: 16, lineHeight: 1.7, maxWidth: 720, margin: 0 }}>AI turns your page images into structured items with confidence scores. Everything after that — merging, deduplicating, carrying items over, ordering by date and priority — is deterministic and repeatable. Re-running a night produces the same planner, never duplicates. "Call dentist" written twice is one task.</p>
        </div>
      </section>

      <section className="mk-wrap mk-section">
        <div className="mk-kicker">Everything it does</div>
        <h2 className="mk-h2" style={{ marginBottom: 36 }}>Fourteen things, one habit: write it down.</h2>
        <div className="mk-features">
          {FEATURES.map((f, i) => (
            <div className="mk-feature" key={f.title}>
              <div className="num">{String(i + 1).padStart(2, "0")}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-paper">
        <div className="mk-wrap mk-section tight mk-two">
          <div>
            <h2>What it never does.</h2>
            <p>Some promises are worth stating as rules rather than features. These are enforced in the code, not in a policy document.</p>
          </div>
          <div className="mk-bullets">
            <div><span>→</span> Never keeps your page images longer than 24 hours. Each night's run deletes the previous night's cache and logs the deletion.</div>
            <div><span>→</span> Never emails an address it read on a page. Notes go to your login email, or to one delivery address you typed and confirmed yourself.</div>
            <div><span>→</span> Never sends a calendar invite without your confirmation, unless you opted in — and then only high-confidence, internal ones.</div>
            <div><span>→</span> Never logs the content of your notes. Counts and hashes only.</div>
            <div><span>→</span> Never writes a broken planner. If the reMarkable sync changes, the night is skipped and you are told.</div>
          </div>
        </div>
      </section>

      <section className="mk-wrap mk-section mk-center">
        <h2 className="mk-h2">Ready when your tablet is.</h2>
        <p className="mk-sub" style={{ marginBottom: 28 }}>Pair it once with a code from my.remarkable.com. Your first planner lands tomorrow morning.</p>
        <Link href="/start" className="btn" style={{ padding: "15px 34px", fontSize: 16 }}>Start free — connect your tablet</Link>
      </section>
    </MarketingShell>
  );
}
