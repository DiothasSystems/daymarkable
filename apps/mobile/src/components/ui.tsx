/**
 * The small pieces every screen is made of, so the brand lives in one file rather than in every
 * `style={{}}` in the app.
 */
import { ActivityIndicator, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { TOUCH_TARGET, card, color, font, radius, space, type } from "@/theme";

/**
 * The way back from a screen that was pushed onto another.
 *
 * Every screen in this app draws its own chrome — the stack runs with `headerShown: false`, so
 * there is no platform back arrow to inherit. Android's gesture and hardware back still work, and
 * so does the iOS edge swipe, but a screen that shows no way out reads as a dead end however many
 * invisible ones it has. The editor in particular is reached by tapping a list row, which is the
 * exact place a person expects an arrow to be waiting.
 *
 * Fixed above the scroll rather than scrolled with it: leaving is not something to have to scroll
 * back up for.
 */
export function BackBar({ title, onBack, right }: { title: string; onBack(): void; right?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: space.sm,
        paddingBottom: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: color.border,
      }}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
      >
        <Text style={{ fontSize: 26, color: color.midnight, lineHeight: 30 }}>‹</Text>
      </Pressable>
      <Text style={[type.heading, { flex: 1 }]} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Uppercase mono section label — SYNCED 07:12, OPEN ACTIONS, INBOX. */
export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[type.label, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[card, style]}>{children}</View>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <Text style={[type.bodyMuted, { padding: space.lg, textAlign: "center" }]}>{children}</Text>;
}

export function Loading() {
  return (
    <View style={{ padding: space.xxl, alignItems: "center" }}>
      <ActivityIndicator color={color.midnight} />
    </View>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <Text style={[type.small, { color: color.bad, paddingHorizontal: space.lg, paddingVertical: space.sm }]}>{children}</Text>;
}

/**
 * A 44pt checkbox. The tablet templates' 28px minimum is a rule about a stylus; a thumb needs
 * more, and this is the control the whole app exists for (SW-006).
 */
export function Checkbox({ checked, onPress, label, busy }: { checked: boolean; onPress(): void; label: string; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!busy }}
      accessibilityLabel={label}
      hitSlop={6}
      style={{ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: checked ? color.gold : color.borderStrong,
          backgroundColor: checked ? color.gold : "transparent",
          alignItems: "center",
          justifyContent: "center",
          opacity: busy ? 0.5 : 1,
        }}
      >
        {checked ? <Text style={{ color: color.parchment, fontSize: 14, lineHeight: 16, fontFamily: font.sansBold }}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

/** The due chip: TODAY / TOMORROW / THIS WEEK / OVERDUE, gold when it is close. */
export function DueChip({ label, soon }: { label: string; soon: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: 3,
        backgroundColor: soon ? color.sunrise : "transparent",
        borderWidth: soon ? 0 : 1,
        borderColor: color.border,
      }}
    >
      <Text style={[type.label, { color: soon ? color.midnight : color.meta }]}>{label}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  busy,
  style,
}: {
  title: string;
  onPress(): void;
  variant?: "primary" | "secondary" | "tertiary";
  busy?: boolean;
  style?: ViewStyle;
}) {
  const base: ViewStyle = {
    minHeight: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.button,
    paddingHorizontal: space.lg,
  };
  const skin: ViewStyle =
    variant === "primary"
      ? { backgroundColor: color.midnight }
      : variant === "secondary"
        ? { borderWidth: 1.5, borderColor: color.midnight }
        : {};
  const textColor = variant === "primary" ? color.parchment : variant === "secondary" ? color.midnight : color.goldText;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [base, skin, { opacity: busy ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      <Text
        style={{
          fontFamily: font.sansBold,
          fontSize: 15,
          color: textColor,
          textDecorationLine: variant === "tertiary" ? "underline" : "none",
        }}
      >
        {busy ? "Working…" : title}
      </Text>
    </Pressable>
  );
}
