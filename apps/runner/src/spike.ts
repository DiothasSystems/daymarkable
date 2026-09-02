/**
 * Milestone 1 pipeline spike.
 *
 *   pnpm spike pair <code>         pair with my.remarkable.com, save RMAPI_DEVICE_TOKEN to .env
 *   pnpm spike list                print the document tree
 *   pnpm spike download "<name>"   download one notebook's pages (.rm) to .daymarkable/spike/<slug>/
 *   pnpm spike render "<name>"     render pages to PNG via the render service (PDF fallback)
 *   pnpm spike extract "<name>"    decode PNGs with Claude using the starter ink conventions
 *   pnpm spike compose "<name>"    build the Daily Sheet PDF
 *   pnpm spike upload "<name>"     upload the Daily Sheet to /dayMarkable on the tablet
 *   pnpm spike all "<name>"        download -> render -> extract -> compose -> upload
 *
 * Working files live under .daymarkable/spike (gitignored). Logs print counts, never content.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DateTime } from "luxon";
import { assembleDailySheet, type DecodedPage } from "@daymarkable/core";
import { composeDailySheet } from "@daymarkable/compose";
import { AnthropicDecoder, totalUsage, type DecodePageInput, type DecodePageResult } from "@daymarkable/decode";
import {
  RemarkableCloudProvider,
  TabletProviderError,
  pairWithCode,
  type DownloadedDocument,
  type TabletDocument,
} from "@daymarkable/tablet";
import { STATE_DIR, loadConfig, writeEnvValue, renderHealthy, renderPdfPages, renderRmPages } from "@daymarkable/pipeline";

const SPIKE_DIR = path.join(STATE_DIR, "spike");

interface Manifest {
  document: TabletDocument;
  pages: Array<{ pageId: string; index: number; hash: string | null; file: string | null }>;
  basePdf: string | null;
  downloadedAt: string;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "notebook";
}

function log(msg: string): void {
  console.log(`[spike ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function provider(): Promise<RemarkableCloudProvider> {
  const cfg = loadConfig();
  if (!cfg.deviceToken) throw new Error("No RMAPI_DEVICE_TOKEN in .env — run: pnpm spike pair <code>");
  return RemarkableCloudProvider.fromDeviceToken(cfg.deviceToken);
}

async function cmdPair(code: string | undefined): Promise<void> {
  if (!code) throw new Error("usage: pnpm spike pair <8-character code from https://my.remarkable.com/device/browser/connect>");
  const token = await pairWithCode(code);
  writeEnvValue("RMAPI_DEVICE_TOKEN", token);
  log("paired; device token saved to .env (RMAPI_DEVICE_TOKEN)");
  const api = await RemarkableCloudProvider.fromDeviceToken(token);
  const tree = await api.listTree();
  log(`cloud session OK: ${tree.folders.length} folders, ${tree.documents.length} documents`);
}

async function cmdList(): Promise<void> {
  const api = await provider();
  const tree = await api.listTree();
  const rows = [
    ...tree.folders.map((f) => ({ path: f.path, kind: "folder", modified: "" })),
    ...tree.documents.map((d) => ({ path: d.path, kind: d.fileType, modified: d.lastModified?.toISOString().slice(0, 16) ?? "" })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  for (const r of rows) console.log(`${r.kind.padEnd(9)} ${r.modified.padEnd(17)} ${r.path}`);
  log(`${tree.folders.length} folders, ${tree.documents.length} documents`);
}

async function findDocument(api: RemarkableCloudProvider, name: string): Promise<TabletDocument> {
  const tree = await api.listTree();
  const exact = tree.documents.filter((d) => d.name === name || d.path === name);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new Error(`"${name}" is ambiguous; use the full path: ${exact.map((d) => d.path).join(" | ")}`);
  const loose = tree.documents.filter((d) => d.name.toLowerCase().includes(name.toLowerCase()));
  if (loose.length === 1) return loose[0]!;
  throw new Error(
    loose.length ? `"${name}" matches several: ${loose.map((d) => d.path).join(" | ")}` : `No document named "${name}" (try: pnpm spike list)`,
  );
}

async function cmdDownload(name: string): Promise<string> {
  const api = await provider();
  const doc = await findDocument(api, name);
  log(`downloading "${doc.name}" (${doc.fileType}, hash ${doc.hash.slice(0, 10)}…)`);
  const dl: DownloadedDocument = await api.downloadDocument(doc);
  const dir = path.join(SPIKE_DIR, slug(doc.name));
  await mkdir(path.join(dir, "pages"), { recursive: true });
  const manifest: Manifest = { document: dl.document, pages: [], basePdf: null, downloadedAt: new Date().toISOString() };
  for (const p of dl.pages) {
    let file: string | null = null;
    if (p.rm) {
      file = `pages/${String(p.index).padStart(3, "0")}-${p.pageId}.rm`;
      await writeFile(path.join(dir, file), p.rm);
    }
    manifest.pages.push({ pageId: p.pageId, index: p.index, hash: p.hash, file });
  }
  if (dl.basePdf) {
    manifest.basePdf = "base.pdf";
    await writeFile(path.join(dir, "base.pdf"), dl.basePdf);
  }
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const inked = dl.pages.filter((p) => p.rm).length;
  log(`saved ${dl.pages.length} pages (${inked} with ink) to ${path.relative(process.cwd(), dir)}`);
  return dir;
}

async function loadManifest(name: string): Promise<{ dir: string; manifest: Manifest }> {
  const dir = path.join(SPIKE_DIR, slug(name));
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    return { dir, manifest };
  } catch {
    throw new Error(`Nothing downloaded for "${name}" yet — run: pnpm spike download "${name}"`);
  }
}

async function cmdRender(name: string): Promise<void> {
  const cfg = loadConfig();
  const { dir, manifest } = await loadManifest(name);
  if (!(await renderHealthy(cfg.renderServiceUrl))) {
    throw new Error(`render service not reachable at ${cfg.renderServiceUrl} — start it: pnpm render:dev`);
  }
  await mkdir(path.join(dir, "png"), { recursive: true });
  const inked = manifest.pages.filter((p) => p.file);
  const inputs = await Promise.all(inked.map(async (p) => ({ pageId: p.pageId, rm: new Uint8Array(await readFile(path.join(dir, p.file!))) })));
  const { segments, errors } = await renderRmPages(cfg.renderServiceUrl, inputs);
  const byId = new Map(manifest.pages.map((p) => [p.pageId, p] as const));
  const pngName = (index: number, segment: number) => `${String(index).padStart(3, "0")}-s${segment}.png`;
  const rendered = new Set<number>();
  let files = 0;
  for (const s of segments) {
    const p = byId.get(s.pageId)!;
    await writeFile(path.join(dir, "png", pngName(p.index, s.segment)), s.png);
    rendered.add(p.index);
    files++;
  }
  if (errors.length) {
    log(`rmscene failed on ${errors.length} page(s): ${errors.map((e) => e.code).join(", ")}`);
    if (manifest.basePdf) {
      const indexes = errors.map((e) => byId.get(e.pageId)!.index);
      log(`falling back to PDF rasterization for pages ${indexes.map((i) => i + 1).join(", ")}`);
      const pdf = new Uint8Array(await readFile(path.join(dir, manifest.basePdf)));
      for (const s of await renderPdfPages(cfg.renderServiceUrl, pdf, indexes)) {
        await writeFile(path.join(dir, "png", pngName(Number(s.pageId), s.segment)), s.png);
        rendered.add(Number(s.pageId));
        files++;
      }
    } else {
      log("no PDF available for fallback; those pages are skipped this run");
    }
  }
  log(`rendered ${rendered.size}/${inked.length} inked pages as ${files} image(s) to ${path.relative(process.cwd(), path.join(dir, "png"))}`);
}

async function cmdExtract(name: string): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY missing in .env");
  const { dir, manifest } = await loadManifest(name);
  const files = (await readdir(path.join(dir, "png")).catch(() => [])).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) throw new Error(`No PNGs for "${name}" — run: pnpm spike render "${name}"`);
  const now = DateTime.now().setZone(cfg.timezone);
  const byIndex = new Map<number, string[]>();
  for (const f of files) {
    const index = Number(f.slice(0, 3));
    byIndex.set(index, [...(byIndex.get(index) ?? []), f]);
  }
  const inputs: DecodePageInput[] = await Promise.all(
    [...byIndex.entries()].map(async ([index, segs]) => {
      return {
        key: `${manifest.document.id}/${index}`,
        images: await Promise.all(segs.sort().map(async (f) => new Uint8Array(await readFile(path.join(dir, "png", f))))),
        context: {
          notebookName: manifest.document.name,
          notebookPath: manifest.document.path,
          pageIndex: index,
          pageCount: manifest.pages.length,
          todayIso: now.toISODate()!,
          timezone: cfg.timezone,
        },
      };
    }),
  );
  log(`decoding ${inputs.length} page(s) with ${cfg.decodeModel} (escalation: ${cfg.escalationModel ?? "off"}, threshold ${cfg.confidenceThreshold})`);
  const decoder = new AnthropicDecoder({
    model: cfg.decodeModel,
    escalationModel: cfg.escalationModel,
    confidenceThreshold: cfg.confidenceThreshold,
    conventions: cfg.conventions,
  });
  const started = Date.now();
  const results = await decoder.decodePages(inputs, "standard");
  const ok = results.filter((r) => r.extraction);
  await writeFile(path.join(dir, "extraction.json"), JSON.stringify(results, null, 2));
  const usage = [...totalUsage(results).values()];
  await writeFile(path.join(dir, "usage.json"), JSON.stringify(usage, null, 2));
  for (const u of usage) {
    log(`  ${u.model} [${u.mode}] in=${u.input_tokens} cache_read=${u.cache_read_input_tokens} cache_write=${u.cache_creation_input_tokens} out=${u.output_tokens} cost=$${u.cost_usd.toFixed(4)}`);
  }
  const counts = ok.reduce(
    (acc, r) => {
      acc.tasks += r.extraction!.tasks.length;
      acc.events += r.extraction!.events.length;
      acc.meetings += r.extraction!.meeting_requests.length;
      acc.notes += r.extraction!.notes.length;
      acc.checkboxes += r.extraction!.checkbox_updates.length;
      return acc;
    },
    { tasks: 0, events: 0, meetings: 0, notes: 0, checkboxes: 0 },
  );
  log(`decoded ${ok.length}/${results.length} pages in ${((Date.now() - started) / 1000).toFixed(1)}s: ${counts.tasks} tasks, ${counts.events} events, ${counts.meetings} meeting requests, ${counts.notes} notes, ${counts.checkboxes} checkbox updates; escalated ${results.filter((r) => r.escalated).length}`);
  for (const r of results.filter((r) => r.error)) log(`  page ${r.key.split("/")[1]}: ${r.error}`);
}

async function cmdCompose(name: string): Promise<string> {
  const cfg = loadConfig();
  const { dir, manifest } = await loadManifest(name);
  let results: DecodePageResult[];
  try {
    results = JSON.parse(await readFile(path.join(dir, "extraction.json"), "utf8")) as DecodePageResult[];
  } catch {
    throw new Error(`No extraction for "${name}" — run: pnpm spike extract "${name}"`);
  }
  const pages: DecodedPage[] = results
    .filter((r) => r.extraction)
    .map((r) => ({ notebook: manifest.document.name, pageIndex: Number(r.key.split("/")[1]), extraction: r.extraction! }));
  const now = DateTime.now().setZone(cfg.timezone);
  const model = assembleDailySheet(pages, {
    date: now.toISODate()!,
    timezone: cfg.timezone,
    generatedAt: now.toISO()!,
    runLabel: "spike",
    confidenceThreshold: cfg.confidenceThreshold,
  });
  const pdf = await composeDailySheet(model);
  const out = path.join(dir, "Daily Sheet.pdf");
  await writeFile(out, pdf);
  await writeFile(path.join(dir, "daily-model.json"), JSON.stringify(model, null, 2));
  log(`composed Daily Sheet: ${model.actions.length} actions, ${model.events.length} today, ${model.upcoming.length} upcoming, ${model.inbox.length} inbox -> ${path.relative(process.cwd(), out)} (${(pdf.length / 1024).toFixed(0)} KB)`);
  return out;
}

async function cmdUpload(name: string): Promise<void> {
  const { dir } = await loadManifest(name);
  const pdf = new Uint8Array(await readFile(path.join(dir, "Daily Sheet.pdf")).catch(() => {
    throw new Error(`No Daily Sheet for "${name}" — run: pnpm spike compose "${name}"`);
  }));
  const api = await provider();
  const folder = await api.ensureFolder("/dayMarkable");
  const res = await api.uploadPdf("Daily Sheet", pdf, folder, { replace: true });
  log(`uploaded "Daily Sheet" to /dayMarkable (id ${res.id.slice(0, 8)}…). Sync the tablet to see it.`);
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "pair":
      return cmdPair(arg);
    case "list":
      return cmdList();
    case "download":
      await cmdDownload(need(arg));
      return;
    case "render":
      return cmdRender(need(arg));
    case "extract":
      return cmdExtract(need(arg));
    case "compose":
      await cmdCompose(need(arg));
      return;
    case "upload":
      return cmdUpload(need(arg));
    case "all": {
      const n = need(arg);
      await cmdDownload(n);
      await cmdRender(n);
      await cmdExtract(n);
      await cmdCompose(n);
      await cmdUpload(n);
      return;
    }
    default:
      console.log("usage: pnpm spike <pair <code> | list | download <name> | render <name> | extract <name> | compose <name> | upload <name> | all <name>>");
      process.exitCode = 1;
  }
}

function need(arg: string | undefined): string {
  if (!arg) throw new Error("notebook name required");
  return arg;
}

main().catch((err) => {
  if (err instanceof TabletProviderError) console.error(`tablet error [${err.code}]: ${err.message}`);
  else console.error(`error: ${(err as Error).message}`);
  process.exitCode = 1;
});
