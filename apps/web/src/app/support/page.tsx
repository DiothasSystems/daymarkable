import type { Metadata } from "next";
import { MarketingShell } from "@/components/MarketingShell";
import { Shell } from "@/components/Shell";
import { SupportContent } from "@/components/SupportContent";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Support",
  description: "Help with accuracy, pairing, delivery, cancelling, and requesting features.",
};

/**
 * One support page, served on both hosts.
 *
 * The answers someone wants before subscribing and the answers they want at 7am with no planner on
 * their tablet are the same answers, and an answer kept in two places drifts. So `/support` is
 * claimed by neither host (lib/hosts.ts) and this page picks its frame from the session: the app
 * shell for someone signed in, the marketing shell for a visitor. Links are relative either way —
 * a link to /account from the public host is redirected across by the proxy.
 */
export default async function SupportPage() {
  const user = await getSessionUser();
  const supportEmail = process.env.SUPPORT_EMAIL?.trim() || null;
  const body = <SupportContent appBase="" supportEmail={supportEmail} signedIn={Boolean(user)} />;

  if (user) {
    return (
      <Shell>
        <p className="kicker">Support</p>
        <h1>Most things are fixed from your own pages.</h1>
        <div className="mk-prose" style={{ maxWidth: 760 }}>{body}</div>
      </Shell>
    );
  }
  return (
    <MarketingShell>
      <section className="mk-wrap mk-section mk-prose">
        <div className="mk-kicker">Support</div>
        <h1 className="mk-h1 sm">Most things are fixed from your own pages.</h1>
        {body}
      </section>
    </MarketingShell>
  );
}
