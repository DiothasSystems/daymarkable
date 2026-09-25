import { cookies } from "next/headers";
import { ADMIN_COOKIE, ADMIN_PENDING_COOKIE, adminVerifyCode } from "@/server/admin";

export const runtime = "nodejs";

/**
 * Admin sign-in, step two: the emailed code, answered from the browser holding the pending cookie
 * that step one set. Success swaps the pending cookie for the session; a spent challenge clears it.
 */
export async function POST(req: Request) {
  let body: { code?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ message: "bad request" }, { status: 400 });
  }
  const pending = (await cookies()).get(ADMIN_PENDING_COOKIE)?.value;
  const r = await adminVerifyCode(pending, String(body.code ?? "").slice(0, 20));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const clearPending = `${ADMIN_PENDING_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;

  if (!r.ok) {
    const headers = new Headers({ "content-type": "application/json" });
    if (r.restart) headers.append("set-cookie", clearPending);
    return new Response(JSON.stringify({ message: r.message, restart: r.restart }), { status: r.status, headers });
  }
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", `${ADMIN_COOKIE}=${r.token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${r.maxAgeSec}${secure}`);
  headers.append("set-cookie", clearPending);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
