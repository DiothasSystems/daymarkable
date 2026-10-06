/**
 * "Get the phone app": sent once to a subscriber, after checkout, when the app can be installed.
 *
 * The order is the founder's (October 2026): a customer subscribes on the website first, and only
 * then hears about the app — so this mail is how they learn it exists. It names only the stores
 * that actually carry the app; a phone whose store is not listed yet is pointed at the website's
 * /app page, which always shows the current links. Plain, like the other notices a person acts on.
 */
import type { OutgoingMail } from "./provider.js";

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface AppLinks {
  /** The Google Play listing, or null while the app is not there. */
  android: string | null;
  /** The App Store listing, or null while the app is not there. */
  ios: string | null;
}

export interface AppMailOptions {
  links: AppLinks;
  /** scriptumiq.com/app: the page that always has the current links. */
  pageUrl: string;
}

export function buildAppMail(to: string, userId: string, opts: AppMailOptions): OutgoingMail {
  const { android, ios } = opts.links;
  const stores: [string, string][] = [];
  if (ios) stores.push(["iPhone (App Store)", ios]);
  if (android) stores.push(["Android (Google Play)", android]);
  const missing = !ios ? "iPhone" : !android ? "Android" : null;

  const intro = [
    "Thank you for subscribing to ScriptumIQ. There is a phone app to go with it.",
    "It carries your Action List, your calendar and every day's notes, so you can tick something off, fix a misread word or add what you just agreed to when the tablet is at home. Change something there and the notebooks are rebuilt and sent back to your tablet.",
  ];
  const after = [
    ...(missing ? [`The ${missing} app is on its way; this page will have it as soon as it is out:`, opts.pageUrl] : []),
    "Sign in with this email address and your ScriptumIQ password. Your subscription stays on the website — the app never asks for a card.",
  ];

  const p = (s: string) => `<p>${esc(s)}</p>`;
  const link = (u: string) => `<p><a href="${esc(u)}">${esc(u)}</a></p>`;
  const html = `<div style="font-family:${SANS};font-size:15px;line-height:1.55;color:#1e2a44">${[
    ...intro.map(p),
    ...stores.map(([label, url]) => `<p><strong>${esc(label)}</strong><br><a href="${esc(url)}">${esc(url)}</a></p>`),
    ...after.map((s) => (s.startsWith("http") ? link(s) : p(s))),
  ].join("")}</div>`;
  const text = [...intro, ...stores.map(([label, url]) => `${label}\n${url}`), ...after].join("\n\n");

  return {
    to,
    subject: "Get the ScriptumIQ app",
    html,
    text,
    // Once per account: a redelivered webhook or a second sweep cannot send it again.
    idempotencyKey: `app-mail:${userId}`,
  };
}
