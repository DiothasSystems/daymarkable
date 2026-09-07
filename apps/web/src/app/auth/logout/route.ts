import { publicUrl } from "@/lib/hosts";
import { logout } from "@/server/auth";

export const runtime = "nodejs";

export async function POST() {
  await logout();
  return Response.redirect(`${publicUrl()}/`, 303);
}
