/**
 * One Drizzle client, two drivers:
 *   DATABASE_URL=postgres://...   -> node-postgres (production on Hostinger)
 *   DATABASE_URL=pglite://<dir>   -> embedded Postgres (PGlite) for local dev/tests
 *   DATABASE_URL=pglite://memory  -> in-memory PGlite (unit tests)
 */
import { mkdirSync } from "node:fs";
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
export const MIGRATIONS_DIR = path.resolve(here, "..", "drizzle");

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
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzlePg(pool, { schema });
  return {
    db,
    driver: "pg",
    migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => pool.end(),
  };
}
