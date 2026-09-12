import "server-only";
import { eq, schema } from "@daymarkable/db";
import { buildInviteMail } from "@daymarkable/mail";
import { normalizeEmail } from "@/lib/email";
import { publicUrl } from "@/lib/hosts";
import { getRuntime } from "./runtime";

/**
 * The waiting list, which is how someone becomes allowed to open an account.
 *
 * Registration is not open. Phase 0 runs one tenant and there is nothing in place to charge a
 * stranger with, so the public site takes an address and puts it here rather than pretending to
 * sign them up. An operator turns a row to invited when they want that person in, and the sign-in
 * guard reads this table, so the invitation is the whole of what admits them.
 *
 * Nothing here tells the caller whether an address is already known. A registration form that
 * answers differently for a known address is an account-existence oracle, and this one is public.
 */

export interface JoinResult {
  ok: true;
}

/**
 * Always the same answer, whether the address is new, already waiting, already invited, or
 * already has an account. The caller shows one message for all of them.
 */
export async function joinWaitlist(rawEmail: string, source = "start"): Promise<JoinResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: true };
  const rt = await getRuntime();
  await rt.db
    .insert(schema.waitlist)
    .values({ email, source: source.slice(0, 40) })
    .onConflictDoNothing({ target: schema.waitlist.email });
  return { ok: true };
}

/** Whether this address has been let through. Read by the sign-in guard, so it must stay cheap. */
export async function isInvited(email: string): Promise<boolean> {
  const rt = await getRuntime();
  const row = await rt.db.query.waitlist.findFirst({ where: eq(schema.waitlist.email, email) });
  return row?.state === "invited" || row?.state === "joined";
}

/** Called once the invited address has actually signed in and an account exists for it. */
export async function markJoined(email: string): Promise<void> {
  const rt = await getRuntime();
  await rt.db
    .update(schema.waitlist)
    .set({ state: "joined", joinedAt: new Date() })
    .where(eq(schema.waitlist.email, email));
}

export interface WaitlistRow {
  id: string;
  email: string;
  state: "waiting" | "invited" | "joined";
  source: string;
  createdAt: Date;
  invitedAt: Date | null;
  joinedAt: Date | null;
}

export async function listWaitlist(): Promise<WaitlistRow[]> {
  const rt = await getRuntime();
  const rows = await rt.db.query.waitlist.findMany();
  return [...rows].sort((a, b) => {
    const rank = { waiting: 0, invited: 1, joined: 2 } as const;
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export type InviteResult = { ok: true; email: string; mailed: boolean } | { ok: false; message: string };

/**
 * The mail carries no token, only the address of the sign-in page: they still have to ask for a
 * link and prove they hold the mailbox, so a forwarded invitation is worthless.
 *
 * A host with no mail provider still invites the address; it just says so, because the operator
 * then has to tell the person by hand rather than assuming a mail went out.
 */
async function sendInvite(email: string): Promise<InviteResult> {
  const rt = await getRuntime();
  const res = await rt.mail.send(buildInviteMail(email, `${publicUrl()}/login`));
  if (res.status === "failed") return { ok: false, message: `Marked invited, but the email failed: ${res.error}` };
  return { ok: true, email, mailed: res.status === "sent" };
}

/** Let someone in who asked on the public page. */
export async function inviteFromWaitlist(id: string): Promise<InviteResult> {
  const rt = await getRuntime();
  const row = await rt.db.query.waitlist.findFirst({ where: eq(schema.waitlist.id, id) });
  if (!row) return { ok: false, message: "No such waiting list entry." };
  if (row.state === "joined") return { ok: false, message: "That address already has an account." };

  if (row.state !== "invited") {
    await rt.db.update(schema.waitlist).set({ state: "invited", invitedAt: new Date() }).where(eq(schema.waitlist.id, id));
  }
  return sendInvite(row.email);
}

/**
 * Let in an address that never asked: someone who wrote to you directly, or one of your own for
 * testing. It joins the list already invited, so the table stays the one answer to who may open
 * an account and there is no second place to look.
 */
export async function inviteAddress(rawEmail: string): Promise<InviteResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, message: "That does not look like an email address." };
  const rt = await getRuntime();
  const existing = await rt.db.query.waitlist.findFirst({ where: eq(schema.waitlist.email, email) });
  if (existing) return inviteFromWaitlist(existing.id);
  await rt.db.insert(schema.waitlist).values({ email, source: "admin", state: "invited", invitedAt: new Date() });
  return sendInvite(email);
}

/** Where to send the operator afterwards, including the case where no mail could go out. */
export function inviteResultRedirect(r: InviteResult): string {
  if (!r.ok) return `/admin/waitlist?error=${encodeURIComponent(r.message)}`;
  const key = r.mailed ? "invited" : "unmailed";
  return `/admin/waitlist?${key}=${encodeURIComponent(r.email)}`;
}

export interface WaitlistCounts {
  waiting: number;
  invited: number;
  joined: number;
}

export async function waitlistCounts(): Promise<WaitlistCounts> {
  const rows = await listWaitlist();
  return {
    waiting: rows.filter((r) => r.state === "waiting").length,
    invited: rows.filter((r) => r.state === "invited").length,
    joined: rows.filter((r) => r.state === "joined").length,
  };
}
