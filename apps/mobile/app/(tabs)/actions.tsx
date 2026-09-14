/**
 * The action list — the screen the app exists for (SW-003, SW-006).
 *
 * It mirrors `documents.registry`'s own grouping rather than inventing one: open actions in the
 * order the server gives them (date, then priority — rule 8), then the Inbox of things the
 * decoder was unsure about (rule 3), then what was finished in the last week, because seeing it
 * go is half the point of ticking it.
 *
 * Ticking is optimistic. The row moves the moment the thumb lifts and goes back if the server
 * disagrees — "updates the UI immediately" is the acceptance criterion, and a network round trip
 * is not immediate on a train.
 */
import { Link, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage, trpc } from "@/api";
import { TabletBanner } from "@/components/TabletBanner";
import { Card, Checkbox, DueChip, Empty, ErrorNote, Label, Loading } from "@/components/ui";
import { dueTag, sourceLine } from "@/format";
import { useQuery, useReloadOnReturn } from "@/useApi";
import { TOUCH_TARGET, color, font, space, type } from "@/theme";

type Registry = Awaited<ReturnType<typeof trpc.documents.registry.query>>;
type Docs = Awaited<ReturnType<typeof trpc.documents.list.query>>;

export default function Actions() {
  const insets = useSafeAreaInsets();
  const reg = useQuery<Registry>(() => trpc.documents.registry.query(), []);
  const docs = useQuery<Docs>(() => trpc.documents.list.query(), []);
  /** Ids whose tick is in flight, so the row can show its new state without being tapped twice. */
  const [ticking, setTicking] = useState<Record<string, true>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const refreshAll = useCallback(async () => {
    await Promise.all([reg.reload(), docs.reload()]);
  }, [reg, docs]);
  const router = useRouter();

  // Coming back from an editor must show what it changed.
  useReloadOnReturn(refreshAll);

  const decide = useCallback(
    async (itemType: "task" | "inbox", itemId: string, action: "complete" | "drop") => {
      setTicking((t) => ({ ...t, [itemId]: true }));
      setFailure(null);
      try {
        await trpc.documents.decide.mutate({ itemType, itemId, action });
        // The tick rebuilt the notebooks server-side; the banner reads that from documents.list.
        await Promise.all([reg.reload(), docs.reload()]);
      } catch (err) {
        setFailure(errorMessage(err));
      } finally {
        setTicking((t) => {
          const next = { ...t };
          delete next[itemId];
          return next;
        });
      }
    },
    [reg, docs],
  );

  if (reg.loading) return <Loading />;

  const r = reg.data;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }}
      refreshControl={<RefreshControl refreshing={reg.refreshing || docs.refreshing} onRefresh={() => void refreshAll()} tintColor={color.midnight} />}
    >
      <View style={{ paddingHorizontal: space.lg, marginBottom: space.lg, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View>
          <Label>ACTIONS</Label>
          <Text style={[type.title, { marginTop: space.xs }]}>What is open</Text>
        </View>
        <Link href={{ pathname: "/item/new", params: { type: "task" } }} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New action"
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
          >
            <Text style={{ fontSize: 30, lineHeight: 34, color: color.midnight }}>+</Text>
          </Pressable>
        </Link>
      </View>

      <TabletBanner pendingSince={docs.data?.pendingDelivery ?? null} onSent={() => void docs.reload()} />
      {reg.error ? <ErrorNote>{reg.error}</ErrorNote> : null}
      {failure ? <ErrorNote>{failure}</ErrorNote> : null}

      {!r ? null : (
        <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
          <Card>
            <Label style={{ marginBottom: space.sm }}>{`OPEN · ${r.actions.length}`}</Label>
            {r.actions.length === 0 ? (
              <Empty>Nothing open. Write something down tonight.</Empty>
            ) : (
              r.actions.map((t, i) => {
                const tag = dueTag(t.due, r.today);
                const source = sourceLine(t.source);
                return (
                  <Row key={t.id} first={i === 0}>
                    <Checkbox
                      checked={!!ticking[t.id]}
                      busy={!!ticking[t.id]}
                      label={`Mark done: ${t.text}`}
                      onPress={() => void decide("task", t.id, "complete")}
                    />
                    <Pressable
                      onPress={() => router.push({ pathname: "/item/[type]/[id]", params: { type: "task", id: t.id } })}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit: ${t.text}`}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={type.body}>{t.text}</Text>
                      {source || t.carriedCount ? (
                        <Text style={[type.label, { marginTop: 2 }]}>
                          {[source, t.carriedCount ? `CARRIED ${t.carriedCount}D` : null].filter(Boolean).join(" · ")}
                        </Text>
                      ) : null}
                    </Pressable>
                    {tag ? <DueChip label={tag.label} soon={tag.soon} /> : t.priority === "high" ? <DueChip label="PRIORITY" soon /> : null}
                  </Row>
                );
              })
            )}
          </Card>

          {r.inbox.length ? (
            <Card>
              <Label style={{ marginBottom: space.xs }}>{`INBOX · ${r.inbox.length}`}</Label>
              {/* Rule 3: these are under the confidence threshold. They are asked about, never
                  assumed onto the list. */}
              <Text style={[type.small, { marginBottom: space.sm }]}>dayMarkable was unsure it read these correctly.</Text>
              {r.inbox.map((item, i) => (
                <Row key={item.id} first={i === 0}>
                  <Checkbox
                    checked={!!ticking[item.id]}
                    busy={!!ticking[item.id]}
                    label={`Confirm: ${item.text}`}
                    onPress={() => void decide("inbox", item.id, "complete")}
                  />
                  <View style={{ flex: 1, paddingVertical: space.sm }}>
                    <Text style={type.body}>{item.text}</Text>
                    <Text style={[type.label, { marginTop: 2 }]}>
                      {[item.kind.replace("_", " ").toUpperCase(), sourceLine(item.source)].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Not relevant: ${item.text}`}
                    onPress={() => void decide("inbox", item.id, "drop")}
                    hitSlop={6}
                    style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
                  >
                    <Text style={[type.small, { color: color.meta }]}>✕</Text>
                  </Pressable>
                </Row>
              ))}
            </Card>
          ) : null}

          {r.doneRecently.length ? (
            <Card>
              <Label style={{ marginBottom: space.sm }}>DONE THIS WEEK</Label>
              {r.doneRecently.map((t) => (
                <Text key={t.id} style={[type.small, { paddingVertical: 4, textDecorationLine: "line-through" }]}>
                  {t.text}
                </Text>
              ))}
            </Card>
          ) : null}

          <Text style={[type.label, { textAlign: "center", fontFamily: font.mono }]}>
            {`TODAY ${r.today}`}
          </Text>

        </View>
      )}
    </ScrollView>
  );
}

function Row({ children, first }: { children: React.ReactNode; first: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: color.border,
      }}
    >
      {children}
    </View>
  );
}
