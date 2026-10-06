/**
 * The tour's last page, after the storyboard: what ScriptumIQ never does.
 *
 * The web's storyboard ends on the morning after; the app's tour had this page before it became the
 * storyboard, and the founder wanted it kept as the closer — the scenes show what it does, this says
 * what it will not. It is a dark BLOCK on the Parchment page, never a dark page: the back arrow and
 * the Midnight button below must stay on the ground their colours were chosen for.
 */
import { Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { color, font, radius, space, type } from "@/theme";
import { Stroke } from "./motion";

export const PROMISES = {
  kicker: "WHAT IT NEVER DOES",
  title: "Some promises belong in the code.",
  body: "These are enforced where it matters, not written in a policy page.",
  points: [
    "Never keeps your page images beyond 24 hours",
    "Never emails an address it read on one of your pages",
    "Never sends a calendar invite you did not confirm",
    "Never logs what your notes say — counts and hashes only",
  ],
} as const;

const AW = 320;
const AH = 150;

/** A shield, and a tick drawn into it. Wrap in Motion.Provider for the tick to be written. */
export function PromisesPage({ width }: { width: number }) {
  const artW = width - space.lg * 2;
  return (
    <View style={{ borderRadius: radius.card, padding: space.lg, backgroundColor: color.midnight }}>
      <View style={{ alignItems: "center", marginBottom: space.lg }} accessible accessibilityRole="image" accessibilityLabel="A shield with a tick">
        <Svg viewBox={`0 0 ${AW} ${AH}`} width={artW} height={(artW * AH) / AW}>
          <Path
            d="M 160 14 L 216 36 L 216 78 C 216 110 190 128 160 138 C 130 128 104 110 104 78 L 104 36 Z"
            fill="rgba(247,240,227,0.06)"
            stroke={color.gold}
            strokeWidth={2.5}
          />
          <Stroke d="M 137 76 L 154 93 L 187 57" length={78} delay={0.4} color={color.gold} width={5} join="round" />
        </Svg>
      </View>

      <Text style={[type.label, { marginBottom: space.sm, color: color.gold }]}>{PROMISES.kicker}</Text>
      <Text style={[type.title, { marginBottom: space.md, color: color.parchment }]}>{PROMISES.title}</Text>
      <Text style={[type.body, { marginBottom: space.lg, color: color.parchment }]}>{PROMISES.body}</Text>
      {PROMISES.points.map((p) => (
        <View key={p} style={{ flexDirection: "row", marginBottom: space.sm }}>
          <Text style={{ color: color.gold, fontFamily: font.sansBold, fontSize: 15, marginRight: space.sm }}>→</Text>
          <Text style={[type.bodyMuted, { flex: 1, color: "rgba(247,240,227,0.82)" }]}>{p}</Text>
        </View>
      ))}
    </View>
  );
}
