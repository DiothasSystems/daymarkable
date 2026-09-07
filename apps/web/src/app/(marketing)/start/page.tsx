import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/LoginForm";
import { MarketingShell } from "@/components/MarketingShell";
import { getSessionUser } from "@/server/auth";

export const metadata: Metadata = { title: "Start free", description: "Create your dayMarkable account and pair your reMarkable in a few minutes." };
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
  if (user) redirect(user.onboardedAt ? "/today" : "/setup");
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section">
        <div className="mk-two" style={{ alignItems: "start" }}>
          <div>
            <div className="mk-kicker">Start free · 14 days</div>
            <h1 className="mk-h1 sm">Seven steps, then never touch a keyboard again.</h1>
            <p className="mk-lede" style={{ marginBottom: 24 }}>Setup takes about ten minutes, most of it writing one page by hand. Your first planner is on the tablet tomorrow morning.</p>
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
            <p className="kicker">Step 01 · Your email</p>
            <h2 style={{ marginBottom: 6 }}>Create your account.</h2>
            <p className="muted" style={{ fontSize: 14 }}>Enter the address you want your meeting notes sent to. We email a sign-in link that works once.</p>
            <LoginForm />
            <p className="meta" style={{ marginTop: 16 }}>EARLY ACCESS · INVITED ACCOUNTS ONLY DURING THE PREVIEW</p>
            <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>Already have an account? <Link href="/login">Sign in</Link>. By continuing you agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy promise</Link>.</p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
