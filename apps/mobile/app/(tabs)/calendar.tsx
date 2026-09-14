/**
 * The calendar: a month at a glance, then the day you tapped.
 *
 * The occurrences come from `documents.calendar`, which expands repeating series server-side
 * through `packages/core/recurrence.ts`. The app deliberately does none of that arithmetic — a
 * weekly meeting written once must land on the same days here, on the tablet page, and in the
 * email, and rule 1 says one deterministic implementation decides that.
 *
 * A month is one request. Tapping a day filters what is already in hand, so moving around inside
 * a month costs nothing.
 */
import { Link, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/api";
import { Card, DueChip, Empty, ErrorNote, Label, Loading } from "@/components/ui";
import { WEEKDAY_INITIALS, addMonths, dayOfMonth, dayTitle, monthGrid, monthStart, monthTitle } from "@/format";
import { useQuery, useReloadOnReturn } from "@/useApi";
import { TOUCH_TARGET, color, font, space, type } from "@/theme";

type Calendar = Awaited<ReturnType<typeof trpc.documents.calendar.query>>;

/** Local midnight as an ISO date — the phone's own day, before the server says which it thinks. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const [cursor, setCursor] = useState(() => monthStart(localToday()));
  const [selected, setSelected] = useState<string | null>(null);

  // Fetch the whole 42-cell grid, not just the month: the leading and trailing cells are real
  // days, and a dotless 1 October under September would be a lie rather than an omission.
  // Six weeks is inside the server's 62-day cap.
  const grid = monthGrid(cursor);
  const from = grid[0]!;
  const to = grid[41]!;
  const cal = useQuery<Calendar>(() => trpc.documents.calendar.query({ from, to }), [from, to]);

  // The server's idea of today, in the user's own timezone — not the phone's, which may be
  // somewhere else entirely this week.
  const today = cal.data?.today ?? localToday();
  const day = selected ?? (today >= from && today <= to ? today : monthStart(cursor));

  const byDay = useMemo(() => {
    const map = new Map<string, { events: Calendar["events"]; meetings: Calendar["meetings"]; due: Calendar["due"] }>();
    const bucket = (iso: string) => {
      let b = map.get(iso);
      if (!b) map.set(iso, (b = { events: [], meetings: [], due: [] }));
      return b;
    };
    for (const e of cal.data?.events ?? []) if (e.date) bucket(e.date).events.push(e);
    for (const m of cal.data?.meetings ?? []) if (m.date) bucket(m.date).meetings.push(m);
    for (const t of cal.data?.due ?? []) bucket(t.due).due.push(t);
    return map;
  }, [cal.data]);

  const router = useRouter();
  useReloadOnReturn(cal.reload);

  const move = useCallback((months: number) => {
    setCursor((c) => addMonths(c, months));
    setSelected(null);
  }, []);

  const chosen = byDay.get(day);

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }}
      refreshControl={<RefreshControl refreshing={cal.refreshing} onRefresh={() => void cal.reload()} tintColor={color.midnight} />}
    >
      <View style={{ paddingHorizontal: space.lg, marginBottom: space.md, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View>
          <Label>CALENDAR</Label>
          <Text style={[type.title, { marginTop: space.xs }]}>{monthTitle(cursor)}</Text>
        </View>
        <View style={{ flexDirection: "row" }}>
          <Arrow glyph="‹" label="Previous month" onPress={() => move(-1)} />
          <Arrow glyph="›" label="Next month" onPress={() => move(1)} />
          <Link href={{ pathname: "/item/new", params: { type: "event", date: day } }} asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`New calendar entry on ${dayTitle(day)}`}
              style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ fontSize: 30, lineHeight: 34, color: color.midnight }}>+</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {cal.error ? <ErrorNote>{cal.error}</ErrorNote> : null}
      {cal.loading ? <Loading /> : null}

      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
        <Card style={{ padding: space.sm }}>
          <View style={{ flexDirection: "row" }}>
            {WEEKDAY_INITIALS.map((w, i) => (
              <Text key={i} style={[type.label, { flex: 1, textAlign: "center", paddingBottom: space.xs }]}>
                {w}
              </Text>
            ))}
          </View>
          {Array.from({ length: 6 }, (_, week) => (
            <View key={week} style={{ flexDirection: "row" }}>
              {grid.slice(week * 7, week * 7 + 7).map((iso) => {
                const inMonth = iso.slice(0, 7) === cursor.slice(0, 7);
                const b = byDay.get(iso);
                const marks = (b?.events.length ?? 0) + (b?.meetings.length ?? 0);
                const dueCount = b?.due.length ?? 0;
                const isToday = iso === today;
                const isChosen = iso === day;
                return (
                  <Pressable
                    key={iso}
                    onPress={() => setSelected(iso)}
                    accessibilityRole="button"
                    accessibilityLabel={`${dayTitle(iso)}${marks ? `, ${marks} on the calendar` : ""}${dueCount ? `, ${dueCount} due` : ""}`}
                    accessibilityState={{ selected: isChosen }}
                    style={{ flex: 1, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}
                  >
                    <View
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: isChosen ? color.midnight : isToday ? color.sunrise : "transparent",
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: isToday || isChosen ? font.sansBold : font.sans,
                          fontSize: 14,
                          color: isChosen ? color.parchment : inMonth ? color.midnight : color.meta,
                        }}
                      >
                        {dayOfMonth(iso)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 2, height: 4, marginTop: 2 }}>
                      {marks ? <Dot color={isChosen ? color.gold : color.midnight} /> : null}
                      {dueCount ? <Dot color={color.goldText} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Card>

        <Card>
          <Label style={{ marginBottom: space.sm }}>{dayTitle(day).toUpperCase()}</Label>
          {!chosen || (chosen.events.length === 0 && chosen.meetings.length === 0 && chosen.due.length === 0) ? (
            <Empty>Nothing on this day.</Empty>
          ) : (
            <>
              {chosen.events.map((e) => (
                <Pressable
                  key={`${e.id}-${e.date}`}
                  onPress={() => router.push({ pathname: "/item/[type]/[id]", params: { type: "event", id: e.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit: ${e.title}`}
                  style={({ pressed }) => ({ flexDirection: "row", gap: space.md, paddingVertical: space.sm, alignItems: "flex-start", opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={[type.label, { minWidth: 52, paddingTop: 3 }]}>{e.startTime ?? "ALL DAY"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{e.title}</Text>
                    {e.location || e.recurrence ? (
                      <Text style={[type.label, { marginTop: 2 }]}>
                        {[e.location?.toUpperCase(), e.recurrence?.toUpperCase()].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
              {chosen.meetings.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => router.push({ pathname: "/item/[type]/[id]", params: { type: "meeting", id: m.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit note: ${m.topic}`}
                  style={({ pressed }) => ({ flexDirection: "row", gap: space.md, paddingVertical: space.sm, alignItems: "flex-start", opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={[type.label, { minWidth: 52, paddingTop: 3 }]}>{m.time ?? "NOTE"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{m.topic}</Text>
                    <Text style={[type.label, { marginTop: 2 }]}>MEETING NOTE</Text>
                  </View>
                </Pressable>
              ))}
              {chosen.due.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => router.push({ pathname: "/item/[type]/[id]", params: { type: "task", id: t.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit: ${t.text}`}
                  style={({ pressed }) => ({ flexDirection: "row", gap: space.md, paddingVertical: space.sm, alignItems: "center", opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={[type.label, { minWidth: 52 }]}>{t.dueTime ?? "DUE"}</Text>
                  <Text style={[type.body, { flex: 1 }]}>{t.text}</Text>
                  {t.priority === "high" ? <DueChip label="PRIORITY" soon /> : null}
                </Pressable>
              ))}
            </>
          )}
        </Card>
      </View>
    </ScrollView>
  );
}

function Dot({ color: c }: { color: string }) {
  return <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c }} />;
}

function Arrow({ glyph, label, onPress }: { glyph: string; label: string; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
    >
      <Text style={{ fontSize: 26, color: color.midnight, lineHeight: 30 }}>{glyph}</Text>
    </Pressable>
  );
}
