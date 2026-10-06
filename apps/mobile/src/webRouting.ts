/**
 * Which pages the app shows inside itself, and which it hands to the phone's browser.
 *
 * Billing is ALWAYS the browser's, on Android and iOS alike (the founder's decision, October 2026,
 * and rule 14): the app never shows a price, a plan or a checkout. A customer subscribes on the
 * website before they ever install the app, and anything about their subscription afterwards —
 * changing the card, the plan, cancelling — happens there too. So a billing page is never loaded
 * in a WebView, whether the app asked for it or a page inside the app linked or redirected to it
 * (/setup sends an account that has not paid to /billing). Everything else that is ours stays in
 * the frame; the wider web goes to the browser as before.
 */
import { API_URL, siteUrl } from "@/api";

/**
 * Domains that are ours: the product's name, and the one it had until September 2026. The old one
 * stays because it still answers — it redirects to the new — and a frame that refused the hop would
 * throw a signed-in customer out to the phone's browser halfway through loading Settings.
 */
const OUR_DOMAINS = ["scriptumiq.com", "daymarkable.com"] as const;

/** Paths about money. Prefixes: /billing/success and friends count too. */
const BILLING_PATHS = ["/billing", "/subscription", "/pricing"] as const;

export type WebDestination = "frame" | "browser" | "billing";

/** Where a navigation inside the in-app web pages should go. */
export function destinationFor(url: string): WebDestination {
  if (url.startsWith("about:")) return "frame";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "browser";
  }
  const host = u.host;
  let ours = OUR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  try {
    ours ||= host === new URL(API_URL).host;
  } catch {
    // An unparseable API_URL only means no extra host is ours.
  }
  if (!ours) return "browser";
  if (BILLING_PATHS.some((p) => u.pathname === p || u.pathname.startsWith(`${p}/`))) return "billing";
  return "frame";
}

/** The subscription page, on the website, for the phone's browser. */
export function billingUrl(): string {
  return `${siteUrl()}/billing`;
}
