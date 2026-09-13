"use client";
import { useState } from "react";

export interface BillingActionsProps {
  userId: string;
  email: string;
  status: string;
  plan: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  refund: { usd: number; unusedDays: number; totalDays: number } | null;
}

/**
 * Cancel and prorated refund. Both take money decisions, so both confirm — the refund by typing
 * the amount, which also pins the figure the server will accept (rule 13's typed confirmation,
 * applied to the action that moves money rather than only to deletion).
 */
export function BillingActions({ userId, email, status, plan, periodEnd, cancelAtPeriodEnd, refund }: BillingActionsProps) {
  const [typed, setTyped] = useState("");
  const armed = refund !== null && Number(typed) === refund.usd && refund.usd > 0;
  const action = `/admin/api/users/${userId}/billing`;

  return (
    <>
      <div className="card">
        <p className="kicker">Cancel service</p>
        <p className="muted" style={{ fontSize: 13 }}>
          {cancelAtPeriodEnd
            ? `Already set to end${periodEnd ? ` on ${periodEnd}` : " at period end"}.`
            : `${plan ?? "Subscription"} · ${status}${periodEnd ? ` · period ends ${periodEnd}` : ""}.`}{" "}
          Ending at period end is the fair default: they have paid for the period, so they keep it. Stripe&apos;s webhook
          moves the account status, so nothing is written here by hand.
        </p>
        <form action={action} method="post" className="stack" onSubmit={(e) => { if (!window.confirm(`End ${email}'s subscription at period end?`)) e.preventDefault(); }}>
          <input type="hidden" name="action" value="cancel_period_end" />
          <button type="submit" disabled={cancelAtPeriodEnd}>End at period end</button>
        </form>
        <form action={action} method="post" className="stack" style={{ marginTop: 8 }} onSubmit={(e) => { if (!window.confirm(`Cancel ${email}'s subscription immediately, with no refund?`)) e.preventDefault(); }}>
          <input type="hidden" name="action" value="cancel_now" />
          <button type="submit" className="secondary small">Cancel immediately (no refund)</button>
        </form>
      </div>

      <div className="card">
        <p className="kicker">Refund prorated</p>
        {refund === null ? (
          <p className="muted" style={{ fontSize: 13 }}>No paid invoice on this subscription to refund against.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13 }}>
              {refund.unusedDays} of {refund.totalDays} days unused on the period they have paid for ={" "}
              <strong>${refund.usd.toFixed(2)}</strong>. Refunding also cancels the subscription immediately. The server
              recomputes this figure and refuses a stale one.
            </p>
            <form
              action={action}
              method="post"
              className="stack"
              onSubmit={(e) => { if (!armed || !window.confirm(`Refund $${refund.usd.toFixed(2)} to ${email} and cancel now?`)) e.preventDefault(); }}
            >
              <input type="hidden" name="action" value="refund" />
              <input type="hidden" name="amount" value={refund.usd} />
              <div className="field">
                <label htmlFor="refund-confirm">Type the amount to confirm</label>
                <input
                  id="refund-confirm"
                  type="text"
                  className="mono"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={refund.usd.toFixed(2)}
                />
              </div>
              <button type="submit" className="danger" disabled={!armed}>Refund ${refund.usd.toFixed(2)} and cancel</button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
