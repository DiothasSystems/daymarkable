/**
 * The run pipeline (nightly AND on-demand — same job):
 *   sync → render → decode → merge → compose → upload → email → draft invites → rotate cache
 *
 * Idempotent per (user, local-date[, seq]) (rule 4/11). Only changed pages are processed
 * (rule 2). Nothing here logs note content — counts, hashes, ids only (rule 5).
 */
import { appendLines, buildDailyNotes, buildOutputSet, dailyNotesDate, dailyNotesName, lineTokens, mergeRun, newLines, pageLines, type DailyNoteEntry, type MergePage, type PrintedItem } from "@daymarkable/core";
import { composeActionList, composeDailyNotes, composeDailyPuzzle, composeDailyUpdate, composePlanner, inkCoverage, parseInkSvg, type PuzzleInput } from "@daymarkable/compose";
import { crosswordWords, gatherDailyUpdate } from "@daymarkable/news";
import {
  GENERAL_KNOWLEDGE,
  GENERAL_WORDS,
  buildCrossword,
  cluesByDirection,
  generateSudoku,
  generateWordSearch,
  isoWeekday,
  minPlaced,
  puzzleFor,
  seedFor,
  seededCrossword,
  specFor,
  validateCrossword,
  type CrosswordSpec,
} from "@daymarkable/puzzles";
import type { Db, RunStats, Sealer } from "@daymarkable/db";
import { totalUsage, type DecodePageInput, type Decoder } from "@daymarkable/decode";
import { buildDeliveryMail, buildMeetingMail, type MailProvider } from "@daymarkable/mail";
import { TabletProviderError, parseCloudDate, type DownloadedDocument, type TabletDocument, type TabletFolder, type TabletProvider, type TabletTree } from "@daymarkable/tablet";
import { DateTime } from "luxon";
import type { CacheStore } from "./cache.js";
import type { Renderer } from "./renderer.js";
import * as repo from "./repo.js";
import { sourceGoneVerdicts } from "./sourceGone.js";

export interface PipelineDeps {
  db: Db;
  sealer: Sealer;
  cache: CacheStore;
  tablet: TabletProvider;
  renderer: Renderer;
  decoder: Decoder;
  /** Anthropic client for the news brief. Absent in fixture runs, which skip the brief. */
  newsClient?: import("@anthropic-ai/sdk").default;
  mail: MailProvider;
  decodeModel: string;
  /** The model for the news brief and the crossword's words — see RunnerConfig.newsModel. */
  newsModel: string;
  log: (msg: string) => void;
  now?: () => DateTime;
}

export interface PipelineParams {
  userId: string;
  kind: "nightly" | "on_demand";
  requestedVia: string;
  /** Override the local date (tests / backfill). */
  localDate?: string;
  /** Re-run even when this local date is already satisfied. */
  force?: boolean;
  /** Skip the tablet upload (dry run). */
  upload?: boolean;
  /** Process pages regardless of the previous-day window (first-run bootstrap of one notebook). */
  windowHours?: number;
  /** Called as soon as the run row exists (web "Sync now" returns the id and polls). */
  onStarted?: (runId: string) => void;
}

export interface RunOutcome {
  runId: string | null;
  status: "succeeded" | "failed" | "skipped";
  localDate: string;
  stats: RunStats | null;
  error: string | null;
}

/** Where everything is published unless the customer asked for the tablet root. */
const OUTPUT_FOLDER = "/ScriptumIQ";
export const ROOT_OUTPUT_FOLDER = "/";
/** The notebook the calibration sheet is uploaded as; its written page trains the decoder. */
export const CALIBRATION_NOTEBOOK = "Handwriting Sample";
/** Below this share of the passage read back, the sheet is assumed not written yet. */
export const CALIBRATION_MIN_ACCURACY = 0.25;
const ARCHIVE_FOLDER = `${OUTPUT_FOLDER}/Archive`;
/** Yesterday's puzzles, kept so an unfinished one can be gone back to. */
export const PUZZLE_FOLDER = `${OUTPUT_FOLDER}/Puzzles`;
/** Yesterday's briefs, kept so a headline can be looked up again. */
export const HEADLINES_FOLDER = `${OUTPUT_FOLDER}/Daily Headlines`;
/** Earlier days' "Notes - <date>", filed when a newer day's is published. */
export const NOTES_FOLDER = `${OUTPUT_FOLDER}/Notes`;

/**
 * Folders we used to publish into, under the name the product had then.
 *
 * A tablet that has been running since before the rename keeps everything under /dayMarkable —
 * tonight's Planner with today's ticks on it, a week of archived planners, every filed puzzle.
 * `migrateBrandFolders` renames that folder in place on the first run afterwards and everything inside
 * moves with it. This list is the fail-safe for when that cannot happen (the new folder already
 * exists, or the rename call failed): anything under a legacy folder is FINISHED — never decoded,
 * never cleaned up. The failure it prevents is the one that matters. If the old folder simply stopped
 * being ours, `selectDocuments` would hand a week of our own printed planners to the decoder as though
 * they were the customer's handwriting, and every printed task would come back as a new one on a list
 * that is append-only (rule 8).
 */
export const LEGACY_OUTPUT_FOLDERS = ["/dayMarkable"] as const;

/**
 * Subfolders renamed in the same change, as [old, new] inside the output folder. Their old paths are
 * kept too: if the rename fails, an archived brief under the old name is still somewhere the cleaner
 * must not reach — it deletes anything of ours sitting outside the output folder.
 */
export const LEGACY_SUBFOLDERS: ReadonlyArray<readonly [string, string]> = [["dayLy Headlines", "Daily Headlines"]];

/**
 * Folders that hold what we have already published. Everything in them is ours, but it is FINISHED:
 * never decoded, never tidied away by `cleanStaleOutputs`, never counted as a stray copy. Both of
 * those functions would otherwise do real damage here — the cleaner deletes anything of ours sitting
 * outside the output folder, which is every archived puzzle.
 */
const KEEP_FOLDERS = [
  ARCHIVE_FOLDER,
  PUZZLE_FOLDER,
  HEADLINES_FOLDER,
  NOTES_FOLDER,
  ...LEGACY_OUTPUT_FOLDERS,
  ...LEGACY_SUBFOLDERS.map(([old]) => `${OUTPUT_FOLDER}/${old}`),
] as const;

export function inKeepFolder(path: string): boolean {
  return KEEP_FOLDERS.some((f) => path.startsWith(`${f}/`));
}

/** The brief's notebook. Its archive folder takes the same word: "Daily Headlines". */
export const DAILY_UPDATE_NAME = "Daily Update";
/** The puzzle's notebook. */
export const DAILY_PUZZLE_NAME = "Daily Puzzle";

/** Everything ScriptumIQ writes to the tablet, by name. */
/**
 * Everything ScriptumIQ writes to the tablet under a fixed name. The daily Notes are named by their
 * date ("Notes - 10-01-2026") and recognised by `dailyNotesDate` instead.
 */
export const OUTPUT_NAMES = ["Planner", "Action List", DAILY_UPDATE_NAME, DAILY_PUZZLE_NAME] as const;

/**
 * The two notebooks that are output and nothing else.
 *
 * The planner, action list and notes are input forms as well — ticks and margin notes are read back
 * the next night, which is the closed loop. A crossword is not: letters written into its grid are an
 * answer to a puzzle, not a task, and decoding them costs money to produce nonsense. Same for the
 * brief, which is there to be read.
 *
 * The old names are listed too. A copy left on the tablet from before the rename must not become a
 * user notebook the moment it stops matching — it would be decoded straight back into itself, which
 * is the trap `LEGACY_OUTPUT_NAMES` exists for.
 */
export const NEVER_READ_BACK = [DAILY_PUZZLE_NAME, DAILY_UPDATE_NAME, "dayLy Puzzle", "dayLy Update"] as const;

/**
 * Names we used to write, and what each one became. Still recognised as ours — otherwise a renamed
 * notebook left on the tablet would be treated as the user's own and decoded back into itself — and
 * deleted on the next run wherever it is found.
 *
 * The daily notebooks have been called three things: "Daily Update", then "dayLy Update" to rhyme with
 * dayMarkable, then "Daily Update" again when the product became ScriptumIQ. So the name that is
 * current must NEVER be on this list, and a test holds it to that — `cleanStaleOutputs` deletes a
 * legacy name wherever it finds one, which would put tonight's brief in the bin the moment it landed.
 */
