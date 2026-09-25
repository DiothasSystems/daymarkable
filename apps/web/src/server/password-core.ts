/**
 * Sign-in passwords, with no I/O in them: hashing, checking, what counts as an acceptable
 * password, and when to stop listening. The flows that use these live in sign-in.ts; this file only
 * decides, so all of it can be tested without a database or a request.
 *
 * WHY SCRYPT, when the admin portal uses bcrypt. The admin hash is made once, offline, by a script,
 * and pasted into the environment. A customer's password comes through a form, and people who take
 * security seriously type long passphrases — and bcrypt silently ignores everything after the 72nd
 * byte, so "correct horse battery staple ..." would match on its first 72 bytes alone. scrypt has
 * no such limit, is memory-hard, and ships with Node, so there is no new dependency to vet.
 *
 * Parameters are OWASP's equivalent-strength set N=2^15, r=8, p=3: 32 MB and a few hundred
 * milliseconds per check, run on libuv's thread pool rather than the event loop. They are written
 * into every stored hash, so they can be raised later without invalidating a single password.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Long enough to resist guessing at the lockout's pace; no rules about symbols (NIST 800-63B). */
export const PASSWORD_MIN = 10;
/** Room for any passphrase, short of what would make hashing a denial of service. */
export const PASSWORD_MAX = 200;

const LOG_N = 15;
const R = 8;
const P = 3;
const KEY_LEN = 64;
const SALT_LEN = 16;
/** Comfortably above 128 * N * r = 32 MB, which Node refuses at its 32 MB default. */
const MAXMEM = 64 * 1024 * 1024;

export type PasswordCheck = { ok: true } | { ok: false; message: string };

/**
 * Is this acceptable as a NEW password? Only ever asked when one is being set — a sign-in checks
 * against what is stored, so a password set under older rules keeps working.
 */
export function validateNewPassword(password: string, email: string): PasswordCheck {
  if (password.length < PASSWORD_MIN) return { ok: false, message: `Use at least ${PASSWORD_MIN} characters.` };
  if (password.length > PASSWORD_MAX) return { ok: false, message: `Use at most ${PASSWORD_MAX} characters.` };
  if (!password.trim()) return { ok: false, message: "A password cannot be only spaces." };
  // The one guess everybody tries first.
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return { ok: false, message: "Do not use your email address as your password." };
  return { ok: true };
}

function derive(password: string, salt: Buffer, logN: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLen, { N: 2 ** logN, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$<logN>$<r>$<p>$<salt b64>$<key b64>` — the parameters travel with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, LOG_N, R, P, KEY_LEN);
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Does this password match the stored hash? False — never a throw — for anything malformed, so a
 * corrupted row reads as a wrong password rather than a server error that says the account exists.
 *
 * NFKC before hashing, both ways, so the same password typed on a phone and a laptop — which can
 * encode an accented letter differently — is the same password.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, logN, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const n = Number(logN), rr = Number(r), pp = Number(p);
  // Bounds on what a stored row may ask for, so a tampered hash cannot make one check take minutes.
  if (![n, rr, pp].every(Number.isInteger) || n < 10 || n > 20 || rr < 1 || rr > 16 || pp < 1 || pp > 16) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  if (salt.length < 8 || expected.length < 32) return false;
  try {
    const key = await derive(password, salt, n, rr, pp, expected.length);
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/**
 * A hash nobody's password matches, to check against when there is no real one — an unknown
 * address, or an account with no password yet — so those answers take as long as a wrong password
 * does. Without it, a fast "no" would say which addresses have accounts.
 */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString("base64"));
  return dummy;
}

// ---------------------------------------------------------------- when to stop listening

export const SIGN_IN_WINDOW_MS = 15 * 60_000;
/** Wrong passwords for one address before that address is locked for the rest of the window. */
export const MAX_FAILURES_PER_EMAIL = 5;
/** Wrong passwords from one IP, across any addresses — the shape of credential stuffing. */
export const MAX_FAILURES_PER_IP = 20;

export interface SignInAttemptRow {
  email: string;
  ip: string;
  success: boolean;
  createdAt: Date;
}

/**
 * Should this attempt be refused before the password is even checked?
 *
 * Counted per address, so guessing one account is slow whatever the attacker's IP; and per IP, so
 * trying many accounts from one place is slow too. The per-address lock can be triggered by someone
 * who does not know the password, which locks the owner out for a while — accepted, as it is almost
 * everywhere: fifteen minutes is an inconvenience, and an unlimited guess rate is not an option.
 */
export function signInLocked(
  attempts: readonly SignInAttemptRow[],
  email: string,
  ip: string,
  now = Date.now(),
): { locked: boolean; retryAfterMs: number } {
  const failures = attempts.filter((a) => !a.success && now - a.createdAt.getTime() < SIGN_IN_WINDOW_MS);
  const oldest = (rows: readonly SignInAttemptRow[]) => Math.min(...rows.map((a) => a.createdAt.getTime()));
  const forEmail = failures.filter((a) => a.email === email);
  if (forEmail.length >= MAX_FAILURES_PER_EMAIL) return { locked: true, retryAfterMs: SIGN_IN_WINDOW_MS - (now - oldest(forEmail)) };
  const fromIp = failures.filter((a) => a.ip === ip);
  if (fromIp.length >= MAX_FAILURES_PER_IP) return { locked: true, retryAfterMs: SIGN_IN_WINDOW_MS - (now - oldest(fromIp)) };
  return { locked: false, retryAfterMs: 0 };
}

/** Set-password links an address may be sent per hour — enough for a typo'd first try, not a flood. */
export const MAX_PASSWORD_LINKS_PER_HOUR = 3;
