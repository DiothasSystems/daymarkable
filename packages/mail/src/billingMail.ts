/**
 * Billing notices: the invitation that lets someone open an account, and the warning that a trial
 * is about to be charged.
 *
 * Both are plain for the same reason the sign-in mail is. They are messages a person is waiting
 * on, or needs to act on, and a styled template gets them filed with the newsletters. The trial
 * notice in particular has to arrive: the terms promise a reminder before the first charge, and a
 * reminder that lands in Promotions has not been given.
 */
import type { OutgoingMail } from "./provider.js";

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plain(paragraphs: readonly string[]): string {
  return `<div style="font-family:${SANS};font-size:15px;line-height:1.55;color:#1e2a44">${paragraphs
    .map((p) => (p.startsWith("http") ? `<p><a href="${esc(p)}">${esc(p)}</a></p>` : `<p>${esc(p)}</p>`))
    .join("")}</div>`;
}

function longDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(d);
}

/**
 * Sent when an operator lets someone off the waiting list. It carries no token: the address still
 * has to ask for a sign-in link and prove it owns the mailbox, so forwarding this to a friend
 * gives them nothing.
 */
export function buildInviteMail(to: string, signInUrl: string): OutgoingMail {
  const paragraphs = [
    "Your dayMarkable account is open. You asked to be told when there was room, and there is.",
    signInUrl,
    "Sign in with this address and you will be walked through pairing your reMarkable, choosing which notebooks are read, and what your ink conventions mean. It takes about ten minutes, most of it writing one page by hand.",
    "The first fourteen nights are free.",
  ];
  return {
    to,
    subject: "Your dayMarkable account is open",
    html: plain(paragraphs),
    text: paragraphs.join("\n\n"),
    idempotencyKey: `invite:${to}`,
  };
}

export interface TrialEndingOptions {
  planLabel: string;
  amount: string;
  endsAt: Date | null;
  accountUrl: string;
  timeZone?: string;
}

/**
 * Stripe sends the event that triggers this three days before the trial converts, so the clock is
 * Stripe's rather than ours and the reminder cannot drift away from the charge it warns about.
 */
export function buildTrialEndingMail(to: string, userId: string, opts: TrialEndingOptions): OutgoingMail {
  const tz = opts.timeZone ?? "UTC";
  const when = opts.endsAt ? `on ${longDate(opts.endsAt, tz)}` : "in three days";
  const paragraphs = [
    `Your dayMarkable trial ends ${when}. The card you put on file will then be charged ${opts.amount} for the ${opts.planLabel.toLowerCase()} plan, and your notebooks keep being read every night.`,
    "Nothing is needed from you if that is what you want.",
    "To change plan, update the card, or stop before then:",
    opts.accountUrl,
  ];
  return {
    to,
    subject: `Your dayMarkable trial ends ${opts.endsAt ? longDate(opts.endsAt, tz) : "in three days"}`,
    html: plain(paragraphs),
    text: paragraphs.join("\n\n"),
    // Keyed on the trial end, so a redelivered webhook cannot warn the same person twice.
    idempotencyKey: `trial-ending:${userId}:${opts.endsAt ? opts.endsAt.toISOString().slice(0, 10) : "soon"}`,
  };
}
