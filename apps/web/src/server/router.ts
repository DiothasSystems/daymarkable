/**
 * The ScriptumIQ API. The Phase 1 mobile app consumes this router (AppRouter type): documents,
 * registry, runs, sync now (shared quota), feedback, settings. The one thing it needed that the
 * web did not is a sign-in it can complete without a cookie — `auth.claim`, see device-login.ts.
 * No payment procedures live here (rule 14): billing is web-page only.
 */
import { TRPCError } from "@trpc/server";
import { DrizzleQueryError } from "drizzle-orm";
import { z } from "zod";
import { claimMobileSession, handoffUrl, logout, passwordLinkEmail, requestMagicLink, requestPasswordLink, setPassword } from "./auth";
import { PASSWORD_MAX } from "./password-core";
import { PANE_NAMES } from "./handoff";
import * as svc from "./services";
import { joinWaitlist } from "./waitlist";
import { protectedProcedure, publicProcedure, router } from "./trpc";

/**
 * Turn a thrown service error into the answer the caller should get.
 *
 * The services throw `new Error("a sentence for the user")` for the things a user can actually do
 * something about — too short, too many in an hour, that code is not a pairing code. Those are
 * BAD_REQUEST and the message is the point of them.
 *
 * A database failure is not that, and must not be dressed as it. Drizzle's message is the whole
 * failed statement, so handing it on put this in front of someone asking for a feature:
 *
 *     Failed query: select "id", "user_id", "kind", "body", "status", ... from "feature_requests"
 *
 * which tells them nothing they can act on, tells them their request was refused when in truth it
 * was never stored, and puts the schema on a phone screen. So it becomes a plain 500, and the
 * statement goes to the server log where whoever can fix it will look. Rule 5 is why the log gets
 * the query and not the body: the query is ours, the body is theirs.
 */
function serviceError(err: unknown, where: string): TRPCError {
  if (err instanceof DrizzleQueryError) {
    // The CAUSE is the half worth having. Drizzle's own message is the statement it tried, which
    // says what was asked and never why it was refused; Postgres' error underneath it is the one
    // that names a missing relation or a bad type. Chasing this without the cause meant reading a
    // perfectly good SELECT and guessing.
    const cause = err.cause as Error | undefined;
    console.error(`[trpc] ${where}: database error: ${cause?.message ?? "no cause"} | ${err.message}`);
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Something on our side failed. It has been logged — please try again shortly." });
  }
  return new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
}

