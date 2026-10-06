import { appleAppSiteAssociation } from "@/server/aasa";

export const dynamic = "force-dynamic";

/** Served at /.well-known/apple-app-site-association (next.config rewrites); see server/aasa.ts. */
export function GET() {
  const body = appleAppSiteAssociation(process.env.APPLE_TEAM_ID);
  if (!body) return new Response("Not found", { status: 404 });
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}
