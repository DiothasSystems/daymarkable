import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getSessionUser } from "@/server/auth";
import { appRouter } from "@/server/router";

export const runtime = "nodejs";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => ({ user: await getSessionUser() }),
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        const cause = (error.cause as { cause?: Error } | undefined)?.cause;
        console.error(`[trpc] ${path}: ${error.message}${cause ? ` | cause: ${cause.stack ?? cause.message}` : ""}`);
      }
    },
  });

export { handler as GET, handler as POST };