/** "Notes" is the meetings-only notebook the daily Notes replaced in October 2026. */
export const LEGACY_OUTPUT_NAMES = ["Meeting Notes", "Notes", "dayLy Update", "dayLy Puzzle"] as const;

/** For the filing step: a daily notebook left under a name we used to write, found and filed anyway. */
const LEGACY_NAMES_OF: Readonly<Record<string, readonly string[]>> = {
  [DAILY_UPDATE_NAME]: ["dayLy Update"],
  [DAILY_PUZZLE_NAME]: ["dayLy Puzzle"],
};

/**
 * Carry a tablet across the rename from dayMarkable to ScriptumIQ, once.
 *
 * Renames /dayMarkable to /ScriptumIQ, then "dayLy Headlines" to "Daily Headlines" inside it. A rename
 * rather than a copy because a child names its parent by id: one metadata write moves tonight's Planner
 * — with today's ticks on it, which this run is about to read — and every archive with it, and change
 * detection is untouched because no document's own hash moves.
 *
 * Idempotent by construction (rule 4): once renamed, the old name is not found and nothing runs. When
 * both names exist — someone made the new folder by hand, or an earlier attempt half-landed — nothing
 * is merged: the old folder is left where it is and `LEGACY_OUTPUT_FOLDERS` keeps it inert. Deciding
 * which of two Planners is the live one is not a decision to take unattended at midnight.
 *
 * Returns true when anything was renamed, so the caller lists the tree again. Every path below a
 * renamed folder has changed, and choosing what to read from stale paths is the exact failure this
 * exists to prevent.
 */
export async function migrateBrandFolders(tablet: TabletProvider, tree: TabletTree, log: (m: string) => void): Promise<boolean> {
  let changed = false;
  let output = tree.folders.find((f) => f.path === OUTPUT_FOLDER) ?? null;
  const outputName = OUTPUT_FOLDER.slice(1);

  for (const legacyPath of LEGACY_OUTPUT_FOLDERS) {
    const legacy = tree.folders.find((f) => f.path === legacyPath);
    if (!legacy) continue;
    if (output) {
      log(`brand: ${legacyPath} and ${OUTPUT_FOLDER} both exist; leaving ${legacyPath} as it is, and unread`);
      continue;
    }
    try {
      await tablet.renameFolder(legacy, outputName);
      // Same id, so the subfolders below still find it as their parent.
      output = { ...legacy, name: outputName, path: OUTPUT_FOLDER };
      changed = true;
      log(`brand: renamed ${legacyPath} to ${OUTPUT_FOLDER}`);
    } catch (err) {
      log(`brand: could not rename ${legacyPath} (${(err as Error).message}); it stays unread until the next run tries again`);
    }
  }

  if (output) {
    const parentId = output.id;
    for (const [from, to] of LEGACY_SUBFOLDERS) {
      // By parent id, not by path: if the folder above was renamed a moment ago, every path in this
      // tree is still the old one.
      const sub = tree.folders.find((f) => f.parentId === parentId && f.name === from);
      if (!sub) continue;
      if (tree.folders.some((f) => f.parentId === parentId && f.name === to)) {
        log(`brand: "${from}" and "${to}" both exist; leaving "${from}" as it is`);
        continue;
      }
      try {
        await tablet.renameFolder(sub, to);
        changed = true;
        log(`brand: renamed "${from}" to "${to}"`);
      } catch (err) {
        log(`brand: could not rename "${from}" (${(err as Error).message})`);
      }
    }
  }
  return changed;
}

/** Where this user's notebooks are published: a folder, or the tablet root. */
export function outputFolderFor(settings: { outputToRoot?: boolean }): string {
  return settings.outputToRoot ? ROOT_OUTPUT_FOLDER : OUTPUT_FOLDER;
}

/** Is this document one of ours, wherever the user has chosen to keep them? */
export function isOurDocument(doc: TabletDocument): boolean {
  if (inKeepFolder(doc.path)) return false;
  const inRoot = doc.path.lastIndexOf("/") === 0;
  const named =
    (OUTPUT_NAMES as readonly string[]).includes(doc.name) ||
    (LEGACY_OUTPUT_NAMES as readonly string[]).includes(doc.name) ||
    dailyNotesDate(doc.name) !== null ||
    doc.name === CALIBRATION_NOTEBOOK;
  return (inRoot && named) || (doc.path.startsWith(`${OUTPUT_FOLDER}/`) && !inKeepFolder(doc.path));
}

/**
 * Remove our notebooks left behind in the other location after the setting changed, so the
 * tablet never shows two Planners. Only ever touches documents we wrote, by name.
 */
export async function cleanStaleOutputs(tablet: TabletProvider, docs: readonly TabletDocument[], targetFolderId: string, log: (m: string) => void): Promise<number> {
  const stale = docs.filter(
    (d) =>
      isOurDocument(d) &&
      // Wrong place, or the right place under a name we no longer write.
      (d.parentId !== targetFolderId || (LEGACY_OUTPUT_NAMES as readonly string[]).includes(d.name)),
  );
  for (const d of stale) {
    try {
      await tablet.deleteDocument(d);
    } catch (err) {
      log(`could not remove the old copy of "${d.name}": ${(err as Error).message}`);
    }
  }
  if (stale.length) log(`removed ${stale.length} notebook(s) left in the previous location`);
  return stale.length;
}
const ARCHIVE_DAYS = 7;
/**
 * Most meeting-note emails one run may send. A normal night produces a handful; a run that read
 * more than this is re-reading history rather than reporting a day, and the customer should not
 * find nineteen emails about meetings from months ago in their inbox. The notes are on the tablet
 * and in the app either way, so suppressing the mail loses nothing but the noise.
 */
export const MAX_MEETING_EMAILS_PER_RUN = 6;
/** How far the very first run for an account looks back (see changeWindowStart). */
export const FIRST_RUN_LOOKBACK_DAYS = 7;

/**
 * The overnight brief. Never throws: a night without news is a night without news, and failing the
 * run over it would cost the customer their planner as well.
 */
async function buildDailyUpdate(
  deps: PipelineDeps,
  user: repo.UserRow,
  localDate: string,
  generatedAt: string,
  runLabel: string,
  runId: string,
  stats: RunStats,
  log: (m: string) => void,
): Promise<Awaited<ReturnType<typeof composeDailyUpdate>> | null> {
  const topics = user.settings.dailyUpdate.topics;
  if (topics.length === 0) {
    // No notebook at all rather than one that says "add some topics". The setup flow asks for
    // topics at the moment the feature is turned on, so an empty list is a choice — and a daily
    // page whose only content is a nag is worse than no page.
    log("news: skipped, no topics set");
    return null;
  }
  if (!deps.newsClient) return null;
  const update = await gatherDailyUpdate(topics, deps.newsClient, { model: deps.newsModel, log });
  if (update.searches > 0 || update.usage.output_tokens > 0) {
    // Recorded as its own stage so /admin/expenses separates the brief from reading pages — this
    // is the cost that happens whether or not the customer wrote anything.
    stats.costUsd += await repo.recordCosts(db2(deps), runId, user.id, "news", [
      { ...update.usage, model: deps.newsModel, mode: "standard" as const, pages: update.searches, cost_usd: update.costUsd },
    ]);
  }
  if (update.error) log(`news: no brief this morning (${update.error})`);
  return composeDailyUpdate({
    sections: update.sections,
    date: localDate,
    generatedAt,
    runLabel,
    unavailable: update.error ? "The news search did not answer this morning. Tomorrow's brief will pick up where this one left off." : null,
  });
}

/** Narrow helper so the block above reads without a `deps.db` in the middle of every line. */
function db2(deps: PipelineDeps): Db {
  return deps.db;
}

/**
 * The candidate words for a date's crossword: from the database if some run already fetched them,
 * from a model if this is the first run of the date, and from the built-in pool if the model cannot
 * be reached at all.
 *
 * One puzzle per day for every subscriber, so this is the only part of the puzzle that needs
 * storing — the sudoku and the word search are pure functions of the date and come out identical
 * everywhere without being told. Storing the words also settles rule 4 properly: a retried night
 * reads back the same list and rebuilds the same grid, where the first version would have asked
 * again and produced a different puzzle.
 */
