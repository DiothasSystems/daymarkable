/**
 * Dev tool: `pnpm --filter @daymarkable/runner notes:check`
 *
 * Reports the SHAPE of each stored meeting note — line count, longest line, how many runs of
 * two-or-more spaces it still holds, and whether repairNoteLines would change it. Never prints
 * note content (rule 5): this exists to tell "the decoder flattened it" apart from "a reader is
 * not applying the repair", which guessing at got wrong twice.
 */
import { repairNoteLines } from "@daymarkable/core";
import { ensureDefaultUser, openRuntime, repo } from "@daymarkable/pipeline";

const rt = await openRuntime("live", { log: () => {} });
const user = await ensureDefaultUser(rt);
const state = await repo.loadWorkingSet(rt.db, rt.sealer, user.id);

if (state.meetings.length === 0) console.log("no meetings stored");
for (const m of state.meetings) {
  const lines = m.text.split(/\r?\n/);
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const gaps = (m.text.match(/ {2,}/g) ?? []).length;
  const repaired = repairNoteLines(m.text);
  console.log(
    [
      `${m.date ?? "undated"} ${m.topic.slice(0, 28).padEnd(28)}`,
      `lines=${String(lines.length).padStart(3)}`,
      `longest=${String(longest).padStart(4)}`,
      `wide-gaps=${String(gaps).padStart(3)}`,
      `repair ${repaired === m.text ? "no-op        " : `-> ${repaired.split(/\r?\n/).length} lines`}`,
    ].join("  "),
  );
}
process.exit(0);
