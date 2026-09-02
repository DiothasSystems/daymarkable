/**
 * `pnpm dev:run` — execute a run now.
 *   --live         real tablet, real Claude, real render service (default: fixtures)
 *   --on-demand    on-demand run (standard API) instead of nightly (Batch)
 *   --date D       local date to run for (default: today in the user's timezone)
 *   --force        run even if the date is already satisfied
 *   --no-upload    compose but do not touch the tablet
 *   --window H     look back H hours instead of "previous local day" (bootstrap)
 *   --serve        start the 3AM scheduler loop and keep running
 */
import path from "node:path";
import { RemarkableCloudProvider } from "@daymarkable/tablet";
import { AnthropicDecoder, validateConventions } from "@daymarkable/decode";
import { Sealer, generateKey, openDb, schema, desc, eq, and } from "@daymarkable/db";
import { mailProviderFromEnv } from "@daymarkable/mail";
import { DateTime } from "luxon";
import { LocalCacheStore } from "./cache.js";
import { REPO_ROOT, STATE_DIR, loadConfig, writeEnvValue } from "./config.js";
import { FixtureDecoder, FixtureRenderer, FixtureTabletProvider } from "./fixtures.js";
import { HttpRenderer } from "./renderer.js";
import * as repo from "./repo.js";
import { runPipeline, type PipelineDeps } from "./run.js";
import { startScheduler } from "./scheduler.js";

const FIXTURE_ROOT = path.join(REPO_ROOT, "fixtures", "notebooks");

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Dogfood model rotation (BUILD_PLAN Phase 0 item 7): DECODE_MODEL_ROTATION="a,b,c" picks a
 * model by local day-of-year so consecutive nights compare models on similar pages, and every
 * run's run_costs rows carry the model that ran. Unset = DECODE_MODEL.
 */
export function pickRotatedModel(defaultModel: string, rotation: string | undefined, localNow: DateTime): string {
  const models = (rotation ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (models.length === 0) return defaultModel;
  return models[(localNow.ordinal - 1) % models.length]!;
}

function log(msg: string): void {
  console.log(`[run ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export async function buildDeps(live: boolean): Promise<{ deps: PipelineDeps; userId: string; close: () => Promise<void> }> {
  const cfg = loadConfig();
  if (!process.env.DATA_ENCRYPTION_KEY) {
    writeEnvValue("DATA_ENCRYPTION_KEY", generateKey());
    log("generated DATA_ENCRYPTION_KEY into .env (keep it: it unlocks the cache and stored tokens)");
  }
  const sealer = Sealer.fromEnv();
  const dbUrl = process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("postgres://daymarkable:daymarkable@localhost") ? process.env.DATABASE_URL : `pglite://${path.join(STATE_DIR, live ? "db" : "db-fixture")}`;
  const handle = await openDb(dbUrl);
  await handle.migrate();
  const email = process.env.USER_EMAIL || "jim.strothmann@gmail.com";
  const user = await repo.ensureUser(handle.db, email, cfg.timezone);
  if (process.env.INK_CONVENTIONS_JSON) {
    await handle.db.update(schema.users).set({ settings: { ...user.settings, conventions: validateConventions(JSON.parse(process.env.INK_CONVENTIONS_JSON)) as never } }).where(eq(schema.users.id, user.id));
  }
  const cache = new LocalCacheStore(path.join(STATE_DIR, live ? "cache" : "cache-fixture"), sealer);
  const model = user.settings.decodeModel ?? pickRotatedModel(cfg.decodeModel, process.env.DECODE_MODEL_ROTATION, DateTime.now().setZone(cfg.timezone));
  let deps: PipelineDeps;
  if (live) {
    let token = await repo.getDeviceToken(handle.db, sealer, user.id);
    if (!token && cfg.deviceToken) {
      await repo.saveDeviceToken(handle.db, sealer, user.id, cfg.deviceToken);
      token = cfg.deviceToken;
      log("device token from .env stored encrypted in the database");
    }
    if (!token) throw new Error("no device token: run `pnpm spike pair <code>` first");
    if (!cfg.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY missing in .env");
    const renderer = new HttpRenderer(cfg.renderServiceUrl);
    await renderer.check();
    deps = {
      db: handle.db,
      sealer,
      cache,
      tablet: await RemarkableCloudProvider.fromDeviceToken(token),
      renderer,
      decoder: new AnthropicDecoder({
        model,
        escalationModel: user.settings.escalationModel ?? cfg.escalationModel,
        confidenceThreshold: user.settings.confidenceThreshold,
        conventions: validateConventions(user.settings.conventions),
      }),
      mail: mailProviderFromEnv(process.env, async (mail) => log(`(no EMAIL_API_KEY) would email ${mail.to}: "${mail.subject}"`)),
      decodeModel: model,
      log,
    };
  } else {
    deps = {
      db: handle.db,
      sealer,
      cache,
      tablet: new FixtureTabletProvider(FIXTURE_ROOT, path.join(STATE_DIR, "fixture-tablet")),
      renderer: new FixtureRenderer(FIXTURE_ROOT),
      decoder: new FixtureDecoder(FIXTURE_ROOT),
      mail: mailProviderFromEnv({}, async (mail) => log(`fixture mail to ${mail.to}: "${mail.subject}"`)),
      decodeModel: "fixture-model",
      log,
    };
  }
  return { deps, userId: user.id, close: () => handle.close() };
}

async function main(): Promise<void> {
  const live = flag("live");
  const { deps, userId, close } = await buildDeps(live);
  try {
    if (flag("serve")) {
      log("scheduler started (15-minute ticks, 03:00 local)");
      startScheduler({
        timezone: async () => (await repo.getUser(deps.db, userId)).timezone,
        lastSatisfied: async () => {
          const last = await deps.db.query.runs.findFirst({ where: and(eq(schema.runs.userId, userId), eq(schema.runs.status, "succeeded")), orderBy: desc(schema.runs.finishedAt) });
          return { localDate: last?.localDate ?? null, finishedAt: last?.finishedAt ? DateTime.fromJSDate(last.finishedAt) : null };
        },
        runNightly: async (localDate) => {
          await runPipeline(deps, { userId, kind: "nightly", requestedVia: "scheduler", localDate });
        },
        log,
      });
      await new Promise(() => {}); // run forever
      return;
    }
    const windowOpt = opt("window");
    const outcome = await runPipeline(deps, {
      userId,
      kind: flag("on-demand") ? "on_demand" : "nightly",
      requestedVia: "cli",
      ...(opt("date") ? { localDate: opt("date")! } : {}),
      force: flag("force"),
      upload: !flag("no-upload"),
      ...(windowOpt ? { windowHours: Number(windowOpt) } : {}),
    });
    log(`outcome: ${outcome.status}${outcome.error ? ` — ${outcome.error}` : ""}`);
    if (outcome.status === "failed") process.exitCode = 1;
  } finally {
    if (!flag("serve")) await close();
  }
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exitCode = 1;
});
