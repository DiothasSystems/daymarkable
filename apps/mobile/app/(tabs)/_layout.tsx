/**
 * Actions first, because that is where the app opens and what it is for. Calendar beside it.
 * Notes reads what was decoded; More holds the night's documents, Sync now, feedback, and the
 * way out.
 *
 * Settings and billing are not tabs and will not be: they are the web's own pages, reached in a
 * WebView in step 7, so the app never carries a second copy of a form — or, in billing's case,
 * a price (rule 14).
 */
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { color, font } from "@/theme";

/** Text glyphs rather than an icon pack: four tabs do not justify another dependency. */
function TabGlyph({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 18, color: focused ? color.goldText : color.meta }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.goldText,
        tabBarInactiveTintColor: color.meta,
        tabBarStyle: { backgroundColor: color.notepaper, borderTopColor: color.border },
        tabBarLabelStyle: { fontFamily: font.sansMedium, fontSize: 12 },
        sceneStyle: { backgroundColor: color.parchment },
      }}
    >
      <Tabs.Screen
        name="actions"
        options={{ title: "Actions", tabBarIcon: ({ focused }) => <TabGlyph glyph="☑" focused={focused} /> }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: "Calendar", tabBarIcon: ({ focused }) => <TabGlyph glyph="▤" focused={focused} /> }}
      />
      <Tabs.Screen
        name="notes"
        options={{ title: "Notes", tabBarIcon: ({ focused }) => <TabGlyph glyph="✎" focused={focused} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: "More", tabBarIcon: ({ focused }) => <TabGlyph glyph="⋯" focused={focused} /> }}
      />
    </Tabs>
  );
}
