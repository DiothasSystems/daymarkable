import { describe, expect, it } from "vitest";
import { ALERT_KEY_PREFIX, AlertingMailProvider } from "./alerting.js";
import { mailProviderFromEnv, type MailProvider, type MailResult, type OutgoingMail } from "./provider.js";

/** A provider that fails whatever matches `fails`, and records everything it was asked to send. */
function fake(fails: (m: OutgoingMail) => boolean) {
  const asked: OutgoingMail[] = [];
  const provider: MailProvider = {
    name: "fake",
    async send(m): Promise<MailResult> {
      asked.push(m);
      return fails(m) ? { status: "failed", providerId: null, error: "resend 403: not authorized" } : { status: "sent", providerId: "id", error: null };
    },
  };
  return { provider, asked };
}

const mail = (key: string, to = "jim@example.com"): OutgoingMail => ({ to, subject: "Roadmap with Priya — 2026-09-30", html: "<p>secret notes</p>", text: "secret notes", idempotencyKey: key });

describe("AlertingMailProvider", () => {
  it("mails the operator when a send fails, and still reports the failure to the caller", async () => {
    const { provider, asked } = fake((m) => m.to === "jim@example.com");
    const logs: string[] = [];
    const alerting = new AlertingMailProvider(provider, "ops@example.com", (l) => logs.push(l));
    const res = await alerting.send(mail("login:hash-1"));
    expect(res.status).toBe("failed");
    const alert = asked[1]!;
    expect(alert.to).toBe("ops@example.com");
    expect(alert.subject).toBe("ScriptumIQ — a login email failed to send");
    expect(alert.text).toContain("jim@example.com");
    expect(alert.text).toContain("resend 403: not authorized");
    expect(logs).toEqual(["[mail] a login email failed; operator alerted"]);
  });

  it("never carries the failed mail's subject or body, which can name a meeting (rule 5)", async () => {
    const { provider, asked } = fake((m) => m.to === "jim@example.com");
    await new AlertingMailProvider(provider, "ops@example.com", () => {}).send(mail("meeting:u:abc:2026-09-30"));
    const alert = asked[1]!;
    for (const field of [alert.subject, alert.text, alert.html]) {
      expect(field).not.toContain("Roadmap");
      expect(field).not.toContain("secret notes");
    }
  });

  it("alerts once an hour, not once per failure", async () => {
    const { provider, asked } = fake((m) => m.to === "jim@example.com");
    let now = new Date("2026-09-30T21:05:00Z");
    const alerting = new AlertingMailProvider(provider, "ops@example.com", () => {}, () => now);
    await alerting.send(mail("login:a"));
    await alerting.send(mail("login:b"));
    now = new Date("2026-09-30T21:59:00Z");
    await alerting.send(mail("login:c"));
    expect(asked.filter((m) => m.to === "ops@example.com")).toHaveLength(1);
    now = new Date("2026-09-30T22:01:00Z");
    await alerting.send(mail("login:d"));
    const alerts = asked.filter((m) => m.to === "ops@example.com");
    expect(alerts.map((m) => m.idempotencyKey)).toEqual([`${ALERT_KEY_PREFIX}:2026-09-30T21`, `${ALERT_KEY_PREFIX}:2026-09-30T22`]);
  });

  it("says mail is down when the alert fails too — the evening the key was mis-scoped", async () => {
    const { provider, asked } = fake(() => true);
    const logs: string[] = [];
    await new AlertingMailProvider(provider, "ops@example.com", (l) => logs.push(l)).send(mail("login:x"));
    // One try at the alert, and no alert about the alert.
    expect(asked).toHaveLength(2);
    expect(logs[0]).toMatch(/^\[mail\] mail is down: a login email failed AND the alert to the operator failed too/);
  });

  it("is silent when the send works", async () => {
    const { provider, asked } = fake(() => false);
    await new AlertingMailProvider(provider, "ops@example.com", () => {}).send(mail("login:ok"));
    expect(asked).toHaveLength(1);
  });

  it("wraps the real provider only when an operator address is configured", () => {
    expect(mailProviderFromEnv({ EMAIL_API_KEY: "re_x", MAIL_ALERT_EMAIL: "ops@example.com" } as NodeJS.ProcessEnv)).toBeInstanceOf(AlertingMailProvider);
    expect(mailProviderFromEnv({ EMAIL_API_KEY: "re_x", MAIL_ALERT_EMAIL: "" } as NodeJS.ProcessEnv)).not.toBeInstanceOf(AlertingMailProvider);
    expect(mailProviderFromEnv({ EMAIL_API_KEY: "re_x" } as NodeJS.ProcessEnv).name).toBe("resend");
  });
});