export const appRouter = router({
  auth: router({
    /**
     * Sign-in, step one: address and password. Only a right answer mints and mails the link that
     * finishes it (auth.ts). The password is bounded by length only here, never by the rules for a
     * new one: a password set under older rules must keep working.
     */
    requestLink: publicProcedure
      .input(z.object({ email: z.string().max(200), password: z.string().max(PASSWORD_MAX), client: z.enum(["web", "mobile"]).default("web") }))
      .mutation(({ input }) => requestMagicLink(input.email, input.password, input.client)),
    /** "Set or reset your password": mails a link to choose one. Same reply whatever happens (rule 15). */
    requestPasswordLink: publicProcedure.input(z.object({ email: z.string().max(200) })).mutation(({ input }) => requestPasswordLink(input.email)),
    /** Choose the password from the link. Signs nobody in: they sign in with it next. */
    setPassword: publicProcedure
      .input(z.object({ token: z.string().min(1).max(200), password: z.string().max(PASSWORD_MAX + 1) }))
      .mutation(({ input }) => setPassword(input.token, input.password)),
    /**
     * Native sign-in, step three: the app trades the secret it kept for the session the emailed
     * link created (device-login.ts). Public by necessity — there is no session yet — and
     * incurious by design: "pending" until the link is tapped, and for a secret that was never
     * issued, which is what keeps this from answering who has an account.
     */
    claim: publicProcedure.input(z.object({ pollSecret: z.string().min(1).max(200) })).mutation(({ input }) => claimMobileSession(input.pollSecret)),
    /**
     * A one-time URL that opens one of the web's own pages already signed in (server/handoff.ts).
     * The pane is a name rather than a path, so the redirect is not something a caller chooses.
     */
    webHandoff: protectedProcedure
      .input(z.object({ pane: z.enum(PANE_NAMES) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.bearer) throw new TRPCError({ code: "BAD_REQUEST", message: "this is for the app; a browser already has the cookie" });
        return { url: await handoffUrl(ctx.bearer, input.pane) };
      }),
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: protectedProcedure.mutation(async ({ ctx }) => {
      await logout(ctx.bearer);
      return { ok: true };
    }),
  }),
  /**
   * Public, and deliberately incurious: it answers the same for an address that is new, already
   * waiting, already invited, or already has an account. Anything else would let a stranger use
   * the registration page to find out who has one.
   */
  waitlist: router({
    join: publicProcedure.input(z.object({ email: z.string().max(320) })).mutation(({ input }) => joinWaitlist(input.email, "start")),
  }),
  account: router({
    get: protectedProcedure.query(({ ctx }) => svc.getAccount(ctx.user.id)),
    updateSettings: protectedProcedure.input(svc.settingsPatchSchema).mutation(({ ctx, input }) => svc.updateSettings(ctx.user.id, input)),
    updateTimezone: protectedProcedure.input(z.object({ timezone: z.string().min(1) })).mutation(({ ctx, input }) => svc.updateTimezone(ctx.user.id, input.timezone)),
    completeOnboarding: protectedProcedure.mutation(({ ctx }) => svc.completeOnboarding(ctx.user.id)),
    rotateCalendarAddress: protectedProcedure.mutation(({ ctx }) => svc.rotateCalendarAddress(ctx.user.id)),
    pairTablet: protectedProcedure.input(z.object({ code: z.string().min(8).max(8) })).mutation(async ({ ctx, input }) => {
      try {
        return await svc.pairTablet(ctx.user.id, input.code);
      } catch (err) {
        throw serviceError(err, "account.pairTablet");
      }
    }),
    tabletFolders: protectedProcedure.query(({ ctx }) => svc.listTabletFolders(ctx.user.id)),
    timezones: publicProcedure.query(() => svc.listTimezones()),
    // Empty string clears the address; anything else is saved unconfirmed and mailed a link.
    setDeliveryEmail: protectedProcedure.input(z.object({ email: z.string().max(320) })).mutation(async ({ ctx, input }) => {
      try {
        return await svc.setDeliveryEmail(ctx.user.id, input.email);
      } catch (err) {
        throw serviceError(err, "account.setDeliveryEmail");
      }
    }),
  }),
  documents: router({
    list: protectedProcedure.query(({ ctx }) => svc.listDocuments(ctx.user.id)),
    registry: protectedProcedure.query(({ ctx }) => svc.getRegistry(ctx.user.id)),
    /** A span of dates with repeating series expanded — what a month grid needs (rule 1). */
    calendar: protectedProcedure
      .input(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        try {
          return await svc.getCalendar(ctx.user.id, input.from, input.to);
        } catch (err) {
          throw serviceError(err, "documents.calendar");
        }
      }),
    republish: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        return await svc.republish(ctx.user.id);
      } catch (err) {
        throw serviceError(err, "documents.republish");
      }
    }),
    // Tick an item off or drop it — the same transitions a pen makes on a printed page.
    decide: protectedProcedure
      .input(z.object({
        itemType: z.enum(["task", "event", "inbox", "meeting_request", "meeting"]),
        itemId: z.string().min(1),
        action: z.enum(["complete", "drop"]),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await svc.decideItem(ctx.user.id, input.itemType, input.itemId, input.action);
        } catch (err) {
          throw serviceError(err, "documents.decide");
        }
      }),
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
  calibration: router({
    get: protectedProcedure.query(({ ctx }) => svc.getCalibration(ctx.user.id)),
    create: protectedProcedure.input(svc.profileSchema).mutation(async ({ ctx, input }) => {
      try {
        return await svc.createCalibrationSheet(ctx.user.id, input);
      } catch (err) {
        throw serviceError(err, "calibration.create");
      }
    }),
    calibrate: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        return await svc.calibrateNow(ctx.user.id);
      } catch (err) {
        throw serviceError(err, "calibration.calibrate");
      }
    }),
    skip: protectedProcedure.mutation(({ ctx }) => svc.skipCalibration(ctx.user.id)),
    setLexicon: protectedProcedure.input(z.object({ terms: z.array(z.string().max(80)).max(400) })).mutation(({ ctx, input }) => svc.updateLexicon(ctx.user.id, input.terms)),
  }),
  subscription: router({
    view: protectedProcedure.query(({ ctx }) => svc.cancelView(ctx.user.id)),
    cancel: protectedProcedure.mutation(async ({ ctx }) => {
      const r = await svc.cancelSubscriptionForUser(ctx.user.id);
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.message });
      return r;
    }),
  }),
  requests: router({
    mine: protectedProcedure.query(({ ctx }) => svc.myRequests(ctx.user.id)),
    submit: protectedProcedure
      .input(z.object({ kind: z.enum(svc.REQUEST_KINDS), body: z.string().min(1).max(4000) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await svc.submitRequest(ctx.user.id, input.kind, input.body);
        } catch (err) {
          throw serviceError(err, "requests.submit");
        }
      }),
  }),
  /**
   * Editing what the lists say — the mobile app's reason for existing, and available to the web
   * on the same terms. Deliberately NOT `corrections` below: that one teaches the decoder, this
   * one only changes the plan. See packages/pipeline/src/edits.ts for why they must stay apart.
   *
   * There is no `delete`. An item leaves the list by being ticked or dropped (`documents.decide`,
   * rule 8), which is the same pair of exits a printed page offers. A note is deleted the same way:
   * `documents.decide` with itemType "meeting" and action "drop".
   */
  items: router({
    /**
     * The stored row, for an editor to open. Not the registry's or the calendar's view of it:
     * both project a repeating series onto a date it lands on, and saving that back would move
     * the series anchor. See packages/pipeline/src/edits.ts.
     */
    get: protectedProcedure
      .input(z.object({ itemType: z.enum(["task", "event", "meeting"]), itemId: z.string().min(1).max(64) }))
      .query(async ({ ctx, input }) => {
        try {
          return await svc.getItemForEdit(ctx.user.id, input.itemType, input.itemId);
        } catch (err) {
          throw new TRPCError({ code: "NOT_FOUND", message: (err as Error).message });
        }
      }),
    update: protectedProcedure.input(svc.itemEditSchema).mutation(async ({ ctx, input }) => {
      try {
        return await svc.updateItem(ctx.user.id, input);
      } catch (err) {
        throw serviceError(err, "items.update");
      }
    }),
    create: protectedProcedure.input(svc.newItemSchema).mutation(async ({ ctx, input }) => {
      try {
        return await svc.createItem(ctx.user.id, input);
      } catch (err) {
        throw serviceError(err, "items.create");
      }
    }),
  }),
  corrections: router({
    fix: protectedProcedure
      .input(z.object({ itemType: z.enum(["task", "event", "meeting", "inbox"]), itemId: z.string().min(1), text: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await svc.correctItem(ctx.user.id, input.itemType, input.itemId, input.text);
        } catch (err) {
          throw serviceError(err, "corrections.fix");
        }
      }),
    history: protectedProcedure.query(({ ctx }) => svc.correctionHistory(ctx.user.id)),
  }),
  feedback: router({
    rate: protectedProcedure.input(z.object({ runId: z.string().uuid().nullable(), rating: z.number().int().min(1).max(5), comment: z.string().max(2000).nullable() })).mutation(({ ctx, input }) => svc.rateRun(ctx.user.id, input.runId, input.rating, input.comment)),
    summary: protectedProcedure.query(({ ctx }) => svc.feedbackSummary(ctx.user.id)),
  }),
});

export type AppRouter = typeof appRouter;
