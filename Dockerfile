# dayMarkable app image: Next.js web app + in-process 3AM scheduler + CLI runner.
# The whole workspace is installed and built in place so the transpiled packages keep their
# on-disk paths (fonts, migrations, fixtures) at runtime.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json vitest.config.mts ./
COPY packages ./packages
COPY apps ./apps
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile

# next/font downloads Google Fonts at build time; the build needs network access.
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN pnpm --filter @daymarkable/web build

ENV PORT=3000 DAYMARKABLE_STATE_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
# Migrate, then serve. The scheduler boots inside the web process (instrumentation.ts).
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @daymarkable/web start"]
