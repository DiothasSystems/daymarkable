/**
 * The dayMarkable API. The Phase 1 mobile app consumes exactly this router (AppRouter type)
 * with no changes: documents, registry, runs, sync now (shared quota), feedback, settings.
 * No payment procedures live here (rule 14): billing is web-page only.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { logout, requestMagicLink } from "./auth";
import * as svc from "./services";
import { protectedProcedure, publicProcedure, router } from "./trpc";

export const appRouter = router({
  auth: router({
    requestLink: publicProcedure.input(z.object({ email: z.string().max(200) })).mutation(({ input }) => requestMagicLink(input.email)),
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: protectedProcedure.mutation(async () => {
      await logout();
      return { ok: true };
    }),
  }),
  account: router({
    get: protectedProcedure.query(({ ctx }) => svc.getAccount(ctx.user.id)),
    updateSettings: protectedProcedure.input(svc.settingsPatchSchema).mutation(({ ctx, input }) => svc.updateSettings(ctx.user.id, input)),
    updateTimezone: protectedProcedure.input(z.object({ timezone: z.string().min(1) })).mutation(({ ctx, input }) => svc.updateTimezone(ctx.user.id, input.timezone)),
    completeOnboarding: protectedProcedure.mutation(({ ctx }) => svc.completeOnboarding(ctx.user.id)),
    pairTablet: protectedProcedure.input(z.object({ code: z.string().min(8).max(8) })).mutation(async ({ ctx, input }) => {
      try {
        return await svc.pairTablet(ctx.user.id, input.code);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
      }
    }),
    tabletFolders: protectedProcedure.query(({ ctx }) => svc.listTabletFolders(ctx.user.id)),
    timezones: publicProcedure.query(() => svc.listTimezones()),
  }),
  documents: router({
    list: protectedProcedure.query(({ ctx }) => svc.listDocuments(ctx.user.id)),
    registry: protectedProcedure.query(({ ctx }) => svc.getRegistry(ctx.user.id)),
  }),
  runs: router({
    list: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(30) }).optional()).query(({ ctx, input }) => svc.listRuns(ctx.user.id, input?.limit ?? 30)),
    get: protectedProcedure.input(z.object({ runId: z.string().uuid() })).query(({ ctx, input }) => svc.getRun(ctx.user.id, input.runId)),
    quota: protectedProcedure.query(({ ctx }) => svc.quotaStatus(ctx.user.id)),
    syncNow: protectedProcedure.input(z.object({ via: z.enum(["web", "mobile"]).default("web") }).optional()).mutation(async ({ ctx, input }) => {
      const r = await svc.syncNow(ctx.user.id, input?.via ?? "web");
      if (r.status === "exhausted") {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Sync quota used (${r.quota.limit} per ${r.quota.windowHours}h). Next available ${r.nextAvailableAt.toISOString()}`, cause: r });
      }
      return r;
    }),
  }),
  feedback: router({
    rate: protectedProcedure.input(z.object({ runId: z.string().uuid().nullable(), rating: z.number().int().min(1).max(5), comment: z.string().max(2000).nullable() })).mutation(({ ctx, input }) => svc.rateRun(ctx.user.id, input.runId, input.rating, input.comment)),
    summary: protectedProcedure.query(({ ctx }) => svc.feedbackSummary(ctx.user.id)),
  }),
});

export type AppRouter = typeof appRouter;
