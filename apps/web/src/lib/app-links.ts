/**
 * Where the phone app can be installed from, and who should be told about it. Pure, so the /app page
 * and the mail (server/app-mail.ts) read the same answer and it can be tested.
 *
 * The links are configuration, not code: `ANDROID_APP_URL` and `IOS_APP_URL` in the server's .env,
 * set when each store listing goes live. Until one is set the app is not announced to anybody — the
 * founder's choice (October 2026) — and setting the first one is what sends the mail, to every
 * subscriber already waiting and then to each new one after checkout.
 */
import type { AppLinks } from "@daymarkable/mail";

/** A store link must be https; anything else in the setting is treated as not set. */
function link(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

export function appLinks(env: Record<string, string | undefined> = process.env): AppLinks {
  return { android: link(env.ANDROID_APP_URL), ios: link(env.IOS_APP_URL) };
}

export function appAvailable(links: AppLinks): boolean {
  return Boolean(links.android || links.ios);
}

/**
 * Whether this account should get the app mail now: the app is in a store, the account has been
 * through checkout and is in good standing, and it has not been told already.
 *
 * Checkout is proved by the Stripe subscription, not by the status: every account row starts as
 * "trial" by default, including an invited address that has not paid anything yet.
 */
export function appMailDue(user: { status: string; stripeSubscriptionId: string | null; appMailSentAt: Date | null }, links: AppLinks): boolean {
  return appAvailable(links) && Boolean(user.stripeSubscriptionId) && (user.status === "trial" || user.status === "active") && !user.appMailSentAt;
}
