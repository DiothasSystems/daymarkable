import { audit, getAdminSession } from "@/server/admin";
import { inviteAddress, inviteResultRedirect } from "@/server/waitlist";

export const runtime = "nodejs";

/**
 * Invite an address that never asked on the public page: someone who wrote to you directly, or
 * one of your own for testing. Audited like the rest, because this is what grants access.
 */
export async function POST(req: Request) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const r = await inviteAddress(email);
  await audit(r.ok ? "waitlist.invite.direct" : "waitlist.invite.direct.failed", r.ok ? { email: r.email, mailed: r.mailed } : { message: r.message });
  return Response.redirect(new URL(inviteResultRedirect(r), req.url), 303);
}
