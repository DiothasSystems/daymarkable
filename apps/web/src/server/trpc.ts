import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { SessionUser } from "./auth";

export interface Context {
  user: SessionUser | null;
  /** The session id a native client signed in with, when that is how it arrived. Null for a cookie. */
  bearer: string | null;
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { user: ctx.user } });
});
