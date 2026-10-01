/**
 * Tell the operator when an email fails to send.
 *
 * A failed sign-in mail is invisible from the outside: the login page says "we emailed a link"
 * whatever happens next, because saying otherwise would tell whoever typed the address whether it
 * has an account (rule 18). On 2026-09-30 every mail failed for an evening — the API key was
 * restricted to the old domain — and the only trace was a line in the server log. This puts the
 * failure in the operator's inbox instead.
 *
 * The honest limit: the alert travels through the same provider. A failure specific to one message
 * or recipient, or a passing outage, gets through; a provider refusing EVERYTHING (a revoked or
 * mis-scoped key, as on that evening) refuses the alert too. That case is logged loudly as
 * "mail is down", which is the line to look for.
 *
 * At most one alert an hour: a broken key fails every send, and one mail saying so is the point,
 * not one per sign-in attempt. The hour is in the idempotency key, so a restart inside the hour
 * cannot send it twice either. The alert carries the kind of mail (the idempotency key's prefix),
 * the recipient and the provider's error — never the subject or body, which can carry a meeting's
 * topic (rule 5).
 */
import type { MailProvider, MailResult, OutgoingMail } from "./provider.js";

export const ALERT_KEY_PREFIX = "mail-alert";

export class AlertingMailProvider implements MailProvider {
  readonly name: string;
  private alertedHour: string | null = null;

  constructor(
    private readonly inner: MailProvider,
    private readonly alertTo: string,
    private readonly log: (line: string) => void = (l) => console.error(l),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.name = inner.name;
  }

  async send(mail: OutgoingMail): Promise<MailResult> {
    const res = await this.inner.send(mail);
    if (res.status === "failed" && !mail.idempotencyKey.startsWith(`${ALERT_KEY_PREFIX}:`)) await this.alert(mail, res);
    return res;
  }

  private async alert(failed: OutgoingMail, res: MailResult): Promise<void> {
    const at = this.now();
    const hour = at.toISOString().slice(0, 13);
    if (this.alertedHour === hour) return;
    this.alertedHour = hour;
    const kind = failed.idempotencyKey.split(":")[0] || "unknown";
    const lines = [
      `A ${kind} email to ${failed.to} could not be sent at ${at.toISOString().replace("T", " ").slice(0, 16)} UTC.`,
      "",
      `Provider said: ${res.error ?? "no reason given"}`,
      "",
      "If this is a sign-in link, the person saw \"we emailed a link\" and nothing arrived.",
      "Further failures this hour are in the server log only:",
      "  cd /root/daymarkable && docker compose logs --since 2h app | grep -i \"failed\"",
    ];
    const sent = await this.inner
      .send({
        to: this.alertTo,
        subject: `ScriptumIQ — a ${kind} email failed to send`,
        text: lines.join("\n"),
        html: `<pre style="font:13px ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(lines.join("\n"))}</pre>`,
        idempotencyKey: `${ALERT_KEY_PREFIX}:${hour}`,
      })
      .catch((err: unknown): MailResult => ({ status: "failed", providerId: null, error: (err as Error).message }));
    if (sent.status === "failed") this.log(`[mail] mail is down: a ${kind} email failed AND the alert to the operator failed too (${sent.error})`);
    else this.log(`[mail] a ${kind} email failed; operator alerted`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
