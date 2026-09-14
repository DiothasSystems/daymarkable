/**
 * Form controls for the editors.
 *
 * Dates and times go through the platform picker rather than a text field: the server wants
 * `YYYY-MM-DD` and `HH:MM`, and asking someone to type that on a phone is how you get a form
 * people avoid. Everything here hands back exactly those two shapes, or null for "not set" —
 * which is a real state throughout the schema, not an empty string.
 */
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { dayTitle, parseIso } from "@/format";
import { TOUCH_TARGET, color, font, radius, space, type } from "@/theme";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.label, { marginBottom: space.xs }]}>{label}</Text>
      {children}
      {hint ? <Text style={[type.small, { marginTop: space.xs }]}>{hint}</Text> : null}
    </View>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  multiline,
  minHeight,
  label,
}: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  multiline?: boolean;
  minHeight?: number;
  label: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={color.meta}
      multiline={multiline}
      accessibilityLabel={label}
      style={{
        minHeight: minHeight ?? TOUCH_TARGET,
        backgroundColor: color.notepaper,
        borderColor: color.borderStrong,
        borderWidth: 1,
        borderRadius: radius.button,
        paddingHorizontal: space.md,
        paddingTop: multiline ? space.sm : 0,
        paddingBottom: multiline ? space.sm : 0,
        fontFamily: font.sans,
        fontSize: 16,
        color: color.midnight,
        textAlignVertical: multiline ? "top" : "center",
      }}
    />
  );
}

/** A row of mutually exclusive chips — priority, kind, recurrence. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }} accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={({ pressed }) => ({
              minHeight: 36,
              paddingHorizontal: space.md,
              justifyContent: "center",
              borderRadius: radius.button,
              borderWidth: on ? 0 : 1,
              borderColor: color.border,
              backgroundColor: on ? color.midnight : color.notepaper,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontFamily: on ? font.sansBold : font.sans, fontSize: 14, color: on ? color.parchment : color.bodyMuted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** `YYYY-MM-DD`, or null. */
export function DateField({ value, onChange, label }: { value: string | null; onChange(v: string | null): void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? dayTitle(value) : "not set"}`}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: TOUCH_TARGET,
          justifyContent: "center",
          paddingHorizontal: space.md,
          borderRadius: radius.button,
          borderWidth: 1,
          borderColor: color.borderStrong,
          backgroundColor: color.notepaper,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontFamily: font.sans, fontSize: 16, color: value ? color.midnight : color.meta }}>
          {value ? dayTitle(value) : "Not set"}
        </Text>
      </Pressable>
      {value ? <Clear onPress={() => onChange(null)} label={`Clear ${label}`} /> : null}
      {open ? (
        <DateTimePicker
          mode="date"
          // The stored value is a plain date; parse it as UTC so the picker opens on the day the
          // string says rather than the day it becomes west of Greenwich.
          value={value ? parseIso(value) : new Date()}
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(event, picked) => {
            setOpen(false);
            if (event.type === "dismissed" || !picked) return;
            // The picker answers in local time; the date the user tapped is its local Y-M-D.
            const iso = `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, "0")}-${String(picked.getDate()).padStart(2, "0")}`;
            onChange(iso);
          }}
        />
      ) : null}
    </View>
  );
}

/** `HH:MM`, or null. */
export function TimeField({ value, onChange, label }: { value: string | null; onChange(v: string | null): void; label: string }) {
  const [open, setOpen] = useState(false);
  const asDate = () => {
    const d = new Date();
    const [h, m] = (value ?? "09:00").split(":");
    d.setHours(Number(h), Number(m), 0, 0);
    return d;
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? "not set"}`}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: TOUCH_TARGET,
          justifyContent: "center",
          paddingHorizontal: space.md,
          borderRadius: radius.button,
          borderWidth: 1,
          borderColor: color.borderStrong,
          backgroundColor: color.notepaper,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontFamily: value ? font.mono : font.sans, fontSize: 16, color: value ? color.midnight : color.meta }}>{value ?? "Not set"}</Text>
      </Pressable>
      {value ? <Clear onPress={() => onChange(null)} label={`Clear ${label}`} /> : null}
      {open ? (
        <DateTimePicker
          mode="time"
          value={asDate()}
          is24Hour
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(event, picked) => {
            setOpen(false);
            if (event.type === "dismissed" || !picked) return;
            onChange(`${String(picked.getHours()).padStart(2, "0")}:${String(picked.getMinutes()).padStart(2, "0")}`);
          }}
        />
      ) : null}
    </View>
  );
}

function Clear({ onPress, label }: { onPress(): void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
    >
      <Text style={{ fontSize: 16, color: color.meta }}>✕</Text>
    </Pressable>
  );
}
