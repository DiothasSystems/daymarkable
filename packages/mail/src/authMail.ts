/**
 * The sign-in link.
 *
 * Deliberately plain, and the one ScriptumIQ mail that carries no branding at all. A styled
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

/**
 * The second step of signing in: the password was right, and this proves the mailbox.
 *
 * Since sign-in needs the password first, this mail only goes out after someone typed it correctly.
 * So an UNEXPECTED one no longer means "someone typed your address" — it means someone has your
 * password, and the message has to say so plainly, with what to do.
 */
export function buildSignInMail(to: string, link: string, tokenHash: string, expiresInMinutes = 15, resetUrl?: string): OutgoingMail {
  const opening = `Your password was accepted. Open this link to finish signing in to ScriptumIQ as ${to}.`;
  const life = `The link works once, and stops working after ${expiresInMinutes} minutes.`;
  const unasked =
    "If you did not just sign in, someone else has your password. Do not open the link, and set a new password" +
    (resetUrl ? ` at ${resetUrl}` : " from the sign-in page") +
    " — that signs out everyone else.";
  const html =
    `<div style="font-family:${SANS};font-size:15px;line-height:1.55;color:#1e2a44">` +
    `<p>${esc(opening)}</p>` +
    `<p><a href="${esc(link)}">${esc(link)}</a></p>` +
    `<p>${esc(life)}</p>` +
    `<p>${esc(unasked)}</p>` +
    `</div>`;
  return {
    to,
    subject: "Sign in to ScriptumIQ",
    html,
    text: [opening, link, life, unasked].join("\n\n"),
    idempotencyKey: signInIdempotencyKey(tokenHash),
  };
}

/** A plain security message: short paragraphs, links written out in full, no styling to hide behind. */
function plain(to: string, subject: string, paragraphs: string[], idempotencyKey: string, links: string[] = []): OutgoingMail {
  const isLink = (p: string) => links.includes(p);
  const html =
    `<div style="font-family:${SANS};font-size:15px;line-height:1.55;color:#1e2a44">` +
    paragraphs.map((p) => (isLink(p) ? `<p><a href="${esc(p)}">${esc(p)}</a></p>` : `<p>${esc(p)}</p>`)).join("") +
    `</div>`;
  return { to, subject, html, text: paragraphs.join("\n\n"), idempotencyKey };
}

/**
 * The link to choose a password — the first one, or a new one after forgetting it.
 *
 * It does not sign anyone in: after choosing, the customer signs in with the password like any
 * other time. That is what keeps "password, then this mailbox" true of every single sign-in.
 */
export function buildSetPasswordMail(to: string, link: string, tokenHash: string, expiresInMinutes = 30): OutgoingMail {
  return plain(
    to,
    "Set your ScriptumIQ password",
    [
      `Use this link to choose a password for ${to}.`,
      link,
      `It works once, and stops working after ${expiresInMinutes} minutes. Afterwards, sign in with your new password; we will email you a link to finish each time.`,
      "If you did not ask for this, ignore it. Nothing changes unless the link is opened and a password chosen.",
    ],
    `password-link:${tokenHash}`,
    [link],
  );
}

/**
 * Sent every time a password is set or changed, to the same address. If the change was not theirs,
 * this is how they find out — while there is still something to do about it.
 */
export function buildPasswordChangedMail(to: string, opts: { replaced: boolean; when: string; resetUrl: string; signedOutEverywhere: boolean }): OutgoingMail {
  const what = opts.replaced ? "Your ScriptumIQ password was changed" : "A password was set for your ScriptumIQ account";
  const paragraphs = [
    `${what} (${to}) at ${opts.when}.`,
    ...(opts.signedOutEverywhere ? ["Every device that was signed in has been signed out, and will need the new password."] : []),
    `If this was you, there is nothing to do. If it was not, set a new password now at ${opts.resetUrl}, and reply to this message.`,
  ];
  return plain(to, opts.replaced ? "Your ScriptumIQ password was changed" : "Your ScriptumIQ password is set", paragraphs, `password-changed:${to}:${opts.when}`);
}