async function crosswordWordsFor(
  deps: PipelineDeps,
  spec: CrosswordSpec,
  localDate: string,
  userId: string,
  runId: string,
  stats: RunStats,
  log: (m: string) => void,
): Promise<readonly repo.CrosswordWordRow[]> {
  const stored = await repo.getDailyPuzzleWords(db2(deps), localDate, "crossword");
  if (stored && stored.length > 0) {
    log(`crossword: ${stored.length} words already generated for ${localDate}, shared`);
    return stored;
  }
  const seeded = seededCrossword(localDate);
  if (seeded) {
    // Generated ahead of time with `pnpm make:puzzles` and committed, so this week's puzzles were
    // reviewed before anyone's tablet saw them. Stored on first use as well, so the record of what was
    // printed on a date is in one place whether the words came from the seed file or the model.
    log(`crossword: ${seeded.length} words from the committed set for ${localDate}`);
    return repo.claimDailyPuzzleWords(db2(deps), localDate, "crossword", seeded, "seeded");
  }
  if (!deps.newsClient) {
    // Fixture runs and any environment without a key. The pool is fixed, so the puzzle is still the
    // same for everybody; it is only less varied than one a model wrote.
    log("crossword: no Anthropic client, using the built-in general-knowledge pool");
    return GENERAL_KNOWLEDGE;
  }
  const result = await crosswordWords(deps.newsClient, { ask: spec.ask, model: deps.newsModel, log });
  if (result.usage.output_tokens > 0) {
    // Booked to the HOUSE, not to this customer. This run paid for it only because it was first to
    // reach midnight; every other account that day reads the row for nothing, so charging it here
    // would make one arbitrary customer look expensive to serve. It is not added to the run's own
    // stats for the same reason — `stats.costUsd` is what this account cost.
    await repo.recordHouseCosts(db2(deps), runId, "puzzle", [
      { ...result.usage, model: deps.newsModel, mode: "standard" as const, pages: 1, cost_usd: result.costUsd },
    ]);
  }
  if (result.error || result.words.length === 0) {
    log(`crossword: the model gave no usable words (${result.error ?? "empty"}), using the built-in pool`);
    return GENERAL_KNOWLEDGE;
  }
  return repo.claimDailyPuzzleWords(db2(deps), localDate, "crossword", result.words, deps.newsModel);
}

/**
 * A crossword, or null when one cannot be had tonight.
 *
 * Two ways it returns null, and both end with a word search on the page rather than a bad crossword:
 * too few of the words would interlock to fill the day's grid, or — the one that must never reach
 * paper — the finished grid contains a run of letters that is not a clued answer. The layout cannot
 * produce that by construction, so the check is a belt on top of the braces; if it ever fires,
 * something is wrong and printing is the worse option.
 *
 * The grid's shape and answer count come from the weekday: 25 on Monday, 35 on Wednesday, 50 on
 * Friday, each in the smallest grid that holds them, because grid squares are the room the solver
 * has to write in. See CROSSWORD_SPECS.
 */
async function buildCrosswordInput(
  deps: PipelineDeps,
  localDate: string,
  userId: string,
  runId: string,
  stats: RunStats,
  log: (m: string) => void,
): Promise<PuzzleInput | null> {
  const spec = specFor(isoWeekday(localDate));
  const words = await crosswordWordsFor(deps, spec, localDate, userId, runId, stats, log);
  const cw = buildCrossword(words, seedFor(localDate, "crossword"), spec);
  const floor = minPlaced(spec);
  if (cw.placed.length < floor) {
    log(`crossword: only ${cw.placed.length} of ${words.length} words interlocked, needs ${floor} of a target ${spec.target}`);
    return null;
  }
  const check = validateCrossword(cw);
  if (!check.ok) {
    log(`crossword: REJECTED, grid contained ${check.unclued.length} unclued run(s)`);
    return null;
  }
  const { across, down } = cluesByDirection(cw);
  const numbers = new Map<string, number>();
  for (const p of cw.placed) numbers.set(`${p.row},${p.col}`, p.number);
  log(`crossword: ${cw.placed.length}/${spec.target} answers in ${cw.cols}x${cw.rows} (${across.length} across, ${down.length} down)`);
  return {
    kind: "crossword",
    cols: cw.cols,
    rows: cw.rows,
    grid: cw.grid,
    numbers,
    across: across.map((p) => ({ number: p.number, clue: p.clue, answer: p.answer })),
    down: down.map((p) => ({ number: p.number, clue: p.clue, answer: p.answer })),
  };
}

function sudokuInput(seed: number): PuzzleInput {
  const s = generateSudoku(seed);
  return { kind: "sudoku", puzzle: s.puzzle, solution: s.solution, difficulty: s.difficulty };
}

/**
 * General words only. This used to be built from the customer's own topics and lexicon, which made
 * it their puzzle rather than a generic one — but one puzzle is now produced per day and given to
 * every subscriber, and a shared grid cannot be about one person's projects.
 */
function wordSearchInput(seed: number): PuzzleInput {
  const ws = generateWordSearch(GENERAL_WORDS, seed);
  // The placements, not the set of occupied squares: the answer key draws a loop round each word and
  // a loop needs to know which way the word runs.
  return { kind: "word_search", size: ws.size, grid: ws.grid, words: ws.placed.map((p) => p.word), placements: ws.placed };
}

function emptyStats(): RunStats {
  return {
    docsSeen: 0,
    docsChanged: 0,
    pagesChanged: 0,
    pagesRendered: 0,
    pagesDecoded: 0,
    pagesFailed: 0,
    tasksFound: 0,
    eventsFound: 0,
    meetingRequestsFound: 0,
    meetingsFound: 0,
    checkboxUpdates: 0,
    inboxItems: 0,
    emailsSent: 0,
    purgedRunId: null,
    purgedFiles: 0,
    purgedBytes: 0,
    costUsd: 0,
  };
}



/** The watch-folder entry meaning "documents sitting loose in the tablet's root". */
export const ROOT_FOLDER = "/";

/** Does `path` live in `folder`? "/" means the root itself, not everything under it. */
export function inWatchedFolder(path: string, folder: string): boolean {
  if (folder === ROOT_FOLDER) return path.lastIndexOf("/") === 0;
  const f = folder.replace(/\/$/, "");
  return path === f || path.startsWith(`${f}/`);
}

export function selectDocuments(docs: TabletDocument[], settings: { watchFolders: string[]; includePdfs: boolean; outputToRoot?: boolean }): TabletDocument[] {
  return docs.filter((d) => {
    if (inKeepFolder(d.path)) return false;
    if ((NEVER_READ_BACK as readonly string[]).includes(d.name)) return false;
    // Output only: its lines are a transcription already, and reading one back would report the
    // printed text as tomorrow's new handwriting, and the day after's, for ever.
    if (dailyNotesDate(d.name) !== null) return false;
    if (isOurDocument(d)) return true; // our own planner pages: the closed loop
    if (d.fileType === "epub") return false;
    if (d.fileType === "pdf" && !settings.includePdfs) return false;
    if (settings.watchFolders.length === 0) return true;
    return settings.watchFolders.some((f) => inWatchedFolder(d.path, f));
  });
}

/** "Only files modified during the previous day": the window opens at local midnight of the day before the run date. */
export function changeWindowStart(localDate: string, timezone: string, lastSuccessStartedAt: Date | null, windowHours?: number): DateTime {
  const midnight = DateTime.fromISO(localDate, { zone: timezone }).startOf("day");
  const base = midnight.minus({ days: 1 });
  if (windowHours !== undefined) return DateTime.utc().minus({ hours: windowHours });
  // No successful run yet means no snapshots exist, so a fresh account starts from a week of
  // notes rather than a single day — otherwise the first planner is nearly empty.
  if (!lastSuccessStartedAt) return midnight.minus({ days: FIRST_RUN_LOOKBACK_DAYS });
  const last = DateTime.fromJSDate(lastSuccessStartedAt).minus({ hours: 1 });
  return last < base ? last : base; // catch-up after a missed night
}

