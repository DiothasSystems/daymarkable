/**
 * The admin audit trail (rule 13), in its own module so every layer can write to it.
 *
 * It lives here rather than in admin.ts because the reporting code in ops.ts records operator
 * actions too, and admin.ts reads from ops.ts — putting `audit` in either one makes a cycle.
 */
import "server-only";
import { schema } from "@daymarkable/db";
import { headers } from "next/headers";
import { adminConfigFromEnv } from "./admin-core";
import { getRuntime } from "./runtime";

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

/** Append-only: every admin action lands here, with who, from where, and what changed. */
export async function audit(action: string, detail: Record<string, unknown> = {}, targetUserId: string | null = null): Promise<void> {
  const rt = await getRuntime();
  const cfg = adminConfigFromEnv();
  await rt.db.insert(schema.adminAudit).values({ adminLoginId: cfg?.loginId ?? "unknown", action, targetUserId, detail, ip: await clientIp() });
}
