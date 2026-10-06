/**
 * Give an action a priority or a due date — the phone's twin of the website's ActionSchedule and of
 * the tablet's L / M / H boxes and DUE line. The date is TYPED ("10/14", "Oct 14", "fri"), as it is
 * written on the tablet; the server reads it in the account's timezone (core parseTypedDate) and says
 * so when it cannot. Open on an action with no date; on a dated one it opens from the due chip.
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { errorMessage, trpc } from "@/api";
import { useRevealOnFocus } from "@/keyboard";
import { TOUCH_TARGET, color, font, radius, space, type } from "@/theme";

type Priority = "high" | "normal" | "low";

/** "normal" is shown as Medium everywhere (core PRIORITY_LABELS). */
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Medium" },
  { value: "high", label: "High" },
];

/** How a stored date is shown in the box: the way it would be typed, month first. */
function typed(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

function Chip({ label, on, onPress, a11y }: { label: string; on: boolean; onPress(): void; a11y: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: 34,
        paddingHorizontal: 12,
        justifyContent: "center",
        borderRadius: 17,
        borderWidth: 1,
        borderColor: on ? color.midnight : color.borderStrong,
        backgroundColor: on ? color.midnight : color.notepaper,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontFamily: font.sans, fontSize: 14, color: on ? color.parchment : color.midnight }}>{label}</Text>
    </Pressable>
  );
}

export function ActionSchedule({ itemId, text, due, priority, onSaved }: { itemId: string; text: string; due: string | null; priority: Priority; today?: string; onSaved(): void | Promise<void> }) {
  const [value, setValue] = useState(due ? typed(due) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reveal = useRevealOnFocus();

  const save = async (patch: { dueText?: string; priority?: Priority }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.items.update.mutate({ itemType: "task", itemId, patch });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitDate = () => {
    const next = value.trim();
    if (next === (due ? typed(due) : "")) return;
    void save({ dueText: next });
  };

  return (
    <View style={{ marginTop: space.sm, gap: 6, opacity: busy ? 0.5 : 1 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {PRIORITIES.map((p) => (
          <Chip key={p.value} label={p.label} on={priority === p.value} a11y={`${p.label} priority: ${text}`} onPress={() => priority !== p.value && void save({ priority: p.value })} />
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text style={type.label}>DUE</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          onFocus={reveal}
          onSubmitEditing={submitDate}
          onBlur={submitDate}
          placeholder="10/14, Oct 14, Fri"
          placeholderTextColor={color.meta}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          editable={!busy}
          accessibilityLabel={`Due date: ${text}`}
          style={{
            flex: 1,
            minHeight: TOUCH_TARGET - 8,
            backgroundColor: color.notepaper,
            borderColor: color.borderStrong,
            borderWidth: 1,
            borderRadius: radius.button,
            paddingHorizontal: space.md,
            fontFamily: font.sans,
            fontSize: 15,
            color: color.midnight,
          }}
        />
      </View>
      {error ? <Text style={[type.small, { color: color.bad }]}>{error}</Text> : null}
    </View>
  );
}
