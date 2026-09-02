/**
 * The 1-day rolling cache (CLAUDE.md rule 5). Each run owns <root>/<runId>/... holding its
 * downloads, rendered images, decode results, and generated outputs, encrypted at rest.
 * The NEXT run's final step purges the previous run's directory and logs the deletion.
 * A 48h sweep is the failsafe for crashed runs. Phase 0 = local disk; the interface is
 * S3-shaped so an object store can replace it without touching the pipeline.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sealer } from "@daymarkable/db";

export interface CacheStore {
  put(runId: string, relPath: string, bytes: Uint8Array): Promise<void>;
  get(runId: string, relPath: string): Promise<Uint8Array>;
  exists(runId: string, relPath: string): Promise<boolean>;
  /** Delete a run's whole cache; returns what was removed. */
  purge(runId: string): Promise<{ files: number; bytes: number }>;
  /** Failsafe: purge any run cache older than maxAgeHours. */
  sweep(maxAgeHours: number): Promise<Array<{ runId: string; files: number; bytes: number }>>;
  location(runId: string): string;
}

export class LocalCacheStore implements CacheStore {
  constructor(
    private readonly root: string,
    private readonly sealer: Sealer,
  ) {}

  location(runId: string): string {
    return path.join(this.root, runId);
  }

  private file(runId: string, relPath: string): string {
    const safe = relPath.replace(/\\/g, "/").split("/").filter((s) => s && s !== "..");
    return path.join(this.root, runId, ...safe) + ".sealed";
  }

  async put(runId: string, relPath: string, bytes: Uint8Array): Promise<void> {
    const f = this.file(runId, relPath);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, this.sealer.sealBytes(bytes), { mode: 0o600 });
  }

  async get(runId: string, relPath: string): Promise<Uint8Array> {
    return new Uint8Array(this.sealer.openBytes(await readFile(this.file(runId, relPath))));
  }

  async exists(runId: string, relPath: string): Promise<boolean> {
    try {
      await stat(this.file(runId, relPath));
      return true;
    } catch {
      return false;
    }
  }

  private async measure(dir: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    const walk = async (d: string) => {
      let entries;
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else {
          files++;
          bytes += (await stat(p)).size;
        }
      }
    };
    await walk(dir);
    return { files, bytes };
  }

  async purge(runId: string): Promise<{ files: number; bytes: number }> {
    const dir = this.location(runId);
    const m = await this.measure(dir);
    await rm(dir, { recursive: true, force: true });
    return m;
  }

  async sweep(maxAgeHours: number): Promise<Array<{ runId: string; files: number; bytes: number }>> {
    const out: Array<{ runId: string; files: number; bytes: number }> = [];
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return out;
    }
    const cutoff = Date.now() - maxAgeHours * 3600_000;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(this.root, e.name);
      const s = await stat(dir);
      if (s.mtimeMs < cutoff) {
        const m = await this.purge(e.name);
        out.push({ runId: e.name, ...m });
      }
    }
    return out;
  }
}
