/**
 * Notes (SW-010): every day's daily Notes, then the meeting notes; each list, then the item.
 *
 * The body arrives decrypted from `documents.registry` — it is sealed at rest and unsealed only
 * to be shown. That makes this the one screen holding note content in memory, which is why rule
 * 5's "no user content in logs" extends here to crash reporting and any autosave telemetry: do
 * not add either without scrubbing.
 *
 * Reading and editing are the same screen deliberately. A note you cannot fix where you read it
 * sends you looking for somewhere else to fix it.
 */
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage, trpc } from "@/api";
import { Card, Empty, ErrorNote, Label, Loading } from "@/components/ui";
import { dayTitle } from "@/format";
import { useQuery, useReloadOnReturn } from "@/useApi";
import { TOUCH_TARGET, color, font, space, type } from "@/theme";

type Registry = Awaited<ReturnType<typeof trpc.documents.registry.query>>;
type Meeting = Registry["meetings"][number];
type DailyNotes = Registry["dailyNotes"][number];

export default function Notes() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reg = useQuery<Registry>(() => trpc.documents.registry.query(), []);
  useReloadOnReturn(reg.reload);
  const [open, setOpen] = useState<string | null>(null);

  if (reg.loading) return <Loading />;

  const meetings = reg.data?.meetings ?? [];
  const days = reg.data?.dailyNotes ?? [];

  const deleteDay = (date: string) =>
    Alert.alert(`Delete the notes for ${dayTitle(date)}?`, "They are removed here and on the website, and their text is erased. The document on your tablet is not changed.", [
      { text: "Keep them", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await trpc.documents.deleteNotesDay.mutate({ date });
              await reg.reload();
            } catch (err) {
              Alert.alert("Could not delete", errorMessage(err));
            }
          })();
        },
      },
    ]);

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }}
      refreshControl={<RefreshControl refreshing={reg.refreshing} onRefresh={() => void reg.reload()} tintColor={color.midnight} />}
    >
      <View style={{ paddingHorizontal: space.lg, marginBottom: space.lg }}>
        <Label>NOTES</Label>
        <Text style={[type.title, { marginTop: space.xs }]}>Daily notes</Text>
      </View>

      {reg.error ? <ErrorNote>{reg.error}</ErrorNote> : null}

      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
        {days.length === 0 ? (
          <Card>
            <Empty>No daily notes yet. Everything new you write on a day arrives the night after, or after Sync now.</Empty>
          </Card>
        ) : null}

        {days.map((d) => (
          <Day key={d.date} day={d} expanded={open === `day:${d.date}`} onToggle={() => setOpen((id) => (id === `day:${d.date}` ? null : `day:${d.date}`))} onDelete={() => deleteDay(d.date)} />
        ))}
      </View>

      <View style={{ paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: space.lg }}>
        <Text style={type.title}>Meetings</Text>
      </View>

      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
        {meetings.length === 0 ? (
          <Card>
            <Empty>No meeting notes yet. They arrive the night after you write them.</Empty>
          </Card>
        ) : null}

        {meetings.map((m) => (
          <Note
            key={m.id}
            meeting={m}
            expanded={open === m.id}
            onToggle={() => setOpen((id) => (id === m.id ? null : m.id))}
            onEdit={() => router.push({ pathname: "/item/[type]/[id]", params: { type: "meeting", id: m.id } })}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/** One day of the daily Notes: each notebook by name, the new lines of each page under it. */
function Day({ day, expanded, onToggle, onDelete }: { day: DailyNotes; expanded: boolean; onToggle(): void; onDelete(): void }) {
  const summary = `${day.notebooks.length} NOTEBOOK${day.notebooks.length === 1 ? "" : "S"} · ${day.lineCount} LINE${day.lineCount === 1 ? "" : "S"}`;
  return (
    <Card>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? "Collapse" : "Read"}: notes for ${dayTitle(day.date)}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: TOUCH_TARGET, justifyContent: "center" })}
      >
        <Text style={type.heading}>{dayTitle(day.date)}</Text>
        <Text style={[type.label, { marginTop: 2 }]}>{summary}</Text>
        {!expanded ? <Text style={[type.small, { marginTop: 2 }]}>{day.notebooks.map((n) => n.notebook).join(", ")}</Text> : null}
      </Pressable>

      {expanded ? (
        <View style={{ marginTop: space.md, gap: space.md }}>
          {day.notebooks.map((nb) => (
            <View key={nb.notebook}>
              <Text style={[type.heading, { fontSize: 17 }]}>{nb.notebook}</Text>
              {nb.pages.map((p) => (
                <View key={p.pageIndex} style={{ marginTop: space.xs }}>
                  <Label style={{ marginBottom: 2 }}>{`PAGE ${p.pageIndex + 1}`}</Label>
                  <Text style={type.body}>{p.lines.join("\n")}</Text>
                </View>
              ))}
            </View>
          ))}
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={`Delete notes for ${dayTitle(day.date)}`}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontFamily: font.sans, fontSize: 15, color: color.goldText, textDecorationLine: "underline" }}>Delete this day</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

function Note({ meeting, expanded, onToggle, onEdit }: { meeting: Meeting; expanded: boolean; onToggle(): void; onEdit(): void }) {
  const when = [meeting.date ? dayTitle(meeting.date) : null, meeting.time].filter(Boolean).join(" · ");
  return (
    <Card>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? "Collapse" : "Read"}: ${meeting.topic}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: TOUCH_TARGET, justifyContent: "center" })}
      >
        <Text style={type.heading}>{meeting.topic}</Text>
        {when ? <Text style={[type.label, { marginTop: 2 }]}>{when.toUpperCase()}</Text> : null}
        {meeting.attendees.length ? <Text style={[type.small, { marginTop: 2 }]}>{meeting.attendees.join(", ")}</Text> : null}
      </Pressable>

      {expanded ? (
        <View style={{ marginTop: space.md, gap: space.md }}>
          {meeting.text ? <Text style={type.body}>{meeting.text}</Text> : null}

          {meeting.decisions.length ? (
            <View>
              <Label style={{ marginBottom: space.xs }}>DECISIONS</Label>
              {meeting.decisions.map((d, i) => (
                <Text key={i} style={[type.body, { marginBottom: 2 }]}>
                  · {d}
                </Text>
              ))}
            </View>
          ) : null}

          {meeting.actions.length ? (
            <View>
              <Label style={{ marginBottom: space.xs }}>ACTIONS FROM THIS MEETING</Label>
              {meeting.actions.map((a, i) => (
                <Text key={i} style={[type.body, { marginBottom: 2 }]}>
                  · {a}
                </Text>
              ))}
            </View>
          ) : null}

          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Edit note: ${meeting.topic}`}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontFamily: font.sans, fontSize: 15, color: color.goldText, textDecorationLine: "underline" }}>Edit this note</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}
