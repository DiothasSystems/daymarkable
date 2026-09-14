/**
 * An action or a calendar entry the user types rather than writes.
 *
 * It joins the same list under the same rules a decoded item does, dedupe included: typing "call
 * the dentist" while an open action already says so folds into that one rather than making a
 * second (rule 8). The server says which happened, and this screen says so plainly instead of
 * pretending it added something.
 *
 * Provenance stays honest on the other side — `source: "app"`, no notebook, no page — so nothing
 * downstream counts typing as decoding (packages/pipeline/src/edits.ts).
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage, trpc } from "@/api";
import { Choice, DateField, Field, TextField, TimeField } from "@/components/fields";
import { Button, ErrorNote, Label } from "@/components/ui";
import { space, type as text } from "@/theme";

type NewType = "task" | "event";

type Priority = "high" | "normal" | "low";

const PRIORITIES: readonly { value: Priority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export default function NewItem() {
  // `type` is the route param; the theme's text styles come in as `text` to keep them apart.
  const { type: kind = "task", date } = useLocalSearchParams<{ type?: NewType; date?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [words, setWords] = useState("");
  const [on, setOn] = useState<string | null>(date ?? null);
  const [at, setAt] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const [where, setWhere] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folded, setFolded] = useState<string | null>(null);

  const create = useCallback(async () => {
    const text = words.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const r =
        kind === "event"
          ? await trpc.items.create.mutate({ itemType: "event", title: text, date: on, startTime: at, endTime: until, location: where.trim() || null })
          : await trpc.items.create.mutate({ itemType: "task", text, due: on, dueTime: at, priority });
      if (!r.created) {
        // Folded into something already open. Say so — silently doing nothing looks like a bug.
        setFolded(r.label);
        return;
      }
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [words, kind, on, at, until, where, priority, router]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Label>{kind === "event" ? "CALENDAR" : "ACTION"}</Label>
        <Text style={[text.title, { marginTop: space.xs, marginBottom: space.lg }]}>
          {kind === "event" ? "New entry" : "New action"}
        </Text>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <Field label={kind === "event" ? "TITLE" : "ACTION"}>
          <TextField
            label={kind === "event" ? "Title" : "Action"}
            value={words}
            onChange={(v) => {
              setWords(v);
              setFolded(null);
            }}
            placeholder={kind === "event" ? "Dentist" : "Call the dentist"}
            multiline
            minHeight={72}
          />
        </Field>

        <Field label={kind === "event" ? "DATE" : "DUE"}>
          <DateField label={kind === "event" ? "Date" : "Due date"} value={on} onChange={setOn} />
        </Field>

        {on || kind === "event" ? (
          <Field label={kind === "event" ? "FROM" : "AT"}>
            <TimeField label={kind === "event" ? "Start time" : "Due time"} value={at} onChange={setAt} />
          </Field>
        ) : null}

        {kind === "event" ? (
          <>
            <Field label="UNTIL">
              <TimeField label="End time" value={until} onChange={setUntil} />
            </Field>
            <Field label="WHERE">
              <TextField label="Location" value={where} onChange={setWhere} placeholder="Nowhere in particular" />
            </Field>
          </>
        ) : (
          <Field label="PRIORITY">
            <Choice<Priority> label="Priority" value={priority} options={PRIORITIES} onChange={setPriority} />
          </Field>
        )}

        {folded ? (
          <Text style={[text.small, { marginBottom: space.md }]} accessibilityLiveRegion="polite">
            Your list already says “{folded}”, so this joined it rather than making a second.
          </Text>
        ) : null}

        <Button title={folded ? "Back to the list" : "Add"} onPress={() => (folded ? router.back() : void create())} busy={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
