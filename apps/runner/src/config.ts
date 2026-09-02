import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { STARTER_CONVENTIONS, validateConventions, type UserInkConventions } from "@daymarkable/decode";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const ENV_PATH = path.join(REPO_ROOT, ".env");
export const STATE_DIR = path.join(REPO_ROOT, ".daymarkable");

dotenv.config({ path: ENV_PATH });

export interface RunnerConfig {
  deviceToken: string | null;
  anthropicApiKey: string | null;
  decodeModel: string;
  escalationModel: string | null;
  confidenceThreshold: number;
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
    decodeModel: env.DECODE_MODEL || "claude-haiku-4-5",
    escalationModel: env.DECODE_ESCALATION_MODEL === "" ? null : (env.DECODE_ESCALATION_MODEL ?? "claude-sonnet-5"),
    confidenceThreshold: Number(env.DECODE_CONFIDENCE_THRESHOLD ?? "0.7"),
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
