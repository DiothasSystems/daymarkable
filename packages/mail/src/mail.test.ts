import type { Meeting } from "@daymarkable/core";
import { describe, expect, it } from "vitest";
import { buildPasswordChangedMail, buildSetPasswordMail, buildSignInMail } from "./authMail.js";
import { buildDeliveryMail, buildDeliveryVerificationMail } from "./deliveryMail.js";
import { buildMeetingMail, meetingSubject } from "./meetingMail.js";
import { DEFAULT_FROM, MemoryProvider, ResendProvider, mailProviderFromEnv } from "./provider.js";

const m: Meeting = {
  id: "abc",
  topic: "Roadmap sync",
  date: "2026-09-02",
  time: "10:00",
  attendees: ["Priya"],
  text: "Discussed Q4.\n\nBudget ok.",
  decisions: ["Ship in Oct"],
  actions: ["Send Priya the deck"],
  confidence: 0.8,
  source: { notebook: "Work", pageIndex: 3 },
};

describe("meeting mail", () => {
  it("uses the topic — date time subject contract", () => {
    expect(meetingSubject(m)).toBe("Roadmap sync — Wed 2 Sep 2026 10:00");
    expect(meetingSubject({ ...m, time: null })).toBe("Roadmap sync — Wed 2 Sep 2026");
  });
  it("builds html + text parts with an idempotency key per (user, meeting, date)", () => {
    const mail = buildMeetingMail("jim@example.com", "user-1", m);
    expect(mail.to).toBe("jim@example.com");
    expect(mail.idempotencyKey).toBe("meeting:user-1:abc:2026-09-02");
    expect(mail.text).toContain("Ship in Oct");
    expect(mail.html).toContain("Send Priya the deck");
    expect(mail.html).not.toContain("<script");
  });
  it("memory provider records, resend provider posts", async () => {
    const mem = new MemoryProvider();
    await mem.send(buildMeetingMail("a@b.c", "u", m));
    expect(mem.sent).toHaveLength(1);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = new ResendProvider("key", "ScriptumIQ <x@y.z>", fake);
    const res = await r.send(buildMeetingMail("a@b.c", "u", m));
    expect(res).toEqual({ status: "sent", providerId: "re_123", error: null });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>)["idempotency-key"]).toBe("meeting:u:abc:2026-09-02");
  });
});

describe("delivery mail", () => {
  const pdf = (n: number) => new Uint8Array([37, 80, 68, 70, n]);
  const docs = [
    { name: "Planner", pdf: pdf(1), pageCount: 6 },
    { name: "Action List", pdf: pdf(2), pageCount: 3 },
    { name: "Notes", pdf: pdf(3), pageCount: 9 },
  ];

  it("attaches every document, named by kind and date", () => {
    const m = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 12, meetings: 2 });
    expect(m.to).toBe("them@example.com");
    expect(m.attachments?.map((a) => a.filename)).toEqual([
      "Planner-2026-09-06.pdf",
      "Action-List-2026-09-06.pdf",
      "Notes-2026-09-06.pdf",
    ]);
    expect(m.attachments?.[0]!.content).toEqual(pdf(1));
  });

  it("is keyed per user, date and address so a retry cannot double-send", () => {
    const a = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 0 });
    const b = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 0 });
    const other = buildDeliveryMail("other@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 0 });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(other.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it("summarises the run in both html and plain text", () => {
    const m = buildDeliveryMail("them@example.com", "u1", "2026-09-06", docs, { openActions: 1, meetings: 1 });
    expect(m.text).toContain("1 open actions, 1 meetings");
    expect(m.html).toContain("6 pages");
    expect(m.subject).toBe("ScriptumIQ — 2026-09-06");
  });

  it("the confirmation mail carries the link and no attachments", () => {
    const m = buildDeliveryVerificationMail("them@example.com", "u1", "https://app.scriptumiq.com/settings/verify-delivery?token=abc");
    expect(m.attachments).toBeUndefined();
    expect(m.html).toContain("verify-delivery?token=abc");
    expect(m.text).toContain("verify-delivery?token=abc");
    // Says plainly what happens if the recipient was not expecting it.
    expect(m.text.toLowerCase()).toContain("ignore");
  });
});

