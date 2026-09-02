import { ADMIN_COOKIE, audit, getAdminSession } from "@/server/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (await getAdminSession()) await audit("admin.logout");
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/admin/login", req.url).toString(), "set-cookie": `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0` },
  });
}
