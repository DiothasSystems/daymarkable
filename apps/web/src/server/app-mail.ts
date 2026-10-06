import "server-only";
/**
 * Telling a subscriber about the phone app (rule 14's order: subscribe on the web, then install).
 *
 * Two ways in, one function: right after a subscription is written (the checkout return and the
 * webhook, billing.ts), and a sweep on the scheduler's tick for everyone who subscribed before the
 * first store link was set. Each account is CLAIMED before it is mailed — `app_mail_sent_at` is set
 * only where it is still null — so the two paths racing each other send one mail, and a failed
 * send releases the claim for the next tick to try again. Nothing about the account is logged.
 */
import { and, eq, inArray, isNotNull, isNull, schema } from "@daymarkable/db";
import { buildAppMail } from "@daymarkable/mail";
import { appAvailable, appLinks, appMailDue } from "@/lib/app-links";
import { publicUrl } from "@/lib/hosts";
import { getRuntime } from "./runtime";

async function claimAndSend(userId: string): Promise<boolean> {
  const links = appLinks();
  const rt = await getRuntime();
  const user = await rt.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user || !appMailDue(user, links)) return false;
  const claimed = await rt.db
    .update(schema.users)
    .set({ appMailSentAt: new Date() })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.appMailSentAt)))
    .returning();
  if (!claimed.length) return false;
  try {
    await rt.mail.send(buildAppMail(user.email, user.id, { links, pageUrl: `${publicUrl()}/app` }));
    return true;
  } catch (err) {
    await rt.db.update(schema.users).set({ appMailSentAt: null }).where(eq(schema.users.id, userId));
    throw err;
  }
}

/** After a subscription is written. Never lets a mail problem fail the billing that called it. */
export async function sendAppMailIfDue(userId: string): Promise<void> {
  try {
    await claimAndSend(userId);
  } catch (err) {
    console.warn(`[app-mail] send failed: ${(err as Error).message}`);
  }
}

/** Everyone subscribed and not yet told. With no store link set it does not even query. */
export async function sendPendingAppMail(log: (m: string) => void): Promise<void> {
  if (!appAvailable(appLinks())) return;
  const rt = await getRuntime();
  const waiting = await rt.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(isNull(schema.users.appMailSentAt), isNotNull(schema.users.stripeSubscriptionId), inArray(schema.users.status, ["trial", "active"])));
  let sent = 0;
  for (const { id } of waiting) {
    try {
      if (await claimAndSend(id)) sent += 1;
    } catch (err) {
      log(`app mail failed for one account: ${(err as Error).message}`);
    }
  }
  if (sent) log(`app mail sent to ${sent} subscriber(s)`);
}
