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
 * Where the service lives. `EXPO_PUBLIC_API_URL` is baked in at build time; the fallback is a
 * dev machine's `pnpm web:dev`, which on a phone must be the machine's LAN address, not localhost.
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

/** The document routes are plain HTTP, so they carry the header themselves. */
export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await readStoredSession();
  const headers = new Headers(init.headers);
  if (session) headers.set("authorization", `Bearer ${session}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

/** What to put in front of the user when a call fails. Never a stack, never a tRPC shape. */
export function errorMessage(err: unknown): string {
  if (err instanceof TRPCClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof TRPCClientError && err.data?.code === "UNAUTHORIZED";
}
