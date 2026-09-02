import "server-only";
import { redirect } from "next/navigation";
import { getAdminSession, type AdminSession } from "./admin";

export async function requireAdmin(): Promise<AdminSession> {
  const s = await getAdminSession();
  if (!s) redirect("/admin/login");
  return s;
}
