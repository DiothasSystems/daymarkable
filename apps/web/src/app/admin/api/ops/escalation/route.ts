import { getAdminSession } from "@/server/admin";
import { setDefaultEscalationThreshold } from "@/server/ops";
import { seeOther } from "@/server/redirect";

export const runtime = "nodejs";

/**
 * The confidence below which a page is read a second time on the escalation model, for every account
 * without an override (rule 13: audited in the service).
 */
export async function POST(req: Request) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const r = await setDefaultEscalationThreshold(Number(form.get("threshold")));
  return seeOther(r.ok ? "/admin/tokens?saved=1" : `/admin/tokens?error=${encodeURIComponent(r.message)}`);
}
