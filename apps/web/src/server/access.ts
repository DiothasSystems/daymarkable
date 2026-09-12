import "server-only";
import { eq, schema } from "@daymarkable/db";
import { getRuntime } from "./runtime";
import { isInvited } from "./waitlist";

/**
 * Who may sign in, and on what grounds.
 *
 * This is the durable half of the question. The sign-in guard needs the answer, and the public
 * registration page needs the reason: an address that already has an account must be told to sign
 * in rather than handed whatever the current way in happens to be. That is true regardless of how
 * people are let in, so it is decided once, here, rather than at each caller.
 *
 * The `invited` branch is the part that is temporary. While registration is closed, an operator
 * lets people through a waiting list; when it opens, that branch goes and this module does not.
 */

export type SignInEligibility =
  /** No account, no invitation: cannot sign in today. */
  | "none"
  /** Already has an account. */
  | "account"
  /** Approved but has never turned up. Temporary: goes when registration opens. */
  | "invited"
  /** The address in USER_EMAIL, which owns this installation. */
  | "owner"
  /** No accounts exist at all, so the first address through the door becomes the operator. */
  | "bootstrap";

export async function signInEligibility(email: string): Promise<SignInEligibility> {
  const rt = await getRuntime();
  if (await rt.db.query.users.findFirst({ where: eq(schema.users.email, email) })) return "account";
  const configured = (process.env.USER_EMAIL || "").trim().toLowerCase();
  if (configured && configured === email) return "owner";
  if (await isInvited(email)) return "invited";
  return (await rt.db.query.users.findFirst()) ? "none" : "bootstrap";
}

/** Whether an address may ask for a sign-in link at all. */
export async function maySignIn(email: string): Promise<boolean> {
  return (await signInEligibility(email)) !== "none";
}
