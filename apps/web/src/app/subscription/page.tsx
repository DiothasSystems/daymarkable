import type { Metadata } from "next";
import Link from "next/link";
import { CancelSubscription } from "@/components/CancelSubscription";
import { Shell } from "@/components/Shell";
import { fmtDate } from "@/lib/format";
import { requireUser } from "@/server/guard";
import { cancelView, getAccount } from "@/server/services";

export const metadata: Metadata = { title: "Subscription" };
export const dynamic = "force-dynamic";

/**
 * What this account is on, when it renews, and how to stop it.
 *
 * Separate from /billing, which is the CHECKOUT page and lives on the public host. That page
 * redirects anyone who does not need to check out — so an account that has already paid, which is
 * every account that would want to look at its subscription, was bounced straight back out of it.
 * The app's "Subscription" button opened exactly that, and so appeared to do nothing at all.
 *
 * Separate from /account too, which holds the same facts at the bottom of fourteen other cards.
 * Someone asking when they renew should not have to scroll past their ink conventions to find out.
 *
 * Service host, not public: this is management of an existing subscription rather than a purchase,
 * the same side of rule 14 the cancel control has always sat on. The one deliberate omission is
 * price — what it costs is on /billing where the plan is chosen, and repeating it here would put a
 * figure on a phone screen for no purpose (rule 14).
 */
export default async function SubscriptionPage() {
  const user = await requireUser();
  const [account, cancel] = await Promise.all([getAccount(user.id), cancelView(user.id)]);

  // `endsAt` is when the current paid period runs out. That is a renewal date while the
  // subscription is live and an end date once it is cancelled — the same instant, two meanings, so
  // the label has to follow the state rather than being written once.
  const dated = cancel.endsAt ? fmtDate(cancel.endsAt.toISOString(), account.timezone) : null;

  return (
    <Shell>
      <div>
        <p className="kicker">{account.email}</p>
        <h1>Subscription</h1>
      </div>

      <div className="grid two">
        <section className="card">
          <h2>This account</h2>
          <p className="row between">
            <span className="muted">Signed in as</span>
            <strong>{account.email}</strong>
          </p>
          <p className="row between">
            <span className="muted">Status</span>
            <strong>{account.status}</strong>
          </p>
          {cancel.plan ? (
            <p className="row between">
              <span className="muted">Plan</span>
              <strong>{cancel.plan}</strong>
            </p>
          ) : null}
          {dated ? (
            <p className="row between">
              <span className="muted">{cancel.alreadyEnding ? "Access until" : "Renews"}</span>
              <strong>{dated}</strong>
            </p>
          ) : null}
          {cancel.alreadyEnding ? (
            <p className="meta">
              This subscription is already ending. Nothing more will be charged, and dayMarkable keeps
              reading your tablet until the date above.
            </p>
          ) : null}
          <p className="meta">
            Everything else about the account — your tablet, conventions, email and the rest — is on{" "}
            <Link href="/account">your account page</Link>.
          </p>
        </section>

        <section className="card">
          <h2>Cancel subscription</h2>
          <CancelSubscription
            subscriptionId={cancel.subscriptionId}
            plan={cancel.plan}
            endsAt={cancel.endsAt ? cancel.endsAt.toISOString().slice(0, 10) : null}
            alreadyEnding={cancel.alreadyEnding}
          />
        </section>
      </div>
    </Shell>
  );
}
