/**
 * The small pieces every screen is made of, so the brand lives in one file rather than in every
 * `style={{}}` in the app.
 */
import { ActivityIndicator, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { TOUCH_TARGET, card, color, font, radius, space, type } from "@/theme";

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
