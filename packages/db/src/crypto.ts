/**
 * Encryption at rest for device tokens, meeting-note bodies, and cache files.
 * AES-256-GCM with a random 12-byte nonce; output is base64("v1" || nonce || tag || ciphertext).
 * The key comes from DATA_ENCRYPTION_KEY (base64 or hex, 32 bytes). Phase 2 swaps this for
 * per-user data keys without changing callers.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = Buffer.from("v1");

export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not set (32 bytes, base64 or hex)");
  const trimmed = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return buf;
}

export function generateKey(): string {
  return randomBytes(32).toString("base64");
}

export class Sealer {
  constructor(private readonly key: Buffer) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Sealer {
    return new Sealer(parseKey(env.DATA_ENCRYPTION_KEY));
  }

  sealBytes(plain: Uint8Array): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([VERSION, nonce, cipher.getAuthTag(), ct]);
  }

  openBytes(sealed: Uint8Array): Buffer {
    const buf = Buffer.from(sealed);
    if (buf.subarray(0, 2).toString() !== "v1") throw new Error("unknown sealed format");
    const nonce = buf.subarray(2, 14);
    const tag = buf.subarray(14, 30);
    const ct = buf.subarray(30);
    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  seal(text: string): string {
    return this.sealBytes(Buffer.from(text, "utf8")).toString("base64");
  }

  open(sealed: string): string {
    return this.openBytes(Buffer.from(sealed, "base64")).toString("utf8");
  }

  sealJson(value: unknown): string {
    return this.seal(JSON.stringify(value));
  }

  openJson<T>(sealed: string): T {
    return JSON.parse(this.open(sealed)) as T;
  }
}
