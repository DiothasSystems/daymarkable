import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { STARTER_CONVENTIONS, validateConventions, type UserInkConventions } from "@daymarkable/decode";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const ENV_PATH = path.join(REPO_ROOT, ".env");
dotenv.config({ path: ENV_PATH });

/**
 * Runtime state (embedded DB, encrypted 1-day cache) lives OUTSIDE the repo by default so a
 * synced folder (OneDrive/Dropbox) never mirrors it and never locks PGlite's files.
 * Override with DAYMARKABLE_STATE_DIR (the Docker image sets it to a volume).
 */
export const STATE_DIR =
  process.env.DAYMARKABLE_STATE_DIR ||
  (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "dayMarkable")
    : path.join(os.homedir(), ".daymarkable"));

export interface RunnerConfig {
  deviceToken: string | null;
  anthropicApiKey: string | null;
  decodeModel: string;
  /**
   * The model for the jobs that are not reading handwriting: the news brief and the crossword's
   * words. Deliberately NOT `decodeModel`.
   *
   * Two different questions were being answered by one setting. Which model reads a page is a
   * cost-versus-accuracy choice about handwriting; which model runs a web search is a question of
   * capability, and getting it wrong is not a degradation but a hard failure — a real 400 from the
   * API: "claude-haiku-4-5 does not support programmatic tool calling. The following tools have
   * allowed_callers that require it: web_search". A host tuned down to a cheaper decoder would have
   * silently lost its daily brief every night.
   */
  newsModel: string;
  escalationModel: string | null;
  confidenceThreshold: number;
  /** Give up on the Batch API discount after this long and finish on the standard API. */
  batchTimeoutMinutes: number;
  renderServiceUrl: string;
  timezone: string;
  conventions: UserInkConventions;
}

export function loadConfig(): RunnerConfig {
  const env = process.env;
  let conventions = STARTER_CONVENTIONS;
  if (env.INK_CONVENTIONS_JSON) {
    conventions = validateConventions(JSON.parse(env.INK_CONVENTIONS_JSON));
  }
  return {
    deviceToken: env.RMAPI_DEVICE_TOKEN || null,
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    decodeModel: env.DECODE_MODEL || "claude-sonnet-5",
    newsModel: env.NEWS_MODEL || "claude-haiku-4-5",
    escalationModel: env.DECODE_ESCALATION_MODEL === "" ? null : (env.DECODE_ESCALATION_MODEL ?? "claude-opus-5"),
    confidenceThreshold: Number(env.DECODE_CONFIDENCE_THRESHOLD ?? "0.7"),
    batchTimeoutMinutes: Number(env.DECODE_BATCH_TIMEOUT_MINUTES ?? "45"),
    renderServiceUrl: env.RENDER_SERVICE_URL || "http://127.0.0.1:8787",
    timezone: env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
    conventions,
  };
}

/** Upsert KEY=value in .env (creating it from .env.example on first use). Values never logged. */
export function writeEnvValue(key: string, value: string): void {
  let text = "";
  if (existsSync(ENV_PATH)) text = readFileSync(ENV_PATH, "utf8");
  else if (existsSync(path.join(REPO_ROOT, ".env.example"))) text = readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_PATH, text, { mode: 0o600 });
  process.env[key] = value;
}
