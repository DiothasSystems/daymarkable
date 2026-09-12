import { audit, getAdminSession } from "@/server/admin";
import { inviteFromWaitlist } from "@/server/waitlist";

export const runtime = "nodejs";

/**
 * Let one address off the waiting list. Audited like every other admin action (rule 13), because
 * this is what grants access to the product.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const r = await inviteFromWaitlist(id);
  await audit(r.ok ? "waitlist.invite" : "waitlist.invite.failed", r.ok ? { email: r.email } : { id, message: r.message });
  const to = new URL(
    r.ok ? `/admin/waitlist?invited=${encodeURIComponent(r.email)}` : `/admin/waitlist?error=${encodeURIComponent(r.message)}`,
    req.url,
  );
  return Response.redirect(to, 303);
}
