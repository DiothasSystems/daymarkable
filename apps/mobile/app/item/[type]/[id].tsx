/**
 * The editor: an action, a calendar entry, or a meeting note.
 *
 * The thing to understand before changing anything here is that this screen offers TWO different
 * acts, and they must not be allowed to collapse into one:
 *
 *   Save            "that is not what I want any more" — `items.update`. The plan changed. It
 *                   teaches the decoder nothing.
 *   Fix the reading "that is not what I wrote" — `corrections.fix`. The page was misread, so the
 *                   changed words go into this writer's lexicon and the same misread stops
 *                   recurring. CLAUDE.md calls the lexicon the largest lever on accuracy.
 *
 * If Save quietly did both, an app whose whole purpose is editing would fill that lever with
 * words that were never on a page. So correcting is a separate, deliberate control, offered
 * where it makes sense — on an item that came off a page at all — and never as the default.
 *
 * The item is loaded through `items.get`, which returns the stored row. Not the registry's copy:
 * that projects a repeating series onto its next occurrence, and saving it back would move the
 * series (packages/pipeline/src/edits.ts).
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage, trpc } from "@/api";
import { Choice, DateField, Field, TextField, TimeField } from "@/components/fields";
import { BackBar, Button, Card, ErrorNote, Label, Loading } from "@/components/ui";
import { useQuery } from "@/useApi";
import { color, font, space, type } from "@/theme";

type Item = Awaited<ReturnType<typeof trpc.items.get.query>>;
type ItemType = "task" | "event" | "meeting";

type Priority = "high" | "normal" | "low";
type Kind = "action" | "follow_up";
/** "" is "Once" — the absence of a rule, which the server stores as null. */
type Repeat = "" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";

const PRIORITIES: readonly { value: Priority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: "action", label: "Action" },
  { value: "follow_up", label: "Follow-up" },
];

/** What the back bar says this screen is. Keyed by the route param, so it is known before the fetch. */
const TITLES: Record<ItemType, string> = {
  task: "Edit action",
  event: "Edit calendar entry",
  meeting: "Edit meeting note",
};

