import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MarketingShell } from "@/components/MarketingShell";
import { serviceUrl } from "@/lib/hosts";
import { getSessionUser } from "@/server/auth";
import { WaitlistForm } from "./WaitlistForm";

export const metadata: Metadata = { title: "Join the waiting list", description: "dayMarkable is in private preview. Leave your address and we will write when there is room." };
export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Your email", body: "We send a one-time sign-in link — no password to invent. Meeting notes are emailed to this same address, and only this address." },
  { title: "Pair your tablet", body: "Enter the one-time code from my.remarkable.com/device/browser/connect. dayMarkable stores the device token encrypted and never asks for your reMarkable password." },
  { title: "Choose watch folders", body: "Pick which notebooks are read each night. Ebooks and PDFs are left alone unless you say otherwise." },
  { title: "Set your timezone", body: "Runs happen at 03:00 where you are, daylight-saving safe." },
  { title: "Register your ink conventions", body: "Tell us what an asterisk, an underline, a circled word, or a margin star means in your hand." },
  { title: "Write a calibration sample", body: "A short passage, tailored to your work, that shows the decoder your letterforms. Optional, but accuracy is measurably better with it." },
  { title: "Delivery email (optional)", body: "Want the night's PDFs mailed to a second address? Type it, then click the confirmation link that address receives. Nothing is ever mailed to an address read from a page." },
];

export default async function StartPage() {
  const user = await getSessionUser();
  if (user) redirect(`${serviceUrl()}${user.onboardedAt ? "/today" : "/setup"}`);
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section">
        <div className="mk-two" style={{ alignItems: "start" }}>
          <div>
            <div className="mk-kicker">Private preview</div>
            <h1 className="mk-h1 sm">Seven steps, then never touch a keyboard again.</h1>
            <p className="mk-lede" style={{ marginBottom: 24 }}>This is what happens once you are in. Setup takes about ten minutes, most of it writing one page by hand, and your first planner is on the tablet the next morning.</p>
            <div className="mk-flow">
              {STEPS.map((s, i) => (
                <div className="mk-flow-step" key={s.title}>
                  <div className="n">STEP {String(i + 1).padStart(2, "0")}</div>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card" style={{ position: "sticky", top: 88 }}>
            <p className="kicker">Private preview</p>
            <h2 style={{ marginBottom: 6 }}>Join the waiting list.</h2>
            <p className="muted" style={{ fontSize: 14 }}>
              dayMarkable is not open for registration yet. Every account is read by hand onto a real tablet each night, so we are
              letting people in a few at a time. Leave your address and we will write when there is room.
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 16px" }}>
              Already have an account? <Link href="/login">Sign in instead</Link>.
            </p>
            <WaitlistForm />
            <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>By joining you agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy promise</Link>.</p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
