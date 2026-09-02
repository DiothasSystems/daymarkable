/**
 * One Drizzle client, two drivers:
 *   DATABASE_URL=postgres://...   -> node-postgres (production on Hostinger)
 *   DATABASE_URL=pglite://<dir>   -> embedded Postgres (PGlite) for local dev/tests
 *   DATABASE_URL=pglite://memory  -> in-memory PGlite (unit tests)
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzlePglite<typeof schema>>;

export interface DbHandle {
  db: Db;
  driver: "pg" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** Migrations ship in packages/db/drizzle; bundlers relocate this module, so try the known homes. */
export const MIGRATIONS_DIR =
  [process.env.DAYMARKABLE_MIGRATIONS_DIR, path.resolve(here, "..", "drizzle"), path.resolve(process.cwd(), "packages", "db", "drizzle"), path.resolve(process.cwd(), "..", "..", "packages", "db", "drizzle")]
    .filter((p): p is string => !!p)
    .find((p) => existsSync(path.join(p, "meta", "_journal.json"))) ?? path.resolve(here, "..", "drizzle");

export async function openDb(url = process.env.DATABASE_URL): Promise<DbHandle> {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (url.startsWith("pglite://")) {
    const target = url.slice("pglite://".length);
    const inMemory = target === "memory" || target === "";
    if (!inMemory) mkdirSync(target, { recursive: true });
    const client = inMemory ? new PGlite() : new PGlite(target);
    const db = drizzlePglite(client, { schema });
    return {
      db,
      driver: "pglite",
      migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => client.close(),
    };
  }
  // PG_POOL_MAX=1 when the server is the PGlite socket (single-connection database); default 10 for real Postgres.
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10) });
  const db = drizzlePg(pool, { schema });
  return {
    db,
    driver: "pg",
    migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => pool.end(),
  };
}
