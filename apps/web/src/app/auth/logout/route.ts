import { logout } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  await logout();
  return Response.redirect(new URL("/login", req.url), 303);
}
