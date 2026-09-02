import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { openDb } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "..", "..", "..", ".env") });

const handle = await openDb();
await handle.migrate();
console.log(`migrations applied (${handle.driver})`);
await handle.close();