/**
 * A page is processed when its ink hash differs from the last snapshot.
 *
 * For a page with no snapshot the question is which of two things it is: a page the user just
 * added to a notebook whose pages we have recorded (always decode), or a page of a notebook we
 * have no page-level record of at all (decode only if it was written inside the window, so
 * taking up an old notebook does not decode years of history).
 *
 * The distinction is per-PAGE-record, not per-document: a document can carry a hash snapshot
 * with no page rows behind it, and reading that as "we know this notebook" decoded a year of an
 * existing one in a single night.
 */
/**
 * How many pages off the end of a notebook to read the first time it is touched, when its pages
 * carry no usable timestamp. reMarkable notebooks are written at the end, so the new ink is there.
 */
export const FIRST_SIGHT_TAIL_PAGES = 3;

/**
 * How many undatable inked pages a document may carry on first sight and still be read whole.
 *
 * Position is the wrong question for a template. A 226-page planner kit annotated on twenty
 * scattered days is twenty pages of deliberate writing, and a tail measured from the end of the
 * file reads three of them. What separates "a document in use" from "a history to leave alone" is
 * how MUCH ink there is, not where it sits: a notebook filled over a year carries ink on most of
 * its pages, a template in use carries it on a few.
 *
 * Above this, the tail still applies and the rest is baselined — so nothing is lost permanently,
 * it just waits for the page to be touched again.
 */
export const FIRST_SIGHT_MAX_INKED_PAGES = 25;

export function pageChanged(
  page: { pageId: string; index: number; hash: string | null; modified: string | null },
  snapshot: Map<string, string | null>,
  windowStart: DateTime,
  /**
   * Set when this notebook has no page snapshots at all — nothing to compare against.
   * `tailPageIds` is the last few pages that actually carry ink (see FIRST_SIGHT_TAIL_PAGES).
   */
  firstSight: { pagesNeverSeen: boolean; tailPageIds: ReadonlySet<string> } = { pagesNeverSeen: false, tailPageIds: new Set() },
): boolean {
  if (!page.hash) return false;
  if (snapshot.has(page.pageId)) return snapshot.get(page.pageId) !== page.hash;

  // A page with no snapshot, in a notebook whose pages we HAVE recorded, is new ink by
  // definition — the user added a page. Read it, and never let a timestamp decide: page 2 of a
  // notebook whose page 1 was already snapshotted was being dropped whenever its timestamp did
  // not parse the way this code assumed.
  if (!firstSight.pagesNeverSeen) return true;

  // No page of this notebook has ever been recorded, so we cannot tell new ink from old. A
  // timestamp settles it when there is one.
  const at = parseCloudDate(page.modified);
  if (at !== null) return at.getTime() >= windowStart.toMillis();

  // And when there is not: "read it, paying for one page beats losing it" was the old answer, and
  // it is wrong at notebook scale. Pages that carry no timestamp do not carry one individually —
  // a whole notebook of them reads as new the moment the notebook is touched, which on 2026-09-15
  // turned three notebooks into 44 pages, 20 meetings and 19 emails of months-old material.
  //
  // So read the tail, where reMarkable puts new writing, and baseline the rest. Baselining records
  // each hash, so a page that is genuinely edited later differs from its snapshot and decodes then
  // — the notebook heals itself on the next real edit instead of being re-read in full now.
  //
  // The tail counts pages that carry INK, not pages. An annotated PDF is the case that makes the
  // difference: a year planner is ~365 pages of which three are written on, and counting all of
  // them puts every annotation outside a tail measured from the end of the file.
  return firstSight.tailPageIds.has(page.pageId);
}

