import { getAdminSession } from "@/server/admin";
import { recordBalance } from "@/server/ops";

export const runtime = "nodejs";

/** Operator records the Anthropic credit balance read off the Console. Audited in recordBalance. */
export async function POST(req: Request) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const raw = String(form.get("balance") ?? "").trim();
  // An empty field clears the balance rather than recording zero — "unknown" and "none left" are
  // different states, and only one of them should raise the alarm.
  const balance = raw === "" ? null : Number(raw);
  const r = await recordBalance(balance, Number(form.get("warnDays")));
  const to = new URL(r.ok ? "/admin/tokens?saved=1" : `/admin/tokens?error=${encodeURIComponent(r.message)}`, req.url);
  return Response.redirect(to, 303);
}
