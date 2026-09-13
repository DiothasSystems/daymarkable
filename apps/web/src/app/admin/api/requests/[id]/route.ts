import { getAdminSession, setRequestStatus, type RequestStatusValue } from "@/server/admin";
import { seeOther } from "@/server/redirect";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const r = await setRequestStatus(id, String(form.get("status") ?? "") as RequestStatusValue, String(form.get("note") ?? ""));
  return seeOther(r.ok ? "/admin/requests?saved=1" : `/admin/requests?error=${encodeURIComponent(r.message)}`);
}