const RECURRENCES: readonly { value: Repeat; label: string }[] = [
  { value: "", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

/** A list the user edits as lines, which is the only sane way to do it with a thumb. */
const toLines = (xs: string[]) => xs.join("\n");
const fromLines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export default function ItemEditor() {
  // Destructured away from `type`, which is also the theme's text styles. Two things called
  // `type` in one file is how a route param ends up being asked for a font size.
  const { type: routeType, id } = useLocalSearchParams<{ type: ItemType; id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const q = useQuery<Item>(() => trpc.items.get.query({ itemType: routeType, itemId: id }), [routeType, id]);

  const [draft, setDraft] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("");
  const [learned, setLearned] = useState<string[] | null>(null);

  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);

  const patch = useCallback(<T extends Item>(update: Partial<T>) => {
    setDraft((d) => (d ? ({ ...d, ...update } as Item) : d));
  }, []);

  const save = useCallback(async () => {
    if (!draft || !q.data) return;
    setBusy(true);
    setError(null);
    try {
      // Only what actually changed: the server's patch is field-by-field, and a field sent back
      // unchanged is a write with nothing behind it.
      //
      // Built per item type rather than by diffing loosely into a Record. The server validates
      // with zod, which STRIPS keys it does not know — so a misspelled field would vanish in
      // transit and the user would be told their edit saved. Typing the patch is what makes that
      // a compile error instead of a lost edit.
      const sent = await sendPatch(draft, q.data);
      if (!sent) {
        router.back();
        return;
      }
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [draft, q.data, router]);

  /** The other act: this is not what the page said. */
  const fixReading = useCallback(async () => {
    if (!draft) return;
    const text = correction.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const r = await trpc.corrections.fix.mutate({ itemType: draft.itemType, itemId: draft.id, text });
      setLearned(r.learned);
      setCorrecting(false);
      await q.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [draft, correction, q]);

  const remove = useCallback(() => {
    if (!draft) return;
    const label = draft.itemType === "task" ? "action" : draft.itemType === "event" ? "calendar entry" : "meeting note";
    Alert.alert(
      "Remove this item?",
      `It leaves the list for good — the same as crossing it out on paper.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: `Remove ${label}`,
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                // Meetings are notes, not list items: they have no drop transition.
                await trpc.documents.decide.mutate({ itemType: draft.itemType as "task" | "event", itemId: draft.id, action: "drop" });
                router.back();
              } catch (err) {
                setError(errorMessage(err));
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [draft, router]);

  /**
   * The bar sits outside every early return below, because the screens that most need a way out
   * are the ones that failed to load — an item that will not fetch would otherwise be a spinner
   * or an error line with nothing to press.
   */
  const frame = (children: React.ReactNode) => (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <BackBar title={TITLES[routeType] ?? "Edit"} onBack={() => router.back()} />
      {children}
    </View>
  );

  if (q.error) return frame(<ErrorNote>{q.error}</ErrorNote>);
  if (q.loading || !draft) return frame(<Loading />);

  /** Only an item that came off a page can have been misread. A typed one has no reading to fix. */
  const cameOffAPage = draft.itemType === "event" ? draft.origin === "ink" : !!draft.source.notebook;
  const readingOf = draft.itemType === "task" ? draft.text : draft.itemType === "event" ? draft.title : draft.topic;

  return frame(
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {draft.itemType === "task" ? (
          <>
            <Field label="ACTION">
              <TextField label="Action" value={draft.text} onChange={(text) => patch({ text })} multiline minHeight={72} />
            </Field>
            <Field label="DUE">
              <DateField label="Due date" value={draft.due} onChange={(due) => patch({ due })} />
            </Field>
            {draft.due ? (
              <Field label="AT">
                <TimeField label="Due time" value={draft.dueTime} onChange={(dueTime) => patch({ dueTime })} />
              </Field>
            ) : null}
            <Field label="PRIORITY">
              <Choice label="Priority" value={draft.priority} options={PRIORITIES} onChange={(priority) => patch({ priority })} />
            </Field>
            <Field label="KIND" hint="A follow-up is something you are waiting on rather than doing.">
              <Choice label="Kind" value={draft.kind} options={KINDS} onChange={(kind) => patch({ kind })} />
            </Field>
            <Field label="PROJECT">
              <TextField label="Project" value={draft.project ?? ""} onChange={(v) => patch({ project: v || null })} placeholder="None" />
            </Field>
          </>
        ) : null}

        {draft.itemType === "event" ? (
          <>
            <Field label="TITLE">
              <TextField label="Title" value={draft.title} onChange={(title) => patch({ title })} multiline minHeight={60} />
            </Field>
            <Field
              label="DATE"
              hint={draft.recurrence ? "This is the date the series starts from — changing it moves every occurrence." : undefined}
            >
              <DateField label="Date" value={draft.date} onChange={(date) => patch({ date })} />
            </Field>
            <Field label="FROM">
              <TimeField label="Start time" value={draft.startTime} onChange={(startTime) => patch({ startTime })} />
            </Field>
            <Field label="UNTIL">
              <TimeField label="End time" value={draft.endTime} onChange={(endTime) => patch({ endTime })} />
            </Field>
            <Field label="WHERE">
              <TextField label="Location" value={draft.location ?? ""} onChange={(v) => patch({ location: v || null })} placeholder="Nowhere in particular" />
            </Field>
            <Field label="REPEATS">
              <Choice
                label="Repeats"
                value={draft.recurrence ?? ""}
                options={RECURRENCES}
                onChange={(v) => patch({ recurrence: v === "" ? null : v })}
              />
            </Field>
          </>
        ) : null}

        {draft.itemType === "meeting" ? (
          <>
            <Field label="TOPIC">
              <TextField label="Topic" value={draft.topic} onChange={(topic) => patch({ topic })} multiline minHeight={60} />
            </Field>
            <Field label="DATE">
              <DateField label="Date" value={draft.date} onChange={(date) => patch({ date })} />
            </Field>
            <Field label="TIME">
              <TimeField label="Time" value={draft.time} onChange={(time) => patch({ time })} />
            </Field>
            <Field label="NOTES">
              <TextField label="Notes" value={draft.text} onChange={(text) => patch({ text })} multiline minHeight={160} />
            </Field>
            <Field label="DECISIONS" hint="One per line.">
              <TextField label="Decisions" value={toLines(draft.decisions)} onChange={(v) => patch({ decisions: fromLines(v) })} multiline minHeight={90} />
            </Field>
            <Field label="ACTIONS FROM THIS MEETING" hint="One per line.">
              <TextField label="Actions from this meeting" value={toLines(draft.actions)} onChange={(v) => patch({ actions: fromLines(v) })} multiline minHeight={90} />
            </Field>
          </>
        ) : null}

        <Button title="Save" onPress={() => void save()} busy={busy} />

        {cameOffAPage ? (
          <Card style={{ marginTop: space.xl }}>
            <Label style={{ marginBottom: space.xs }}>NOT WHAT YOU WROTE?</Label>
            <Text style={[type.small, { marginBottom: space.md }]}>
              Saving above changes your plan. This is different: it tells dayMarkable it misread your
              handwriting, and the words you fix are remembered so the same misreading stops.
            </Text>
            {learned?.length ? (
              <Text style={[type.small, { color: color.goldText, marginBottom: space.md, fontFamily: font.sansBold }]}>
                Learned: {learned.join(", ")}
              </Text>
            ) : null}
            {correcting ? (
              <>
                <TextField label="What the page actually says" value={correction} onChange={setCorrection} multiline minHeight={72} />
                <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
                  <Button title="That is what it says" onPress={() => void fixReading()} busy={busy} style={{ flex: 1 }} />
                  <Button title="Cancel" variant="secondary" onPress={() => setCorrecting(false)} />
                </View>
              </>
            ) : (
              <Button
                title="Fix what dayMarkable read"
                variant="secondary"
                onPress={() => {
                  setCorrection(readingOf);
                  setLearned(null);
                  setCorrecting(true);
                }}
              />
            )}
          </Card>
        ) : null}

        {draft.itemType !== "meeting" ? (
          <View style={{ marginTop: space.xl }}>
            <Button title="Remove from the list" variant="tertiary" onPress={remove} busy={busy} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>,
  );
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Send what changed. Returns false when nothing did, so the caller can just go back.
 *
 * Each branch names its own fields, which is the point: the patch type comes from the server's
 * router, so a field that does not exist there will not compile here.
 */
async function sendPatch(draft: Item, saved: Item): Promise<boolean> {
  if (draft.itemType === "task" && saved.itemType === "task") {
    const p: {
      text?: string;
      due?: string | null;
      dueTime?: string | null;
      priority?: Priority;
      kind?: Kind;
      project?: string | null;
    } = {};
    if (draft.text !== saved.text) p.text = draft.text;
    if (draft.due !== saved.due) p.due = draft.due;
    if (draft.dueTime !== saved.dueTime) p.dueTime = draft.dueTime;
    if (draft.priority !== saved.priority) p.priority = draft.priority;
    if (draft.kind !== saved.kind) p.kind = draft.kind;
    if (draft.project !== saved.project) p.project = draft.project;
    if (Object.keys(p).length === 0) return false;
    await trpc.items.update.mutate({ itemType: "task", itemId: draft.id, patch: p });
    return true;
  }

  if (draft.itemType === "event" && saved.itemType === "event") {
    const p: {
      title?: string;
      date?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      location?: string | null;
      recurrence?: Exclude<Repeat, ""> | null;
    } = {};
    if (draft.title !== saved.title) p.title = draft.title;
    if (draft.date !== saved.date) p.date = draft.date;
    if (draft.startTime !== saved.startTime) p.startTime = draft.startTime;
    if (draft.endTime !== saved.endTime) p.endTime = draft.endTime;
    if (draft.location !== saved.location) p.location = draft.location;
    if (draft.recurrence !== saved.recurrence) p.recurrence = draft.recurrence;
    if (Object.keys(p).length === 0) return false;
    await trpc.items.update.mutate({ itemType: "event", itemId: draft.id, patch: p });
    return true;
  }

  if (draft.itemType === "meeting" && saved.itemType === "meeting") {
    const p: { topic?: string; date?: string | null; time?: string | null; text?: string; decisions?: string[]; actions?: string[] } = {};
    if (draft.topic !== saved.topic) p.topic = draft.topic;
    if (draft.date !== saved.date) p.date = draft.date;
    if (draft.time !== saved.time) p.time = draft.time;
    if (draft.text !== saved.text) p.text = draft.text;
    if (!sameList(draft.decisions, saved.decisions)) p.decisions = draft.decisions;
    if (!sameList(draft.actions, saved.actions)) p.actions = draft.actions;
    if (Object.keys(p).length === 0) return false;
    await trpc.items.update.mutate({ itemType: "meeting", itemId: draft.id, patch: p });
    return true;
  }

  return false;
}
