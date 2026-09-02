import { deleteAccount, getAdminSession } from "@/server/admin";

export const runtime = "nodejs";

/** Destructive: requires an admin session AND the account email typed exactly (rule 13). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const typed = String(form.get("confirm") ?? "");
  const r = await deleteAccount(id, typed);
  const to = new URL(r.ok ? "/admin/users?deleted=1" : `/admin/users/${id}?error=${encodeURIComponent(r.message)}`, req.url);
  return Response.redirect(to, 303);
}
