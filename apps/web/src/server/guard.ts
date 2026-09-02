import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./auth";

/** Server-component guard: signed in, and onboarded unless we are on the setup flow. */
export async function requireUser(options: { allowUnboarded?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.onboardedAt && !options.allowUnboarded) redirect("/setup");
  return user;
}
