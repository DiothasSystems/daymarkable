/**
 * Republish: rebuild the three notebooks from the stored working set and upload them, without
 * syncing, rendering or decoding anything.
 *
 * This is the cheap half of a run. It exists because correcting a misread in the web UI changes
 * the canonical data but not the PDFs already sitting on the tablet, and making the user spend
 * an on-demand sync (whose quota exists to bound TOKEN spend) on a job that calls no model
 * would be the wrong trade. No API cost, no quota, no snapshot writes.
 */
import { buildOutputSet, notesWeekStart, type PrintedItem } from "@daymarkable/core";
import { composeActionList, composeMeetingNotes, composePlanner } from "@daymarkable/compose";
import { schema, type Db, type Sealer } from "@daymarkable/db";
import type { TabletProvider } from "@daymarkable/tablet";
import { DateTime } from "luxon";
import type { CacheStore } from "./cache.js";
import * as repo from "./repo.js";
import { cleanStaleOutputs, outputFolderFor, ROOT_OUTPUT_FOLDER } from "./run.js";


export interface RepublishDeps {
  db: Db;
  sealer: Sealer;
  cache: CacheStore;
  /**
   * Only needed to deliver. Opening a provider costs a reMarkable auth round-trip, so a rebuild
   * that is not sending anywhere must not ask for one — every tick would otherwise hit the cloud
   * for nothing, and an unpaired account could not rebuild its documents at all.
   */
  tablet?: TabletProvider;
  log: (msg: string) => void;
}

export interface RepublishOptions {
  /**
   * False composes the notebooks and refreshes what the viewer serves, without sending anything
   * to the tablet. That is what an edit needs: the documents on screen should match the text the
   * customer just fixed, but a tablet upload is theirs to ask for.
   */
  deliver?: boolean;
}

export interface RepublishResult {
  uploaded: string[];
  /** Notebooks rebuilt, whether or not they were delivered. */
  composed: string[];
  delivered: boolean;
  pageCounts: Record<string, number>;
  openActions: number;
  meetings: number;
}

export async function republishNotebooks(deps: RepublishDeps, userId: string, options: RepublishOptions = {}): Promise<RepublishResult> {
  const deliver = options.deliver ?? true;
  if (deliver && !deps.tablet) throw new Error("republish needs a tablet provider to deliver");
  const { db, log } = deps;
  const user = await repo.getUser(db, userId);
  const tz = user.timezone;
  const nowLocal = DateTime.now().setZone(tz);
  const localDate = nowLocal.toISODate()!;
  const generatedAt = nowLocal.toISO()!;

  const state = await repo.loadWorkingSet(db, deps.sealer, userId);
  // Same week filter as a run, so a republish never resurrects notes the archive already took.
  const views = buildOutputSet(state, {
    today: localDate,
    timezone: tz,
    generatedAt,
    runLabel: "updated",
    notesWeekStart: user.settings.weeklyNotesArchive ? notesWeekStart(localDate) : null,
  });
  const planner = await composePlanner(views.planner, state.tasks);
  const actionList = await composeActionList({ model: views.actionList, date: localDate, generatedAt, runLabel: "updated" });
  const meetingNotes = await composeMeetingNotes({ model: views.meetingNotes, date: localDate, generatedAt, runLabel: "updated" });
  const outputs = [
    { kind: "planner" as const, name: "Planner", composed: planner },
    { kind: "action_list" as const, name: "Action List", composed: actionList },
    { kind: "meeting_notes" as const, name: "Notes", composed: meetingNotes },
  ];

  // Attach to the latest successful run so the viewer serves these from its cache (rule 12)
  // and the 1-day rotation still owns their lifetime.
  const latest = await repo.lastSuccessfulRun(db, userId);
  const printed: PrintedItem[] = [];
  const target = outputFolderFor(user.settings);
  const tablet = deps.tablet;
  const folder = deliver && tablet ? await tablet.ensureFolder(target) : null;
  if (folder && tablet) await cleanStaleOutputs(tablet, (await tablet.listTree()).documents, folder.id, log);
  const uploaded: string[] = [];
  const composed: string[] = [];
  const pageCounts: Record<string, number> = {};

  for (const o of outputs) {
    if (latest) await deps.cache.put(latest.id, `outputs/${o.name}.pdf`, o.composed.pdf);
    const res = folder && tablet ? await tablet.uploadPdf(o.name, o.composed.pdf, folder, { replace: true }) : null;
    composed.push(o.name);
    if (res) uploaded.push(o.name);
    pageCounts[o.name] = o.composed.pageCount;
    printed.push(...o.composed.printed);
    if (latest) {
      await db
        .update(schema.documents)
        .set({ bytes: o.composed.pdf.length, pageCount: o.composed.pageCount, ...(res ? { tabletDocId: res.id } : {}), createdAt: new Date() })
        .where(repo.documentMatch(userId, latest.id, o.kind));
    }
  }

  // The item codes on the reprinted pages replace the previous ones, so ticks still resolve.
  if (latest) await repo.replacePrintedItems(db, userId, latest.id, printed);
  log(
    deliver
      ? `republished ${uploaded.length} notebooks to ${target === ROOT_OUTPUT_FOLDER ? "the tablet root" : target} (${printed.length} checkbox rows)`
      : `rebuilt ${composed.length} notebooks from an edit; not delivered (${printed.length} checkbox rows)`,
  );
  return { uploaded, composed, delivered: deliver, pageCounts, openActions: views.actionList.openCount, meetings: views.meetingNotes.meetings.length };
}
