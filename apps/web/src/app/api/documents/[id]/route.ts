import { getSessionUser } from "@/server/auth";
import { readDocument } from "@/server/services";

export const runtime = "nodejs";

/** Streams a generated notebook from the 1-day cache. Never regenerates (rule 12). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const doc = await readDocument(user.id, id);
  if (!doc) return new Response("This document has left the 1-day cache. Run Sync now or wait for tonight's run.", { status: 404 });
  return new Response(Buffer.from(doc.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${doc.name.replace(/[^\w .-]/g, "")}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
