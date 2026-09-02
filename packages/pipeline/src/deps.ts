/**
 * Runtime assembly shared by the CLI runner, the scheduler, and the web app.
 *   openRuntime()      -> db, sealer, cache, mail, config (no tablet, no decoder yet)
 *   pipelineDepsFor()  -> everything runPipeline needs for one user (tablet from the encrypted
 *                         token in the DB, renderer, decoder with the night's model)
 */
import path from "node:path";
import { RemarkableCloudProvider, type TabletProvider } from "@daymarkable/tablet";
import { AnthropicDecoder, validateConventions, type Decoder } from "@daymarkable/decode";
import { Sealer, generateKey, openDb, type Db, type DbHandle } from "@daymarkable/db";
import { mailProviderFromEnv, type MailProvider } from "@daymarkable/mail";
import { DateTime } from "luxon";
import { LocalCacheStore, type CacheStore } from "./cache.js";
import { REPO_ROOT, STATE_DIR, loadConfig, writeEnvValue, type RunnerConfig } from "./config.js";
import { FixtureDecoder, FixtureRenderer, FixtureTabletProvider } from "./fixtures.js";
import { HttpRenderer, type Renderer } from "./renderer.js";
import * as repo from "./repo.js";
import type { PipelineDeps } from "./run.js";

export type RuntimeMode = "live" | "fixture";

export interface Runtime {
  mode: RuntimeMode;
  db: Db;
  handle: DbHandle;
  sealer: Sealer;
  cache: CacheStore;
  mail: MailProvider;
  config: RunnerConfig;
  log: (msg: string) => void;
  close(): Promise<void>;
}

export const FIXTURE_ROOT = path.join(REPO_ROOT, "fixtures", "notebooks");

/**
 * Dogfood model rotation (BUILD_PLAN Phase 0 item 7): DECODE_MODEL_ROTATION="a,b,c" picks a
 * model by local day-of-year so consecutive nights compare models on similar pages; every
 * run's run_costs rows carry the model that ran. Unset = DECODE_MODEL.
 */
export function pickRotatedModel(defaultModel: string, rotation: string | undefined, localNow: DateTime): string {
  const models = (rotation ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (models.length === 0) return defaultModel;
  return models[(localNow.ordinal - 1) % models.length]!;
}

function defaultLog(msg: string): void {
  console.log(`[dm ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export async function openRuntime(mode: RuntimeMode, options: { log?: (msg: string) => void; databaseUrl?: string } = {}): Promise<Runtime> {
  const log = options.log ?? defaultLog;
  const config = loadConfig();
  if (!process.env.DATA_ENCRYPTION_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("DATA_ENCRYPTION_KEY must be set in the host environment (openssl rand -base64 32)");
    writeEnvValue("DATA_ENCRYPTION_KEY", generateKey());
    log("generated DATA_ENCRYPTION_KEY into .env (keep it: it unlocks the cache and stored tokens)");
  }
  const sealer = Sealer.fromEnv();
  const dbUrl = options.databaseUrl ?? (mode === "live" && process.env.DATABASE_URL ? process.env.DATABASE_URL : `pglite://${path.join(STATE_DIR, mode === "live" ? "db" : "db-fixture")}`);
  const handle = await openDb(dbUrl);
  await handle.migrate();
  const cache = new LocalCacheStore(path.join(STATE_DIR, mode === "live" ? "cache" : "cache-fixture"), sealer);
  const mail =
    mode === "live"
      ? mailProviderFromEnv(process.env, async (m) => log(`(no EMAIL_API_KEY) would email ${m.to}: "${m.subject}"`))
      : mailProviderFromEnv({} as NodeJS.ProcessEnv, async (m) => log(`fixture mail to ${m.to}: "${m.subject}"`));
  return { mode, db: handle.db, handle, sealer, cache, mail, config, log, close: () => handle.close() };
}

/** Phase 0: the one account, created from USER_EMAIL/USER_TIMEZONE on first use. */
export async function ensureDefaultUser(rt: Runtime): Promise<repo.UserRow> {
  const email = process.env.USER_EMAIL || "jim.strothmann@gmail.com";
  const user = await repo.ensureUser(rt.db, email, rt.config.timezone);
  if (rt.mode === "live") {
    const stored = await repo.getDeviceToken(rt.db, rt.sealer, user.id);
    if (!stored && rt.config.deviceToken) {
      await repo.saveDeviceToken(rt.db, rt.sealer, user.id, rt.config.deviceToken);
      rt.log("device token from .env stored encrypted in the database");
    }
  }
  return user;
}

export async function tabletFor(rt: Runtime, userId: string): Promise<TabletProvider> {
  if (rt.mode === "fixture") return new FixtureTabletProvider(FIXTURE_ROOT, path.join(STATE_DIR, "fixture-tablet"));
  const token = await repo.getDeviceToken(rt.db, rt.sealer, userId);
  if (!token) throw new Error("tablet not paired yet");
  return RemarkableCloudProvider.fromDeviceToken(token);
}

export async function pipelineDepsFor(rt: Runtime, userId: string, log = rt.log): Promise<PipelineDeps> {
  const user = await repo.getUser(rt.db, userId);
  if (rt.mode === "fixture") {
    return {
      db: rt.db,
      sealer: rt.sealer,
      cache: rt.cache,
      tablet: await tabletFor(rt, userId),
      renderer: new FixtureRenderer(FIXTURE_ROOT),
      decoder: new FixtureDecoder(FIXTURE_ROOT),
      mail: rt.mail,
      decodeModel: "fixture-model",
      log,
    };
  }
  if (!rt.config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY missing in .env");
  const model = user.settings.decodeModel ?? pickRotatedModel(rt.config.decodeModel, process.env.DECODE_MODEL_ROTATION, DateTime.now().setZone(user.timezone));
  const renderer: Renderer = new HttpRenderer(rt.config.renderServiceUrl);
  await (renderer as HttpRenderer).check();
  const decoder: Decoder = new AnthropicDecoder({
    model,
    escalationModel: user.settings.escalationModel ?? rt.config.escalationModel,
    confidenceThreshold: user.settings.confidenceThreshold,
    conventions: validateConventions(user.settings.conventions),
  });
  return { db: rt.db, sealer: rt.sealer, cache: rt.cache, tablet: await tabletFor(rt, userId), renderer, decoder, mail: rt.mail, decodeModel: model, log };
}