export async function runPipeline(deps: PipelineDeps, params: PipelineParams): Promise<RunOutcome> {
  const { db, log } = deps;
  const now = deps.now ?? (() => DateTime.utc());
  const user = await repo.getUser(db, params.userId);
  const settings = user.settings;
  const tz = user.timezone;
  const localNow = now().setZone(tz);
  const localDate = params.localDate ?? localNow.toISODate()!;
  const threshold = settings.confidenceThreshold ?? 0.7;

  if (!params.force) {
    const satisfied = await repo.findSatisfiedRun(db, user.id, localDate);
    if (satisfied && params.kind === "nightly") {
      log(`run skipped: ${localDate} already satisfied by ${satisfied.kind} run ${satisfied.id.slice(0, 8)}`);
      return { runId: null, status: "skipped", localDate, stats: null, error: null };
    }
  }

  const seq = await repo.nextSeq(db, user.id, localDate, params.kind);
  const lastSuccess = await repo.lastSuccessfulRun(db, user.id);
  const run = await repo.createRun(db, { userId: user.id, localDate, kind: params.kind, seq, requestedVia: params.requestedVia, decodeModel: deps.decodeModel, cacheDir: null });
  await repo.updateRun(db, run.id, { cacheDir: deps.cache.location(run.id) });
  params.onStarted?.(run.id);
  const runLabel = params.kind === "nightly" ? "nightly" : `on-demand ${seq}`;
  const stats = emptyStats();
  log(`run ${run.id.slice(0, 8)} started: ${runLabel} for ${localDate} (${tz})`);

  // Failsafe: anything older than 48h is gone regardless of what happens tonight.
  for (const swept of await deps.cache.sweep(48)) log(`cache failsafe purged run ${swept.runId.slice(0, 8)}: ${swept.files} files, ${swept.bytes} bytes`);

  try {
    // ---- 1. sync + change detection --------------------------------------------------
    let tree = await deps.tablet.listTree();
    // Before anything is chosen for reading: every path under a renamed folder changes, and a choice
    // made from stale paths is how our own planners would be read back as the customer's writing.
    // Only when uploading, because a dry run must not write to the tablet — and it need not: until
    // the rename happens the old folder is inert (LEGACY_OUTPUT_FOLDERS).
    if (params.upload !== false && (await migrateBrandFolders(deps.tablet, tree, log))) tree = await deps.tablet.listTree();
    const candidates = selectDocuments(tree.documents, settings);
    stats.docsSeen = candidates.length;
    const snapshots = await repo.loadDocSnapshots(db, user.id);
    const windowStart = changeWindowStart(localDate, tz, lastSuccess?.startedAt ?? null, params.windowHours);
    const windowWhy = params.windowHours !== undefined ? ` (${params.windowHours}h override)` : lastSuccess ? "" : ` (first run: ${FIRST_RUN_LOOKBACK_DAYS}-day lookback)`;
    log(`sync: ${tree.documents.length} documents, ${candidates.length} watched; window opens ${windowStart.toISO()}${windowWhy}`);

    const downloaded: Array<{ doc: DownloadedDocument; changedPageIds: string[] }> = [];
    /** Every page id of every notebook whose pages were listed tonight — what a deleted page is proved against. */
    const listedPages = new Map<string, Set<string>>();
    /** Each listed page's cloud timestamp, which dates its writing for the daily Notes. */
    const pageModified = new Map<string, string | null>();
    const baselineOnly: TabletDocument[] = [];
    /** Pages seen but not decoded: snapshotted so they are never mistaken for new ink. */
    const baselinePages: Array<{ docId: string; pages: Array<{ pageId: string; index: number; hash: string | null }> }> = [];
    for (const doc of candidates) {
      const snap = snapshots.get(doc.id);
      if (snap && snap.hash === doc.hash) continue;
      const modified = doc.lastModified ? DateTime.fromJSDate(doc.lastModified) : null;
      const inWindow = modified === null ? !!snap : modified >= windowStart;
      if (!inWindow) {
        baselineOnly.push(doc); // first sight of an old document: record the hash, do not decode
        continue;
      }
      const pageRefs = await deps.tablet.listPages(doc);
      listedPages.set(doc.id, new Set(pageRefs.map((p) => p.pageId)));
      for (const p of pageRefs) pageModified.set(`${doc.id}/${p.pageId}`, p.modified);
      const pageSnap = await repo.loadPageSnapshots(db, user.id, doc.id);
      // "Have we ever recorded this notebook's pages?" — NOT "have we seen the document?". A
      // document can carry a hash snapshot with no page rows behind it (it was baselined whole,
      // or only some pages were ever decoded), and treating those pages as new ink decoded a
      // year of an existing notebook in one night.
      const pagesNeverSeen = pageSnap.size === 0;
      // First sight of a document, for the pages that carry no timestamp of their own: read them
      // all when the ink is sparse enough to be a document in use, and fall back to the tail when
      // there is so much of it that this is a history rather than a day's work. Pages that DO
      // carry a timestamp never reach this — the window decides those.
      const inkedUndatable = pageRefs.filter((p) => p.hash && parseCloudDate(p.modified) === null);
      const readWhole = inkedUndatable.length <= FIRST_SIGHT_MAX_INKED_PAGES;
      const tailPageIds = new Set((readWhole ? inkedUndatable : inkedUndatable.slice(-FIRST_SIGHT_TAIL_PAGES)).map((p) => p.pageId));
      const changedPageIds = pageRefs.filter((p) => pageChanged(p, pageSnap, windowStart, { pagesNeverSeen, tailPageIds })).map((p) => p.pageId);
      if (pagesNeverSeen && inkedUndatable.length > 0) {
        // Ids and counts only (rule 5). This is the line that says why a first sight read what it
        // did, which is the hard thing to work out afterwards from the page count alone.
        log(
          `first sight ${doc.id.slice(0, 8)}: ${pageRefs.length} pages, ${inkedUndatable.length} inked without a timestamp, ` +
            `${readWhole ? "all read" : `tail ${tailPageIds.size} read, ${inkedUndatable.length - tailPageIds.size} baselined as history`}`,
        );
      }
      // Record every page we did NOT decode at its current hash, so "no snapshot" converges on
      // meaning "genuinely new page" instead of "never got round to it".
      const changed = new Set(changedPageIds);
      baselinePages.push({ docId: doc.id, pages: pageRefs.filter((p) => !changed.has(p.pageId)) });
      if (changedPageIds.length === 0) {
        // Examined and found nothing. Worth a line: "the document changed but no page did" is the
        // hardest outcome to explain afterwards, and the page count alone cannot distinguish a
        // notebook nobody wrote in from an annotated PDF whose ink we failed to see. Counts and
        // timestamps only, never content (rule 5).
        const inked = pageRefs.filter((p) => p.hash);
        const dated = inked.map((p) => parseCloudDate(p.modified)).filter((d): d is Date => d !== null);
        const newest = dated.length ? new Date(Math.max(...dated.map((d) => d.getTime()))) : null;
        log(
          `no changed pages in ${doc.id.slice(0, 8)}: ${pageRefs.length} pages, ${inked.length} with ink, ` +
            `${dated.length} of those dated, newest ${newest ? newest.toISOString() : "none"}; window opens ${windowStart.toISO()}`,
        );
        baselineOnly.push({ ...doc, pageCount: pageRefs.length });
        continue;
      }
      const dl = await deps.tablet.downloadDocument(doc, { onlyPageIds: changedPageIds });
      for (const p of dl.pages) if (p.rm) await deps.cache.put(run.id, `downloads/${doc.id}/${p.pageId}.rm`, p.rm);
      if (dl.basePdf) await deps.cache.put(run.id, `downloads/${doc.id}/base.pdf`, dl.basePdf);
      downloaded.push({ doc: dl, changedPageIds });
      stats.docsChanged++;
      stats.pagesChanged += changedPageIds.length;
    }
    log(`change detection: ${stats.docsChanged} changed documents, ${stats.pagesChanged} changed pages, ${baselineOnly.length} baselined`);

    // ---- 2. render ------------------------------------------------------------------
    const decodeInputs: DecodePageInput[] = [];
    const pageMeta = new Map<string, { doc: DownloadedDocument; pageId: string; pageIndex: number; hash: string | null; svg: string | null }>();
    const renderedByKey = new Map<string, Uint8Array[]>();
    /** Pages we could not render or decode: their hashes must NOT be snapshotted, so the next run retries them. */
    const unprocessed = new Set<string>();
    for (const { doc, changedPageIds } of downloaded) {
      const { pages, failed } = await deps.renderer.renderDocument(doc, changedPageIds);
      stats.pagesFailed += failed.length;
      for (const f of failed) {
        unprocessed.add(`${doc.document.id}/${f.pageId}`);
        log(`render failed for ${doc.document.id.slice(0, 8)}/${f.pageId.slice(0, 8)}: ${f.reason}`);
      }
      for (const p of pages) {
        for (let i = 0; i < p.segments.length; i++) await deps.cache.put(run.id, `images/${doc.document.id}/${String(p.pageIndex).padStart(3, "0")}-s${i}.png`, p.segments[i]!);
        stats.pagesRendered++;
        const key = `${doc.document.id}/${p.pageId}`;
        pageMeta.set(key, { doc, pageId: p.pageId, pageIndex: p.pageIndex, hash: doc.pages.find((x) => x.pageId === p.pageId)?.hash ?? null, svg: p.svg });
        // Kept in the same one-day cache as the images, and deleted with them (rule 5). The
        // drawing survives only inside the notebook that gets written back to the tablet.
        if (p.svg) await deps.cache.put(run.id, `ink/${doc.document.id}/${String(p.pageIndex).padStart(3, "0")}.svg`, Buffer.from(p.svg));
        renderedByKey.set(key, p.segments);
        decodeInputs.push({
          key,
          images: p.segments,
          context: {
            notebookName: doc.document.name,
            notebookPath: doc.document.path,
            pageIndex: p.pageIndex,
            pageCount: doc.document.pageCount,
            todayIso: localDate,
            timezone: tz,
          },
        });
      }
    }

    // ---- 3. decode ------------------------------------------------------------------
    const mode = params.kind === "nightly" ? "batch" : "standard";
    const mergePages: MergePage[] = [];
    /** Tonight's reading of every decoded page, as written lines, for the daily Notes. */
    const readings: Array<{ docId: string; pageId: string; notebook: string; pageIndex: number; lines: string[]; ours: boolean }> = [];
    const decodedKinds = new Map<string, { kind: string; confidence: number }>();
    if (decodeInputs.length) {
      log(`decode: ${decodeInputs.length} pages via ${mode} API (${deps.decodeModel})`);
      const results = await deps.decoder.decodePages(decodeInputs, mode);
      stats.costUsd += await repo.recordCosts(db, run.id, user.id, "decode", totalUsage(results).values());
      for (const r of results) {
        const meta = pageMeta.get(r.key)!;
        await deps.cache.put(run.id, `decode/${meta.doc.document.id}/${meta.pageId}.json`, Buffer.from(JSON.stringify(r)));
        if (!r.extraction) {
          stats.pagesFailed++;
          unprocessed.add(r.key);
          log(`decode failed for ${r.key.slice(0, 8)}…: ${r.error}`);
          continue;
        }
        stats.pagesDecoded++;
        decodedKinds.set(r.key, { kind: r.extraction.page_kind, confidence: r.extraction.overall_confidence });
        // The calibration sheet is a training sample, never content. Capturing it is an explicit
        // action in the web UI (it needs the printed half cropped away), so runs only skip it.
        if (meta.doc.document.name === CALIBRATION_NOTEBOOK) continue;
        stats.tasksFound += r.extraction.tasks.length;
        stats.eventsFound += r.extraction.events.length;
        stats.meetingRequestsFound += r.extraction.meeting_requests.length;
        stats.checkboxUpdates += r.extraction.checkbox_updates.length;
        // Strokes are parsed for every page but only reproduced for one the merge judges a
        // drawing, which is the cheap order: parsing is a regex, reproducing is half a page.
        // On one of our own pages the transcription can include what we printed; only the notes the
        // decoder found there are handwriting. Everywhere else the transcription is the page.
        const ours = r.extraction.page_kind === "planner";
        const written = ours ? r.extraction.notes.map((n) => n.text).join("\n") : r.extraction.page_kind === "blank" ? "" : r.extraction.transcription;
        readings.push({ docId: meta.doc.document.id, pageId: meta.pageId, notebook: meta.doc.document.name, pageIndex: meta.pageIndex, lines: pageLines(written), ours });
        const drawing = meta.svg ? parseInkSvg(meta.svg) : null;
        mergePages.push({
          notebook: meta.doc.document.name,
          pageIndex: meta.pageIndex,
          // The ids, so a note read from this page can leave the live Notes notebook once the page
          // or its notebook is deleted (sourceGone.ts).
          docId: meta.doc.document.id,
          pageId: meta.pageId,
          extraction: r.extraction,
          drawing,
          inkCoverage: drawing ? inkCoverage(drawing) : 0,
        });
      }
      // Every page failing is a provider or configuration fault, not an empty night. Fail the
      // run loudly and before compose, so yesterday's notebooks stay on the tablet (rule: never
      // write a broken planner) and nothing is snapshotted as seen.
      if (stats.pagesDecoded === 0) {
        const why = results.find((r) => r.error)?.error ?? "unknown error";
        throw new Error(`all ${decodeInputs.length} page(s) failed to decode: ${why}`);
      }
    }

    // ---- 3b. notes whose source is gone ----------------------------------------------
    // Before the working set is loaded, so tonight's Notes notebook already leaves them out.
    const gone = await repo.applySourceGone(db, user.id, (notes) => sourceGoneVerdicts(notes, tree.documents, listedPages));
    if (gone.hidden || gone.restored) log(`notes: ${gone.hidden} left the live notebook (source deleted), ${gone.restored} back (source found again)`);

    // ---- 4. merge (deterministic) ---------------------------------------------------
    const previous = await repo.loadWorkingSet(db, deps.sealer, user.id);
    const merged = mergeRun(previous, mergePages, { today: localDate, threshold });
    for (const line of merged.log) log(`merge: ${line}`);
    stats.meetingsFound = merged.changes.meetingsCreated;
    stats.inboxItems = merged.state.inbox.filter((i) => i.status === "pending").length;

    // ---- 4b. the day's new handwriting (the daily Notes) ------------------------------
    // What each page says now, less what it said at its last reading, dated by when it was written.
    // The last reading is kept only as word fingerprints (rule 5), so it is compared in that form.
    const printOf = (line: string) => lineTokens(line).map((t) => deps.sealer.fingerprint(t));
    const lastReadings = await repo.loadPageReadings(db, user.id, [...new Set(readings.map((r) => r.docId))]);
    const windowDate = windowStart.setZone(tz).toISODate()!;
    const fresh: DailyNoteEntry[] = [];
    for (const r of readings) {
      const key = `${r.docId}/${r.pageId}`;
      const added = newLines(lastReadings.get(key) ?? null, r.lines, printOf);
      if (added.length === 0) continue;
      const date = writtenOn(pageModified.get(key) ?? null, localDate, tz, params.kind, windowDate);
      fresh.push({ date, docId: r.docId, pageId: r.pageId, notebook: r.notebook, pageIndex: r.pageIndex, lines: added });
    }
    // A sync earlier the same day may have started these dates' documents; add to them, not over them.
    const noteDates = [...new Set(fresh.map((e) => e.date))].sort();
    const dayEntries = new Map<string, DailyNoteEntry>();
    for (const e of await repo.loadDailyNotes(db, deps.sealer, user.id, noteDates)) dayEntries.set(`${e.date}|${e.docId}|${e.pageId}`, e);
    const touched: DailyNoteEntry[] = [];
    for (const e of fresh) {
      const k = `${e.date}|${e.docId}|${e.pageId}`;
      const before = dayEntries.get(k);
      const next = before ? { ...e, lines: appendLines(before.lines, e.lines) } : e;
      dayEntries.set(k, next);
      touched.push(next);
    }
    if (fresh.length) log(`notes: ${fresh.reduce((n, e) => n + e.lines.length, 0)} new line(s) on ${fresh.length} page(s), for ${noteDates.join(", ")}`);

    // ---- 5. compose -----------------------------------------------------------------
    const generatedAt = now().setZone(tz).toISO()!;
    const views = buildOutputSet(merged.state, {
      today: localDate,
      timezone: tz,
      generatedAt,
      runLabel,
      stats: { pagesRead: stats.pagesDecoded, tasksFound: stats.tasksFound, eventsFound: stats.eventsFound, meetingRequestsFound: stats.meetingRequestsFound, notesFound: stats.meetingsFound },
    });
    const planner = await composePlanner(views.planner, merged.state.tasks);
    const actionList = await composeActionList({ model: views.actionList, date: localDate, generatedAt, runLabel });
    type Output = {
      kind: "planner" | "action_list" | "meeting_notes" | "daily_update" | "daily_puzzle";
      name: string;
      composed: { pdf: Uint8Array; pageCount: number; printed: PrintedItem[] };
      /** Set on a daily Notes document: the day it reports. */
      notesDate?: string;
    };
    const outputs: Output[] = [
      { kind: "planner" as const, name: "Planner", composed: planner },
      { kind: "action_list" as const, name: "Action List", composed: actionList },
    ];
    // A day with nothing new written gets no document: the latest one stays where it is.
    for (const date of noteDates) {
      const model = buildDailyNotes(date, [...dayEntries.values()]);
      if (model.lineCount === 0) continue;
      outputs.push({ kind: "meeting_notes" as const, name: dailyNotesName(date), composed: await composeDailyNotes({ model, generatedAt, runLabel }), notesDate: date });
    }

    // ---- 5b. the optional extras -----------------------------------------------------
    // Both are switched on by default and off by the customer, and neither can fail the night:
    // a missing brief is a missing brief, not a lost planner.
    if (settings.dailyUpdate.enabled) {
      const brief = await buildDailyUpdate(deps, user, localDate, generatedAt, runLabel, run.id, stats, log);
      if (brief) outputs.push({ kind: "daily_update" as const, name: DAILY_UPDATE_NAME, composed: brief });
    }
    if (settings.dailyPuzzle.enabled) {
      const choice = puzzleFor(localDate);
      let kind = choice.kind;
      let insteadOf = choice.insteadOf;
      let puzzle: PuzzleInput | null = null;

      if (kind === "crossword") {
        puzzle = await buildCrosswordInput(deps, localDate, user.id, run.id, stats, log);
        if (!puzzle) {
          // A thin layout or a model that did not answer: print a word search instead rather than
          // a crossword nobody can solve, and say so on the page.
          kind = "word_search";
          insteadOf = "crossword";
        }
      }
      if (!puzzle) {
        const seed = seedFor(localDate, kind);
        puzzle = kind === "sudoku" ? sudokuInput(seed) : wordSearchInput(seed);
      }
      const composed = await composeDailyPuzzle({ puzzle, date: localDate, generatedAt, runLabel, insteadOf });
      outputs.push({ kind: "daily_puzzle" as const, name: DAILY_PUZZLE_NAME, composed });
      log(`puzzle: ${kind}${insteadOf ? ` (standing in for ${insteadOf})` : ""}, ${composed.pageCount} pages`);
    }
    const printed: PrintedItem[] = [];
    for (const o of outputs) {
      await deps.cache.put(run.id, `outputs/${o.name}.pdf`, o.composed.pdf);
      printed.push(...o.composed.printed);
    }
    const notesOut = outputs.filter((o) => o.notesDate);
    const notesPart = notesOut.length ? notesOut.map((o) => `${o.name} ${o.composed.pageCount}p`).join(", ") : "no new Notes";
    log(`compose: Planner ${planner.pageCount}p, Action List ${actionList.pageCount}p, ${notesPart}; ${printed.length} checkbox rows printed`);

    // ---- 6. upload + archive rotation ------------------------------------------------
    const tabletIds = new Map<string, string>();
    if (params.upload !== false) {
      const target = outputFolderFor(settings);
      const folder = await deps.tablet.ensureFolder(target);
      const archive = await deps.tablet.ensureFolder(ARCHIVE_FOLDER);
      await rotateArchive(deps, tree.documents, folder, archive, localDate, log);
      // The daily extras keep their own folders. Only reached for when the feature is on, so an
      // account that has switched the puzzle off never grows an empty Puzzles folder.
      const filed = new Set<string>();
      if (outputs.some((o) => o.kind === "daily_puzzle")) {
        const id = await archiveDaily(deps, tree.documents, folder, await deps.tablet.ensureFolder(PUZZLE_FOLDER), DAILY_PUZZLE_NAME, localDate, log);
        if (id) filed.add(id);
      }
      if (outputs.some((o) => o.kind === "daily_update")) {
        const id = await archiveDaily(deps, tree.documents, folder, await deps.tablet.ensureFolder(HEADLINES_FOLDER), DAILY_UPDATE_NAME, localDate, log);
        if (id) filed.add(id);
      }
      // `tree` was listed before the filing above, so a notebook that has just been filed still reads
      // as sitting in the output folder. Under a legacy name — the first night after a rename — the
      // cleaner would take it for a stray and delete it, which by id is the copy just archived.
      // The daily Notes before the cleaner, which would otherwise see a day being filed as a stray.
      const notes = await publishDailyNotes(deps, tree.documents, folder, notesOut, log);
      for (const id of notes.touched) filed.add(id);
      for (const [name, id] of notes.uploaded) tabletIds.set(name, id);
      await cleanStaleOutputs(deps.tablet, tree.documents.filter((d) => !filed.has(d.id)), folder.id, log);
      for (const o of outputs) {
        if (o.notesDate) continue;
        const res = await deps.tablet.uploadPdf(o.name, o.composed.pdf, folder, { replace: true });
        tabletIds.set(o.name, res.id);
      }
      log(`upload: ${outputs.length} notebooks replaced in ${target === ROOT_OUTPUT_FOLDER ? "the tablet root" : target}`);
    }
    for (const o of outputs) {
      await repo.registerDocument(db, { userId: user.id, runId: run.id, kind: o.kind, name: o.name, cachePath: `outputs/${o.name}.pdf`, bytes: o.composed.pdf.length, pageCount: o.composed.pageCount, tabletDocId: tabletIds.get(o.name) ?? null });
    }

    // ---- 7. email: one per decoded meeting, registered address only (rule 10) -------
    if (settings.email.meetingNotes) {
      const mailable = merged.newMeetings.slice(0, MAX_MEETING_EMAILS_PER_RUN);
      const suppressed = merged.newMeetings.length - mailable.length;
      for (const m of mailable) {
        const mail = buildMeetingMail(user.email, user.id, m, {
          syncedAt: now().setZone(tz).toFormat("HH:mm"),
          ...((process.env.SERVICE_URL || process.env.APP_URL) ? { appUrl: `${(process.env.SERVICE_URL || process.env.APP_URL)!.replace(/\/$/, "")}/documents?tab=meetings` } : {}),
          notebooksRead: stats.docsChanged,
          pagesRead: stats.pagesDecoded,
        });
        if (await repo.emailAlreadySent(db, mail.idempotencyKey)) continue;
        const res = await deps.mail.send(mail);
        await repo.logEmail(db, { userId: user.id, runId: run.id, idempotencyKey: mail.idempotencyKey, toEmail: user.email, subject: mail.subject, status: res.status, providerId: res.providerId, error: res.error });
        if (res.status === "sent") stats.emailsSent++;
        else if (res.status === "failed") log(`email failed for meeting ${m.id}: ${res.error}`);
      }
      log(`email: ${stats.emailsSent} meeting note email(s) sent via ${deps.mail.name} (${merged.newMeetings.length} new meetings)`);
      if (suppressed > 0) {
        log(`email: ${suppressed} meeting note email(s) suppressed — more than ${MAX_MEETING_EMAILS_PER_RUN} in one run reads as a re-read of history, not a day`);
      }
    }

    // ---- 7b. deliver the night's PDFs to the user's confirmed delivery address -------
    // Only ever to an address the user typed into their own settings AND confirmed by clicking
    // the link mailed to it (rule 10). An unconfirmed address is reported, never used.
    if (settings.deliveryEmail) {
      if (!settings.deliveryVerifiedAt) {
        log("delivery: address not confirmed yet — nothing sent (check the settings page)");
      } else {
        const wanted = settings.deliveryDocuments;
        const chosen = outputs.filter((o) => (o.kind === "planner" ? wanted.planner : o.kind === "action_list" ? wanted.actionList : wanted.meetingNotes));
        if (chosen.length === 0) {
          log("delivery: no documents selected — nothing sent");
        } else {
        const mail = buildDeliveryMail(
          settings.deliveryEmail,
          user.id,
          localDate,
          chosen.map((o) => ({ name: o.name, pdf: o.composed.pdf, pageCount: o.composed.pageCount })),
          // Tonight's new meetings: with the meetings-only notebook gone, the whole list is not a
          // number this mail can usefully quote.
          { openActions: views.actionList.openCount, meetings: merged.newMeetings.length },
        );
        if (await repo.emailAlreadySent(db, mail.idempotencyKey)) {
          log("delivery: already sent for this date");
        } else {
          const res = await deps.mail.send(mail);
          await repo.logEmail(db, { userId: user.id, runId: run.id, idempotencyKey: mail.idempotencyKey, toEmail: settings.deliveryEmail, subject: mail.subject, status: res.status, providerId: res.providerId, error: res.error });
          if (res.status === "sent") stats.emailsSent++;
          log(`delivery: ${chosen.length} PDF(s) ${res.status} via ${deps.mail.name}${res.error ? ` — ${res.error}` : ""}`);
          }
        }
      }
    }

    // ---- 8. draft invites: Phase 0 keeps meeting_requests as DRAFTS (rule 7); the calendar
    // provider that turns confirmed drafts into invites arrives with packages/calendar (Phase 2).
    const confirmed = merged.state.meetingRequests.filter((m) => m.state === "confirmed").length;
    if (confirmed) log(`invites: ${confirmed} confirmed draft(s) waiting for a calendar connection`);

    // ---- 9. persist state + snapshots (only after everything above succeeded) -------
    await repo.saveWorkingSet(db, deps.sealer, user.id, run.id, merged.state, printed);
    // Our own pages are read once — tomorrow's Planner is a new document — so their readings are
    // not kept: they would only pile up under ids that never come back.
    for (const r of readings) if (!r.ours) await repo.savePageReading(db, user.id, run.id, r.docId, r.pageId, r.lines.map(printOf));
    for (const e of touched) await repo.saveDailyNote(db, deps.sealer, user.id, e);
    const pruned = await repo.pruneDailyNotes(db, user.id, DateTime.fromISO(localDate).minus({ days: DAILY_NOTES_KEEP_DAYS }).toISODate()!);
    if (pruned) log(`notes: deleted the stored lines of ${pruned} page(s) older than ${DAILY_NOTES_KEEP_DAYS} days (the tablet keeps the documents)`);
    for (const d of baselineOnly) await repo.upsertDocSnapshot(db, user.id, run.id, { id: d.id, hash: d.hash, name: d.name, path: d.path, fileType: d.fileType, lastModified: d.lastModified, pageCount: d.pageCount });
    for (const { docId, pages } of baselinePages) {
      for (const p of pages) await repo.upsertPageSnapshot(db, user.id, run.id, docId, { pageId: p.pageId, index: p.index, hash: p.hash, kind: null, confidence: null });
    }
    for (const { doc } of downloaded) {
      const d = doc.document;
      const stillPending = doc.pages.filter((p) => unprocessed.has(`${d.id}/${p.pageId}`)).length;
      // The document hash short-circuits the per-page check, so a document with any page left
      // unprocessed keeps its old snapshot and is examined again next run.
      if (stillPending === 0) {
        await repo.upsertDocSnapshot(db, user.id, run.id, { id: d.id, hash: d.hash, name: d.name, path: d.path, fileType: d.fileType, lastModified: d.lastModified, pageCount: d.pageCount });
      } else {
        log(`retry queued: "${d.name}" has ${stillPending} page(s) that did not process`);
      }
      for (const p of doc.pages) {
        if (unprocessed.has(`${d.id}/${p.pageId}`)) continue;
        const k = decodedKinds.get(`${d.id}/${p.pageId}`);
        await repo.upsertPageSnapshot(db, user.id, run.id, d.id, { pageId: p.pageId, index: p.index, hash: p.hash, kind: k?.kind ?? null, confidence: k?.confidence ?? null });
      }
    }
    await repo.markTabletOk(db, user.id, null);

    // ---- 10. rotate the 1-day cache: delete the PREVIOUS run's cache, log it (rule 5) -
    for (const prev of await repo.unpurgedPreviousRuns(db, user.id, run.id)) {
      const purged = await deps.cache.purge(prev.id);
      await repo.updateRun(db, prev.id, { cachePurgedAt: new Date() });
      stats.purgedRunId = prev.id;
      stats.purgedFiles += purged.files;
      stats.purgedBytes += purged.bytes;
      log(`cache rotated: purged run ${prev.id.slice(0, 8)} (${purged.files} files, ${purged.bytes} bytes)`);
    }

    // The run has put current notebooks on the tablet, so any edit still waiting to be sent has
    // now been sent. Without this the "send to your tablet" prompt survives the night and offers
    // a delivery that already happened.
    await repo.clearPendingDelivery(db, user.id);
    await repo.finishRun(db, run.id, "succeeded", stats, null);
    log(`run ${run.id.slice(0, 8)} succeeded: ${stats.pagesDecoded} pages decoded, ${stats.tasksFound} tasks, ${stats.eventsFound} events, ${stats.meetingsFound} meetings, $${stats.costUsd.toFixed(4)}`);
    return { runId: run.id, status: "succeeded", localDate, stats, error: null };
  } catch (err) {
    const msg = err instanceof TabletProviderError ? `tablet [${err.code}]: ${err.message}` : (err as Error).message;
    if (err instanceof TabletProviderError) await repo.markTabletOk(db, user.id, msg);
    await repo.finishRun(db, run.id, "failed", stats, msg);
    log(`run ${run.id.slice(0, 8)} failed: ${msg}`);
    return { runId: run.id, status: "failed", localDate, stats, error: msg };
  }
}

