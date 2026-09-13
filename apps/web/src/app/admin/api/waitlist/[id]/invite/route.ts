import { audit, getAdminSession } from "@/server/admin";
import { seeOther } from "@/server/redirect";
import { inviteFromWaitlist, inviteResultRedirect } from "@/server/waitlist";

export const runtime = "nodejs";

/**
 * Let one address off the waiting list. Audited like every other admin action (rule 13), because
 * this is what grants access to the product.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const r = await inviteFromWaitlist(id);
  await audit(r.ok ? "waitlist.invite" : "waitlist.invite.failed", r.ok ? { email: r.email, mailed: r.mailed } : { id, message: r.message });
  return seeOther(inviteResultRedirect(r));
}
