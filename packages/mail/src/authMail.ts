/**
 * The sign-in link.
 *
 * Deliberately plain, and the one dayMarkable mail that carries no branding at all. A styled
 * button, a brand bar and a destination hidden behind "Sign in" are the shape mail clients read
 * as a promotion — Gmail filed the earlier version under Promotions rather than the inbox — and
 * they also stop the reader checking where the link goes before they click it. A security
 * message should look like something a person typed: a few short lines, the address it signs in,
 * and the URL written out in full.
 *
 * Keep it that way. The test in mail.test.ts fails if a button, an image or a layout table
 * creeps back in.
 */
import type { OutgoingMail } from "./provider.js";

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One key per token, so a retry of the same request cannot send twice. */
export function signInIdempotencyKey(tokenHash: string): string {
  return `login:${tokenHash}`;
}

export function buildSignInMail(to: string, link: string, tokenHash: string, expiresInMinutes = 15): OutgoingMail {
  const opening = `Here is the sign-in link you asked for. It signs you in to dayMarkable as ${to}.`;
  const life = `The link works once, and stops working after ${expiresInMinutes} minutes.`;
  const unasked = "If you did not ask to sign in, ignore this message. The link is no use to anyone without this mailbox.";
  const html =
    `<div style="font-family:${SANS};font-size:15px;line-height:1.55;color:#1e2a44">` +
    `<p>${esc(opening)}</p>` +
    `<p><a href="${esc(link)}">${esc(link)}</a></p>` +
    `<p>${esc(life)}</p>` +
    `<p>${esc(unasked)}</p>` +
    `</div>`;
  return {
    to,
    subject: "Sign in to dayMarkable",
    html,
    text: [opening, link, life, unasked].join("\n\n"),
    idempotencyKey: signInIdempotencyKey(tokenHash),
  };
}
