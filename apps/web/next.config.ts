import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@daymarkable/core", "@daymarkable/db", "@daymarkable/decode", "@daymarkable/mail", "@daymarkable/pipeline", "@daymarkable/tablet", "@daymarkable/compose"],
  serverExternalPackages: ["@electric-sql/pglite", "pg", "pdf-lib", "@pdf-lib/fontkit", "rmapi-js", "@anthropic-ai/sdk", "bcryptjs", "dotenv"],
  // No `output: "standalone"`: the Docker image installs the whole workspace (the packages
  // read fonts and migrations from their own directories at runtime), so the container runs
  // `next start`. Standalone would require `node .next/standalone/server.js` instead.
  poweredByHeader: false,
  // The workspace packages are NodeNext ESM (imports end in .js but the sources are .ts).
  // webpack maps the extension; run with `next dev --webpack` / `next build --webpack`.
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return cfg;
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    },
  ],
};

export default config;
