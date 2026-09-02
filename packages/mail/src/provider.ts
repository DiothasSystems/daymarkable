/**
 * Transactional email. Rule 10: mail goes ONLY to the account's registered address; the
 * `to` field is set by the runner from users.email and nowhere else.
 */
export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** (user, meeting, date) key so retries never double-send. */
  idempotencyKey: string;
}

export interface MailResult {
  status: "sent" | "failed" | "skipped";
  providerId: string | null;
  error: string | null;
}

export interface MailProvider {
  readonly name: string;
  send(mail: OutgoingMail): Promise<MailResult>;
}

/** Resend HTTPS API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendProvider implements MailProvider {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(mail: OutgoingMail): Promise<MailResult> {
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": mail.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { status: "failed", providerId: null, error: `resend ${res.status}: ${body.slice(0, 300)}` };
      }
      const json = (await res.json()) as { id?: string };
      return { status: "sent", providerId: json.id ?? null, error: null };
    } catch (err) {
      return { status: "failed", providerId: null, error: (err as Error).message };
    }
  }
}

/** Dev/test provider: records mail in memory (and optionally hands it to a sink) instead of sending. */
export class MemoryProvider implements MailProvider {
  readonly name = "memory";
  readonly sent: OutgoingMail[] = [];
  constructor(private readonly sink?: (mail: OutgoingMail) => Promise<void> | void) {}
  async send(mail: OutgoingMail): Promise<MailResult> {
    this.sent.push(mail);
    await this.sink?.(mail);
    return { status: "skipped", providerId: null, error: null };
  }
}

export function mailProviderFromEnv(env: NodeJS.ProcessEnv = process.env, sink?: (mail: OutgoingMail) => Promise<void> | void): MailProvider {
  if (env.EMAIL_API_KEY) return new ResendProvider(env.EMAIL_API_KEY, env.EMAIL_FROM || "dayMarkable <notes@daymarkable.app>");
  return new MemoryProvider(sink);
}
