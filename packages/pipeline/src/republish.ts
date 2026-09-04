/**
 * Republish: rebuild the three notebooks from the stored working set and upload them, without
 * syncing, rendering or decoding anything.
 *
 * This is the cheap half of a run. It exists because correcting a misread in the web UI changes
 * the canonical data but not the PDFs already sitting on the tablet, and making the user spend
 * an on-demand sync (whose quota exists to bound TOKEN spend) on a job that calls no model
 * would be the wrong trade. No API cost, no quota, no snapshot writes.
 */
import { buildOutputSet, type PrintedItem } from "@daymarkable/core";
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
  tablet: TabletProvider;
  log: (msg: string) => void;
}

export interface RepublishResult {
  uploaded: string[];
  pageCounts: Record<string, number>;
  openActions: number;
  meetings: number;
}

export async function republishNotebooks(deps: RepublishDeps, userId: string): Promise<RepublishResult> {
  const { db, log } = deps;
  const user = await repo.getUser(db, userId);
  const tz = user.timezone;
  const nowLocal = DateTime.now().setZone(tz);
  const localDate = nowLocal.toISODate()!;
  const generatedAt = nowLocal.toISO()!;

  const state = await repo.loadWorkingSet(db, deps.sealer, userId);
  const views = buildOutputSet(state, { today: localDate, timezone: tz, generatedAt, runLabel: "updated" });
  const planner = await composePlanner(views.planner, state.tasks);
  const actionList = await composeActionList({ model: views.actionList, date: localDate, generatedAt, runLabel: "updated" });
  const meetingNotes = await composeMeetingNotes({ model: views.meetingNotes, date: localDate, generatedAt, runLabel: "updated" });
  const outputs = [
    { kind: "planner" as const, name: "Planner", composed: planner },
    { kind: "action_list" as const, name: "Action List", composed: actionList },
    { kind: "meeting_notes" as const, name: "Meeting Notes", composed: meetingNotes },
  ];

  // Attach to the latest successful run so the viewer serves these from its cache (rule 12)
  // and the 1-day rotation still owns their lifetime.
  const latest = await repo.lastSuccessfulRun(db, userId);
  const printed: PrintedItem[] = [];
  const target = outputFolderFor(user.settings);
  const folder = await deps.tablet.ensureFolder(target);
  await cleanStaleOutputs(deps.tablet, (await deps.tablet.listTree()).documents, folder.id, log);
  const uploaded: string[] = [];
  const pageCounts: Record<string, number> = {};

  for (const o of outputs) {
    if (latest) await deps.cache.put(latest.id, `outputs/${o.name}.pdf`, o.composed.pdf);
    const res = await deps.tablet.uploadPdf(o.name, o.composed.pdf, folder, { replace: true });
    uploaded.push(o.name);
    pageCounts[o.name] = o.composed.pageCount;
    printed.push(...o.composed.printed);
    if (latest) {
      await db
        .update(schema.documents)
        .set({ bytes: o.composed.pdf.length, pageCount: o.composed.pageCount, tabletDocId: res.id, createdAt: new Date() })
        .where(repo.documentMatch(userId, latest.id, o.kind));
    }
  }

  // The item codes on the reprinted pages replace the previous ones, so ticks still resolve.
  if (latest) await repo.replacePrintedItems(db, userId, latest.id, printed);
  log(`republished ${uploaded.length} notebooks to ${target === ROOT_OUTPUT_FOLDER ? "the tablet root" : target} (${printed.length} checkbox rows)`);
  return { uploaded, pageCounts, openActions: views.actionList.openCount, meetings: views.meetingNotes.meetings.length };
}
