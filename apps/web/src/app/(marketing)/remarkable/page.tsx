import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";

export const metadata: Metadata = {
  title: "The reMarkable tablet",
  description: "What the reMarkable paper tablet is, what it does and doesn't do, which models work with dayMarkable, and where to buy one.",
};

const MODELS: { name: string; body: string }[] = [
  { name: "reMarkable Paper Pro", body: "The current flagship: an 11.8-inch color paper display with a front light, so it works in a dark room. The largest writing surface of the three, and the one to choose if you mostly write full pages of meeting notes." },
  { name: "reMarkable 2", body: "The classic 10.3-inch grayscale tablet, thin and light, with no front light. Still sold, still supported, and the model most existing owners have. Everything dayMarkable does works on it." },
  { name: "reMarkable Paper Pro Move", body: "A 7.3-inch color paper tablet sized for a jacket pocket. Same pen, same cloud, same notebooks. Best if you carry it everywhere and write in short bursts." },
];

const DOES = [
  "Feels like writing on paper. The textured surface and the Marker's friction are the reason people who hate typing keep one on the desk.",
  "Notebooks without limits. Pages, folders, and templates for meeting notes, journals, sketches, and to-do lists.",
  "PDF and ebook markup. Read and annotate documents you send to it from a computer or phone.",
  "Cloud sync. With a free reMarkable account, everything you write syncs to reMarkable's cloud and to their desktop and mobile apps. This is the link dayMarkable uses.",
  "Weeks of battery, no glare, and nothing that buzzes at you.",
];

const DOESNT = [
  "Run apps, show notifications, or check email. There is no app store, by design.",
  "Turn your handwriting into a plan. reMarkable can convert a page to text on demand, one page at a time, but it produces text, not tasks, dates, or follow-ups. That gap is what dayMarkable fills.",
  "Work with dayMarkable while offline or signed out. Notebooks reach us only through reMarkable's cloud sync, so the tablet needs an account and Wi-Fi at night.",
];

export default function RemarkablePage() {
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section">
        <div className="mk-kicker">The tablet</div>
        <h1 className="mk-h1 sm">A tablet that only does paper. dayMarkable does the rest.</h1>
        <p className="mk-lede">dayMarkable is built for the reMarkable paper tablet. If you already own one, you have everything you need. If you don't, here is what it is, what it does, and how to get one.</p>
        <p className="meta">dayMarkable is an independent product and is not affiliated with, endorsed by, or supported by reMarkable AS.</p>
      </section>

      <section className="mk-paper">
        <div className="mk-wrap mk-section tight mk-two" style={{ alignItems: "start" }}>
          <div>
            <h2>What it does</h2>
            <div className="mk-bullets">
              {DOES.map((d) => <div key={d}><span>→</span> {d}</div>)}
            </div>
          </div>
          <div>
            <h2>What it deliberately doesn't</h2>
            <div className="mk-bullets">
              {DOESNT.map((d) => <div key={d}><span>→</span> {d}</div>)}
            </div>
          </div>
        </div>
      </section>

      <section className="mk-wrap mk-section">
        <div className="mk-kicker">Models that work with dayMarkable</div>
        <h2 className="mk-h2">Any current reMarkable. Pick by size and light.</h2>
        <p className="mk-sub">All three share the same Marker, the same notebooks, and the same cloud, so dayMarkable treats them identically. The differences are the screen.</p>
        <div className="mk-cards">
          {MODELS.map((m) => (
            <div className="mk-card" key={m.name}>
              <div className="mk-card-title">{m.name}</div>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-band">
        <div className="mk-wrap mk-section tight">
          <div className="mk-kicker">What dayMarkable needs from it</div>
          <h2 className="mk-h2">A reMarkable account, cloud sync on, Wi-Fi at night.</h2>
          <div className="mk-steps">
            <div>
              <div className="mk-step-label">01 · AN ACCOUNT</div>
              <p>Sign the tablet in to a reMarkable account (free) at my.remarkable.com. dayMarkable pairs with that account using a one-time code, and never asks for your password.</p>
            </div>
            <div>
              <div className="mk-step-label">02 · CLOUD SYNC</div>
              <p>Leave sync on. Your notebooks travel to reMarkable's cloud, which is where dayMarkable reads the pages you changed each day. The paid Connect subscription is not required.</p>
            </div>
            <div>
              <div className="mk-step-label">03 · WI-FI OVERNIGHT</div>
              <p>The tablet needs to sync before 03:00 and again in the morning to pick up the new planner pages. On the desk, on the charger, connected to Wi-Fi is the whole routine.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-wrap mk-section">
        <div className="mk-kicker">How to purchase</div>
        <h2 className="mk-h2">Buy it from reMarkable, or a retailer you already use.</h2>
        <div className="mk-features">
          <div className="mk-feature">
            <div className="num">DIRECT</div>
            <h3>remarkable.com</h3>
            <p>The manufacturer's own store sells every model, the Marker and Marker Plus (with the eraser end), folios, and the Type Folio keyboard cover. Bundles are the usual way to buy: tablet plus Marker plus folio. Ships worldwide with a return window, and current prices are always on that site.</p>
            <p style={{ marginTop: 10 }}><a href="https://remarkable.com" target="_blank" rel="noreferrer noopener">remarkable.com →</a></p>
          </div>
          <div className="mk-feature">
            <div className="num">RETAIL</div>
            <h3>Amazon and Best Buy</h3>
            <p>In the United States, reMarkable also sells through Amazon and Best Buy, which is handy if you want same-week delivery or to try the pen in a store. Buy from the official reMarkable listing rather than a marketplace reseller so the warranty and account setup are straightforward.</p>
          </div>
          <div className="mk-feature">
            <div className="num">SECOND-HAND</div>
            <h3>A used reMarkable 2</h3>
            <p>The reMarkable 2 has been sold since 2020 and holds up well, so used units are common and cost noticeably less. Make sure the seller has signed it out of their reMarkable account before you pay; a tablet still tied to someone else's account cannot be paired with yours.</p>
          </div>
          <div className="mk-feature">
            <div className="num">WHAT TO SKIP</div>
            <h3>Things you don't need for dayMarkable</h3>
            <p>The Connect subscription, the keyboard folio, and the pen-tip multipack are all optional. A tablet, a Marker, and a free account are enough. The Marker Plus is worth it only because erasing with the back end is faster than switching tools.</p>
          </div>
        </div>
        <p className="mk-foot">PRICES AND AVAILABILITY CHANGE · CHECK remarkable.com FOR CURRENT MODELS AND OFFERS</p>
      </section>

      <section className="mk-paper">
        <div className="mk-wrap mk-section tight mk-center">
          <h2 className="mk-h2">Have one already?</h2>
          <p className="mk-sub" style={{ marginBottom: 28 }}>Pair it in a few minutes. Your first planner lands on it tomorrow morning.</p>
          <Link href="/start" className="btn" style={{ padding: "15px 34px", fontSize: 16 }}>Start free — 14 days</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
