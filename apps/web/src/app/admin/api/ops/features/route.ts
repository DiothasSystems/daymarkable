import { getAdminSession } from "@/server/admin";
import { setNewUserFeatures } from "@/server/ops";
import { seeOther } from "@/server/redirect";

export const runtime = "nodejs";

/**
 * Switch the daily extras off for accounts created from here on (rule 13: audited in the service).
 * An unchecked box is absent from a form post, so both are read as present-or-not rather than
 * parsed — which is also why both are always sent as a pair.
 */
export async function POST(req: Request) {
  if (!(await getAdminSession())) return Response.json({ message: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  await setNewUserFeatures({ news: form.get("news") !== null, puzzle: form.get("puzzle") !== null });
  return seeOther("/admin/tokens?saved=1");
}
