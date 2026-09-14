/**
 * The web's own pages, inside the app: first-time setup, settings, support, billing.
 *
 * Not laziness — the alternative is a second copy of every one of those forms, drifting from the
 * first. And there is a better reason than that: `requireUser` on the server already sequences
 * signed in → paid for → onboarded. Load /setup here and an account that has not checked out is
 * redirected to /billing by the server, with the app none the wiser. SW-008 and SW-009 are
 * satisfied by the same WebView, and the app never learns what anything costs, which is exactly
 * what rule 14 asks of it.
 *
 * Getting signed in: the app carries a bearer and these pages read a cookie, so it asks the
 * server for a one-time ticket and loads that (apps/web/src/server/handoff.ts). The ticket is
 * minted per visit — it is spent on arrival, so there is nothing durable in the URL bar.
 *
 * Staying inside: navigation is held to the two dayMarkable hosts. A page here can link out —
 * Stripe, the reMarkable site during pairing — and those open in the phone's browser rather than
 * in a frame that looks like the app but is not.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { API_URL, errorMessage, trpc } from "@/api";
import { Button, ErrorNote } from "@/components/ui";
import { TOUCH_TARGET, color, font, space, type } from "@/theme";

type Pane = "setup" | "settings" | "support" | "billing";

const TITLES: Record<Pane, string> = {
  setup: "Set up",
  settings: "Settings",
  support: "Support",
  billing: "Subscription",
};

/** The hosts this frame will follow. Anything else is the wider web and belongs in a browser. */
function ours(url: string): boolean {
  try {
    const host = new URL(url).host;
    return host === new URL(API_URL).host || host.endsWith(".daymarkable.com") || host === "daymarkable.com";
  } catch {
    return false;
  }
}

export default function WebPane() {
  const { pane } = useLocalSearchParams<{ pane: Pane }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const open = useCallback(async () => {
    setError(null);
    try {
      const r = await trpc.auth.webHandoff.mutate({ pane });
      setUrl(r.url);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [pane]);

  useEffect(() => {
    void open();
  }, [open]);

  /** Follow dayMarkable, hand everything else to the phone's browser. */
  const shouldLoad = useCallback((nav: WebViewNavigation) => {
    if (nav.url.startsWith("about:") || ours(nav.url)) return true;
    void Linking.openURL(nav.url);
    return false;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: color.parchment, paddingTop: insets.top }}>
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
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
        >
          <Text style={{ fontSize: 26, color: color.midnight, lineHeight: 30 }}>‹</Text>
        </Pressable>
        <Text style={[type.heading, { flex: 1 }]}>{TITLES[pane] ?? "dayMarkable"}</Text>
        {loading && url ? <ActivityIndicator color={color.gold} style={{ marginRight: space.md }} /> : null}
      </View>

      {error ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <ErrorNote>{error}</ErrorNote>
          <Button title="Try again" variant="secondary" onPress={() => void open()} />
        </View>
      ) : null}

      {url ? (
        <WebView
          source={{ uri: url }}
          onNavigationStateChange={(nav) => setLoading(nav.loading)}
          onShouldStartLoadWithRequest={shouldLoad}
          // The pages are the web app's own and are already responsive; nothing here should be
          // scaled or reflowed on top of that (UX-002).
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          originWhitelist={["https://*", "http://localhost*", "http://192.168.*"]}
          style={{ flex: 1, backgroundColor: color.parchment }}
          onError={() => setError("That page would not load. Check your connection.")}
        />
      ) : !error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={color.midnight} />
          <Text style={[type.small, { marginTop: space.sm, fontFamily: font.sans }]}>Opening…</Text>
        </View>
      ) : null}
    </View>
  );
}
