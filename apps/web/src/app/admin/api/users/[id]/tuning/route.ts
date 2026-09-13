import { getAdminSession, updateDecodeTuning } from "@/server/admin";
import { seeOther } from "@/server/redirect";

export const runtime = "nodejs";

/** Operator-only decode tuning (rule 13): admin session required, and the change is audited. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const decode = String(form.get("decodeModel") ?? "").trim();
  const escalation = String(form.get("escalationModel") ?? "").trim();
  const r = await updateDecodeTuning(id, {
    confidenceThreshold: Number(form.get("confidenceThreshold")),
    decodeModel: decode || null,
    escalationModel: escalation || null,
  });
  return seeOther(r.ok ? `/admin/users/${id}?tuned=1` : `/admin/users/${id}?error=${encodeURIComponent(r.message)}`);
}
