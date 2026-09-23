/**
 * The tRPC client, typed by the server's own router.
 *
 * `AppRouter` comes straight from apps/web (tsconfig `paths` maps it; the import is type-only, so
 * Metro never sees the web's server code). That is the whole reason the API was written as one
 * router: the app cannot drift from it without the compiler saying so.
 *
 * Auth is a bearer header rather than a cookie — `apps/web/src/server/auth.ts`.
 */
import { TRPCClientError, createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@daymarkable/api";
import { readStoredSession } from "./session";

/**
 * Where the service lives.
 *
 * `EXPO_PUBLIC_API_URL` is baked in at build time and must be set for anything that runs on a
 * real device: the fallback below is a dev machine's `pnpm web:dev`, and `localhost` on a phone
 * is the phone. A build for the store points this at the service host.
 *
 * It is deliberately NOT defaulted to production. A forgotten variable that quietly talks to the
 * live service with real data is a worse failure than one that cannot connect and says so.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Raised when the server says the session is no longer good; the app signs out on it. */
export class Unauthorized extends Error {
  constructor() {
    super("signed out");
    this.name = "Unauthorized";
  }
}

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      transformer: superjson,
      async headers() {
        const session = await readStoredSession();
        return session ? { authorization: `Bearer ${session}` } : {};
      },
    }),
  ],
});

/**
 * What to put in front of the user when a call fails. Never a stack, never a tRPC shape.
 *
 * A transport failure gets the address it could not reach appended, because on a phone the usual
 * cause is `EXPO_PUBLIC_API_URL` still pointing at a dev machine — `localhost` on a device is the
 * device. Without the address the failure reads as "the sign-in email did not send", which sends
 * you looking at the mail provider for a problem that is on this side of the wire.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) {
    // A transport failure has no server response behind it, so it carries no `data`.
    if (!err.data) return `Could not reach ${API_URL} — ${err.message}`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof TRPCClientError && err.data?.code === "UNAUTHORIZED";
}