/**
 * How long the day's new lines are kept after their date (schema.dailyNotes). Long enough for the
 * night's run to add to a document a sync started during the day; no longer, because they are
 * transcription (rule 5). The tablet keeps the documents themselves.
 */
export const DAILY_NOTES_KEEP_DAYS = 2;

/**
 * The local date a page was written on, for the daily Notes.
 *
 * The page's own cloud timestamp when it has one — a page written at 23:40 belongs to that day, not
 * to the morning the nightly run read it. Without one: the day that just ended for a nightly run,
 * which is what it reads, and today for a sync. Never after today, and never before the run's window
 * opened — a timestamp from the distant past on a page the run is reading now is not a reason to
 * file its writing under a month ago.
 */
export function writtenOn(modified: string | null, localDate: string, timezone: string, kind: "nightly" | "on_demand", windowDate: string): string {
  const fallback = kind === "nightly" ? DateTime.fromISO(localDate).minus({ days: 1 }).toISODate()! : localDate;
  const at = parseCloudDate(modified);
  if (at === null) return fallback;
  const day = DateTime.fromJSDate(at).setZone(timezone).toISODate()!;
  if (day > localDate) return localDate;
  if (day < windowDate) return fallback;
  return day;
}

/**
 * Put tonight's "Notes - <date>" documents on the tablet.
 *
 * The newest day lives beside the Planner; every earlier day is filed in /ScriptumIQ/Notes, which is
 * in KEEP_FOLDERS so it is never read back and never tidied. So publishing a day also files whichever
 * day was live before it. A day re-published by a later sync — the night's run adding to the copy a
 * sync made that afternoon — replaces that copy wherever it now is, and is never left twice.
 *
 * Returns what it uploaded, by name, and every document it moved or deleted: the caller's tree was
 * listed before any of this, and the cleaner must not act on those.
 */
