/**
 * Model comparison for the dogfood phase (BUILD_PLAN Phase 0 item 7).
 *
 *   pnpm compare --days 7 --models claude-sonnet-5,claude-opus-5
 *
 * Reads the pages you wrote in the last N days, transcribes each one with every model, and
 * writes a side-by-side HTML report: the page image on the left, one transcription column per
 * model, with tokens, cost and latency per model at the top.
 *
 * Read-only by design: it never writes snapshots, never composes or uploads, and never touches
 * run history, so running it cannot disturb a nightly run. Reports land in the state directory
 * and are served, behind login, at /api/compare.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { anthropicClient, transcribePage, type TranscriptionResult } from "@daymarkable/decode";
import { HttpRenderer, STATE_DIR, ensureDefaultUser, openRuntime, selectDocuments, tabletFor } from "@daymarkable/pipeline";
import type { TabletDocument } from "@daymarkable/tablet";
import { DateTime } from "luxon";

const DEFAULT_MODELS = ["claude-sonnet-5", "claude-opus-5"];

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function log(msg: string): void {
  console.log(`[compare ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usd = (n: number): string => `$${n.toFixed(n < 0.1 ? 4 : 3)}`;

interface PageResult {
  notebook: string;
  pageIndex: number;
  pageCount: number;
  images: Uint8Array[];
  transcriptions: TranscriptionResult[];
}

async function main(): Promise<void> {
  const days = Number(opt("days") ?? 7);
  const models = (opt("models") ?? DEFAULT_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
  const maxPages = Number(opt("max-pages") ?? 15);
  const only = opt("notebook");

  const rt = await openRuntime("live", { log });
  try {
    const user = await ensureDefaultUser(rt);
    if (!rt.config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY missing");
    const tablet = await tabletFor(rt, user.id);
    const renderer = new HttpRenderer(rt.config.renderServiceUrl);
    await renderer.check();

    // ---- pick the pages: recently modified notebooks in the watch folders, ours excluded
    const tree = await tablet.listTree();
    const since = DateTime.utc().minus({ days });
    const candidates = selectDocuments(tree.documents, user.settings)
      .filter((d) => !d.path.startsWith("/dayMarkable"))
      .filter((d) => (only ? d.name.toLowerCase().includes(only.toLowerCase()) : true))
      .filter((d) => d.lastModified && DateTime.fromJSDate(d.lastModified) >= since)
      .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
    log(`${candidates.length} notebook(s) modified in the last ${days} day(s)`);
    if (candidates.length === 0) throw new Error("nothing to compare; widen --days or check your watch folders");

    const client = anthropicClient(rt.config.anthropicApiKey);
    const results: PageResult[] = [];
    let budget = maxPages;

    for (const doc of candidates as TabletDocument[]) {
      if (budget <= 0) break;
      const refs = await tablet.listPages(doc);
      const inked = refs.filter((p) => p.hash).map((p) => p.pageId);
      if (inked.length === 0) continue;
      const take = inked.slice(0, budget);
      const dl = await tablet.downloadDocument(doc, { onlyPageIds: take });
      const { pages, failed } = await renderer.renderDocument(dl, take);
      for (const f of failed) log(`render failed on "${doc.name}" page ${f.pageId.slice(0, 8)}: ${f.reason}`);
      for (const p of pages) {
        if (budget <= 0) break;
        budget--;
        log(`transcribing "${doc.name}" page ${p.pageIndex + 1} with ${models.length} model(s)…`);
        const transcriptions = await Promise.all(
          models.map((m) =>
            transcribePage(p.segments, m, client, {
              context: `Notebook "${doc.name}", page ${p.pageIndex + 1} of ${dl.document.pageCount}.`,
            }),
          ),
        );
        for (const t of transcriptions) log(`  ${t.model}: ${t.error ? `ERROR ${t.error}` : `${t.text.length} chars, ${usd(t.costUsd)}, ${(t.ms / 1000).toFixed(1)}s`}`);
        results.push({ notebook: doc.name, pageIndex: p.pageIndex, pageCount: dl.document.pageCount, images: p.segments, transcriptions });
      }
    }

    if (results.length === 0) throw new Error("no inked pages rendered; nothing to compare");

    // ---- totals per model
    const totals = models.map((m) => {
      const rows = results.flatMap((r) => r.transcriptions.filter((t) => t.model === m));
      return {
        model: m,
        cost: rows.reduce((n, t) => n + t.costUsd, 0),
        inTok: rows.reduce((n, t) => n + t.usage.input_tokens + t.usage.cache_read_input_tokens, 0),
        outTok: rows.reduce((n, t) => n + t.usage.output_tokens, 0),
        ms: rows.reduce((n, t) => n + t.ms, 0),
        errors: rows.filter((t) => t.error).length,
      };
    });

    const dir = path.join(STATE_DIR, "compare");
    await mkdir(dir, { recursive: true });
    const stamp = DateTime.now().setZone(user.timezone).toFormat("yyyy-LL-dd-HHmm");
    const file = path.join(dir, `compare-${stamp}.html`);
    await writeFile(file, renderReport(results, totals, { days, generatedAt: DateTime.now().setZone(user.timezone).toFormat("cccc d LLLL yyyy, HH:mm") }));

    // Keep only the five most recent reports: they contain note text (CLAUDE.md rule 5).
    const olds = (await readdir(dir)).filter((f) => f.endsWith(".html")).sort().reverse().slice(5);
    for (const f of olds) await rm(path.join(dir, f), { force: true });

    log(`report written: ${file}`);
    log(`open it at ${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/compare (sign-in required)`);
    for (const t of totals) log(`  ${t.model}: ${usd(t.cost)} total, ${t.inTok} in / ${t.outTok} out, ${(t.ms / 1000 / results.length).toFixed(1)}s per page${t.errors ? `, ${t.errors} errors` : ""}`);
    log(`grand total ${usd(totals.reduce((n, t) => n + t.cost, 0))} for ${results.length} page(s) × ${models.length} model(s)`);
  } finally {
    await rt.close();
  }
}

interface Totals {
  model: string;
  cost: number;
  inTok: number;
  outTok: number;
  ms: number;
  errors: number;
}

function renderReport(results: PageResult[], totals: Totals[], meta: { days: number; generatedAt: string }): string {
  const cols = totals.length;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dayMarkable model comparison</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--midnight:#1e2a44;--gold:#c9973f;--goldt:#b8862f;--parchment:#f7f0e3;--notepaper:#fdfaf3;--border:#e3d9c2;--muted:#4a5266;--meta:#8a7d5f}
*{box-sizing:border-box}
body{margin:0;background:var(--parchment);color:var(--midnight);font:15px/1.6 'Public Sans',system-ui,sans-serif}
header{background:var(--midnight);color:var(--parchment);padding:20px 32px}
header h1{font:700 26px/1.2 'Source Serif 4',Georgia,serif;margin:0 0 4px}
header .sub{font:11px/1.6 'IBM Plex Mono',monospace;letter-spacing:.12em;color:#a09372;text-transform:uppercase}
main{max-width:1600px;margin:0 auto;padding:24px 32px 64px}
.totals{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:28px}
.card{background:var(--notepaper);border:1px solid var(--border);border-radius:6px;padding:18px 20px;box-shadow:0 2px 8px rgba(30,42,68,.08)}
.card h2{font:600 17px/1.2 'Source Serif 4',Georgia,serif;margin:0 0 8px}
.k{font:11px/1.8 'IBM Plex Mono',monospace;letter-spacing:.08em;color:var(--meta);text-transform:uppercase}
.page{background:var(--notepaper);border:1px solid var(--border);border-radius:6px;margin-bottom:28px;overflow:hidden;box-shadow:0 2px 8px rgba(30,42,68,.08)}
.page > .title{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.page > .title strong{font:600 19px/1.2 'Source Serif 4',Georgia,serif}
.grid{display:grid;grid-template-columns:minmax(220px,1fr) repeat(${cols},minmax(260px,1.3fr));gap:0}
.grid > div{padding:16px 18px;border-right:1px solid var(--border)}
.grid > div:last-child{border-right:0}
.grid img{width:100%;display:block;border:1px solid var(--border);border-radius:4px;margin-bottom:8px;background:#fff}
pre{white-space:pre-wrap;word-wrap:break-word;font:13px/1.65 'IBM Plex Mono',monospace;margin:8px 0 0;color:var(--midnight)}
.err{color:#a8321f;font-weight:600}
.colhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;border-bottom:2px solid var(--gold);padding-bottom:6px}
.colhead b{font:600 15px/1.2 'Public Sans',sans-serif}
.note{color:var(--muted);font-size:14px;margin:0 0 24px;max-width:70ch}
@media(max-width:1100px){.grid{grid-template-columns:1fr}.grid>div{border-right:0;border-bottom:1px solid var(--border)}}
</style></head><body>
<header><h1>Model comparison — transcription accuracy</h1>
<div class="sub">${esc(meta.generatedAt)} · last ${meta.days} days · ${results.length} pages · ${cols} models</div></header><main>
<p class="note">Each row is one page: your handwriting on the left, then what each model read. Compare against the image, not against each other. Proper nouns are where models differ most; anything they all get wrong is a candidate for your personal lexicon.</p>
<div class="totals">${totals
    .map(
      (t) => `<div class="card"><h2>${esc(t.model)}</h2>
<div class="k">Cost ${usd(t.cost)} · ${(t.cost / Math.max(1, results.length)).toFixed(4)} per page</div>
<div class="k">${t.inTok.toLocaleString()} in · ${t.outTok.toLocaleString()} out</div>
<div class="k">${(t.ms / 1000 / Math.max(1, results.length)).toFixed(1)}s per page${t.errors ? ` · ${t.errors} errors` : ""}</div></div>`,
    )
    .join("")}</div>`;

  const body = results
    .map((r) => {
      const imgs = r.images.map((b) => `<img src="data:image/png;base64,${Buffer.from(b).toString("base64")}" alt="page image">`).join("");
      const cells = r.transcriptions
        .map(
          (t) => `<div><div class="colhead"><b>${esc(t.model)}</b><span class="k">${usd(t.costUsd)} · ${(t.ms / 1000).toFixed(1)}s</span></div>
${t.error ? `<pre class="err">${esc(t.error)}</pre>` : `<pre>${esc(t.text || "(empty)")}</pre>`}</div>`,
        )
        .join("");
      return `<section class="page"><div class="title"><strong>${esc(r.notebook)}</strong><span class="k">page ${r.pageIndex + 1} of ${r.pageCount}</span></div>
<div class="grid"><div>${imgs}</div>${cells}</div></section>`;
    })
    .join("");

  return `${head}${body}</main></body></html>`;
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exitCode = 1;
});
