import { ADMIN_COOKIE, adminLogin } from "@/server/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { loginId?: string; password?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ message: "bad request" }, { status: 400 });
  }
  const r = await adminLogin(String(body.loginId ?? "").slice(0, 200), String(body.password ?? "").slice(0, 500));
  if (!r.ok) return Response.json({ message: r.message }, { status: r.status });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${ADMIN_COOKIE}=${r.token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${r.maxAgeSec}${secure}`,
    },
  });
}