export async function publishDailyNotes(
  deps: PipelineDeps,
  docs: readonly TabletDocument[],
  folder: TabletFolder,
  notes: ReadonlyArray<{ name: string; composed: { pdf: Uint8Array }; notesDate?: string }>,
  log: (m: string) => void,
): Promise<{ uploaded: Map<string, string>; touched: Set<string> }> {
  const uploaded = new Map<string, string>();
  const touched = new Set<string>();
  if (notes.length === 0) return { uploaded, touched };
  const archive = await deps.tablet.ensureFolder(NOTES_FOLDER);
  const live = docs.filter((d) => d.parentId === folder.id && dailyNotesDate(d.name) !== null);
  const filedNames = new Set(docs.filter((d) => d.parentId === archive.id).map((d) => d.name));
  const publishing = new Set(notes.map((o) => o.name));
  const newest = [...live.map((d) => dailyNotesDate(d.name)!), ...notes.map((o) => o.notesDate!)].sort().at(-1)!;

  for (const d of live) {
    const date = dailyNotesDate(d.name)!;
    // Tonight's upload replaces it in place.
    if (date === newest && publishing.has(d.name)) continue;
    try {
      if (publishing.has(d.name) || filedNames.has(d.name)) {
        // Re-published into the archive below, or already filed there: one copy, not two.
        await deps.tablet.deleteDocument(d);
      } else if (date !== newest) {
        await deps.tablet.moveDocument(d, archive);
        log(`filed "${d.name}" into ${archive.name}`);
      } else continue;
      touched.add(d.id);
    } catch (err) {
      log(`could not file "${d.name}": ${(err as Error).message}`);
    }
  }
  for (const o of notes) {
    const res = await deps.tablet.uploadPdf(o.name, o.composed.pdf, o.notesDate === newest ? folder : archive, { replace: true });
    uploaded.set(o.name, res.id);
  }
  return { uploaded, touched };
}

