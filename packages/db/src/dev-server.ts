/**
 * Local Postgres for development without Docker: PGlite behind a Postgres wire-protocol
 * socket, so the web app and the runner use the production `pg` driver and one process
 * owns the embedded database.
 *
 *   pnpm db:dev            -> postgres://postgres:postgres@127.0.0.1:5433/postgres
 *
 * Data dir: PGLITE_DATA_DIR or <state dir>/pgdata (outside any synced folder).
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const stateDir =
  process.env.DAYMARKABLE_STATE_DIR ||
  (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "dayMarkable") : path.join(os.homedir(), ".daymarkable"));
const dataDir = process.env.PGLITE_DATA_DIR || path.join(stateDir, "pgdata");
const port = Number(process.env.PGLITE_PORT || 5433);
mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create(dataDir);
// Several clients (web app, runner CLI, a restarted web app whose old socket lingers) may be
// attached at once; the multiplexer serializes their queries onto the single PGlite instance.
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: Number(process.env.PGLITE_MAX_CONNECTIONS || 16) });
await server.start();
console.log(`[db:dev] PGlite serving postgres://postgres:postgres@127.0.0.1:${port}/postgres from ${dataDir}`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
