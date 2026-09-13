import { cancelForUser, getAdminSession, refundProratedForUser } from "@/server/admin";

export const runtime = "nodejs";

/** Cancel or prorated refund (rule 13): admin session required, both audited in the service. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const r =
    action === "cancel_now"
      ? await cancelForUser(id, "now")
      : action === "cancel_period_end"
        ? await cancelForUser(id, "period_end")
        : action === "refund"
          ? await refundProratedForUser(id, Number(form.get("amount")))
          : { ok: false as const, message: `unknown action "${action.slice(0, 40)}"` };
  const to = new URL(r.ok ? `/admin/users/${id}?billed=${encodeURIComponent(r.message)}` : `/admin/users/${id}?error=${encodeURIComponent(r.message)}`, req.url);
  return Response.redirect(to, 303);
}