describe("sign-in mail", () => {
  const LINK = "https://scriptumiq.com/auth/verify?token=abc123";

  it("says who it signs in, and shows the link rather than hiding it behind a button", () => {
    const mail = buildSignInMail("jim@example.com", LINK, "hash-1", 15);
    expect(mail.subject).toBe("Sign in to ScriptumIQ");
    expect(mail.idempotencyKey).toBe("login:hash-1");
    expect(mail.html).toContain("jim@example.com");
    expect(mail.html).toContain(`>${LINK}</a>`);
    expect(mail.text).toContain(LINK);
    expect(mail.text).toContain("15 minutes");
  });

  // A security mail that looks like a newsletter gets filed as one, and hides where its link
  // goes. If any of this comes back, the mail stops reaching the inbox it is meant for.
  it("carries none of the shapes that read as a promotion", () => {
    const { html } = buildSignInMail("jim@example.com", LINK, "hash-1");
    expect(html).not.toMatch(/<img|<table|background(-color)?:/i);
    expect(html).not.toMatch(/border-radius|padding:\s*\d/i);
    expect(html).not.toContain("#c9973f");
  });

  it("escapes the address it greets", () => {
    const mail = buildSignInMail('x"<b>y@example.com', LINK, "h");
    expect(mail.html).not.toContain("<b>");
    expect(mail.html).toContain("&lt;b&gt;");
  });

  /**
   * This mail only goes out after the right password, so an unexpected one means the password is
   * known to someone else. It has to say that, and say where to fix it.
   */
  it("tells the reader what an unexpected one means, and where to reset", () => {
    const mail = buildSignInMail("jim@example.com", LINK, "h", 15, "https://scriptumiq.com/login?reset=1");
    expect(mail.text).toMatch(/someone else has your password/i);
    expect(mail.text).toContain("https://scriptumiq.com/login?reset=1");
  });
});

describe("password mail", () => {
  const SET = "https://scriptumiq.com/auth/set-password?token=xyz";
  const RESET = "https://scriptumiq.com/login?reset=1";

  it("sends the set-password link written out, once per token", () => {
    const mail = buildSetPasswordMail("jim@example.com", SET, "hash-9", 30);
    expect(mail.subject).toBe("Set your ScriptumIQ password");
    expect(mail.idempotencyKey).toBe("password-link:hash-9");
    expect(mail.html).toContain(`>${SET}</a>`);
    expect(mail.text).toContain("30 minutes");
    // Choosing a password is not signing in; the mail must not promise that it is.
    expect(mail.text).toMatch(/sign in with your new password/i);
  });

  it("tells the owner when the password changes, and how to take it back", () => {
    const changed = buildPasswordChangedMail("jim@example.com", { replaced: true, when: "2026-09-25 09:14 UTC", resetUrl: RESET, signedOutEverywhere: true });
    expect(changed.subject).toBe("Your ScriptumIQ password was changed");
    expect(changed.text).toContain(RESET);
    expect(changed.text).toMatch(/signed out/i);
    const first = buildPasswordChangedMail("jim@example.com", { replaced: false, when: "2026-09-25 09:14 UTC", resetUrl: RESET, signedOutEverywhere: false });
    expect(first.subject).toBe("Your ScriptumIQ password is set");
    expect(first.text).not.toMatch(/signed out/i);
  });

  it("looks like the sign-in mail: plain, nothing that reads as a promotion", () => {
    for (const { html } of [
      buildSetPasswordMail("jim@example.com", SET, "h"),
      buildPasswordChangedMail("jim@example.com", { replaced: true, when: "now", resetUrl: RESET, signedOutEverywhere: true }),
    ]) {
      expect(html).not.toMatch(/<img|<table|background(-color)?:|border-radius|padding:\s*\d/i);
    }
  });

  it("escapes the address", () => {
    expect(buildSetPasswordMail('x"<b>y@example.com', SET, "h").html).not.toContain("<b>");
  });
});

describe("provider selection", () => {
  it("sends from the domain the deploy runbook verifies, not one we do not own", () => {
    // This was `notes@daymarkable.app` — a domain this product has never owned. Resend answers a
    // 403 for an unverified sender, so every sign-in link failed to arrive while the app looked
    // like it had sent one. docs/DEPLOY.md says verify daymarkable.com and send from it.
    expect(DEFAULT_FROM).toContain("@daymarkable.com");
    expect(DEFAULT_FROM).not.toContain(".app");
  });

  /**
   * The rename to ScriptumIQ changes the NAME on the envelope and not yet the address. Sign-in is by
   * emailed link, so a default on scriptumiq.com before that domain is verified with Resend would
   * lock every account out — the failure the test above already records once. The address moves
   * when the operator sets EMAIL_FROM after verifying; the default follows only when this test does.
   */
  it("carries the new name on the domain that is already verified", () => {
    expect(DEFAULT_FROM).toMatch(/^ScriptumIQ </);
    expect(DEFAULT_FROM).not.toContain("scriptumiq.com");
  });

  it("only reaches for a real provider when there is a key to reach with", () => {
    expect(mailProviderFromEnv({} as NodeJS.ProcessEnv).name).toBe("memory");
    expect(mailProviderFromEnv({ EMAIL_API_KEY: "" } as NodeJS.ProcessEnv).name).toBe("memory");
    expect(mailProviderFromEnv({ EMAIL_API_KEY: "re_x" } as NodeJS.ProcessEnv).name).toBe("resend");
  });
});
