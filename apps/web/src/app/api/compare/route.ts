import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "@daymarkable/pipeline";
import { getSessionUser } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves the newest model-comparison report (written by `pnpm compare`). Behind login, since
 * the report contains transcribed note text. Scripts are blocked outright by CSP.
 */
export async function GET(req: Request) {
  if (!(await getSessionUser())) return new Response("unauthorized", { status: 401 });
  const dir = path.join(STATE_DIR, "compare");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".html")).sort().reverse();
  } catch {
    files = [];
  }
  if (files.length === 0) {
    return new Response("No comparison report yet. Run: docker compose exec app pnpm compare --days 7", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const wanted = new URL(req.url).searchParams.get("file");
  const name = wanted && files.includes(wanted) ? wanted : files[0]!;
  const html = await readFile(path.join(dir, name), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
    },
  });
}