/**
 * File yesterday's copy of a daily notebook into its own folder before today's replaces it.
 *
 * Same shape as `rotateArchive`, with one deliberate difference: nothing is deleted. The planner
 * rotation drops archives older than a week because a planner page has had its ticks read back and
 * is spent; an unfinished crossword has not, and removing something from the customer's own tablet
 * that they did not ask to have removed is not a decision to take quietly. They will accumulate —
 * one notebook a day — and a retention rule can be added when somebody wants one.
 *
 * Dated from the document's own last-modified time rather than tonight's date, so a night that did
 * not run does not misfile the copy it finds.
 *
 * Yesterday's copy may still carry a name we used to write — the first night after a rename it always
 * does. It is filed under the CURRENT name, because otherwise the cleaner would delete it as a stray
 * and the last puzzle before the rename would be the one puzzle that never reached the archive.
 *
 * Returns the id of the document it filed, or null. The caller needs it: the tree it holds was
 * listed before this moved anything.
 */
async function archiveDaily(
  deps: PipelineDeps,
  docs: readonly TabletDocument[],
  folder: TabletFolder,
  destination: TabletFolder,
  name: string,
  localDate: string,
  log: (m: string) => void,
): Promise<string | null> {
  const names = [name, ...(LEGACY_NAMES_OF[name] ?? [])];
  // The current name first, so a tablet somehow carrying both files the live one.
  const current = names.map((n) => docs.find((d) => d.parentId === folder.id && d.name === n)).find((d) => d !== undefined);
  if (!current) return null;
  const stamp = current.lastModified ? DateTime.fromJSDate(current.lastModified).toISODate() : localDate;
  const dated = `${name} ${stamp}`;
  if (docs.some((d) => d.parentId === destination.id && d.name === dated)) {
    // Already filed under this date — a re-run of the same night. Leave the copy that is there and
    // let today's upload replace the live one (rule 4: a re-run must not produce duplicates).
    return null;
  }
  try {
    const renamed = await deps.tablet.renameDocument(current, dated);
    await deps.tablet.moveDocument({ ...current, hash: renamed.hash, name: dated }, destination);
    log(`filed "${dated}" into ${destination.name}`);
    return current.id;
  } catch (err) {
    // Never fail the night over filing: today's notebook still reaches the tablet.
    log(`could not file "${dated}": ${(err as Error).message}`);
    return null;
  }
}

/** Keep 7 dated Planner archives (ARCHITECTURE §6). */
async function rotateArchive(deps: PipelineDeps, docs: TabletDocument[], folder: TabletFolder, archive: TabletFolder, localDate: string, log: (m: string) => void): Promise<void> {
  const current = docs.find((d) => d.parentId === folder.id && d.name === "Planner");
  if (current) {
    const stamp = current.lastModified ? DateTime.fromJSDate(current.lastModified).toISODate() : localDate;
    try {
      const renamed = await deps.tablet.renameDocument(current, `Planner ${stamp}`);
      await deps.tablet.moveDocument({ ...current, hash: renamed.hash, name: `Planner ${stamp}` }, archive);
    } catch (err) {
      log(`archive rotation skipped: ${(err as Error).message}`);
    }
  }
  const cutoff = DateTime.fromISO(localDate).minus({ days: ARCHIVE_DAYS }).toISODate()!;
  const stale = docs.filter((d) => d.parentId === archive.id && /^Planner (\d{4}-\d{2}-\d{2})$/.test(d.name) && d.name.slice(8) < cutoff);
  for (const d of stale) {
    try {
      await deps.tablet.deleteDocument(d);
    } catch (err) {
      log(`archive cleanup skipped for ${d.name}: ${(err as Error).message}`);
    }
  }
  if (stale.length) log(`archive: removed ${stale.length} planner(s) older than ${ARCHIVE_DAYS} days`);
}
