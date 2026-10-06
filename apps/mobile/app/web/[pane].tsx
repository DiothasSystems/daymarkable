/**
 * The web's own pages, inside the app: first-time setup, settings and support. NOT billing: that is
 * always the phone's browser, on Android and iOS alike (src/webRouting.ts, rule 14).
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
 * Staying inside: navigation is held to our own hosts. A page here can link out —
 * Stripe, the reMarkable site during pairing — and those open in the phone's browser rather than
 * in a frame that looks like the app but is not.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { errorMessage, trpc } from "@/api";
import { BackBar, Button, ErrorNote } from "@/components/ui";
import { useKeyboardHeight } from "@/keyboard";
import { color, font, space, type } from "@/theme";
import { billingUrl, destinationFor } from "@/webRouting";

/** "billing" survives only so an older link to it lands somewhere sensible: the browser. */
type Pane = "setup" | "settings" | "support" | "billing";

const TITLES: Record<Pane, string> = {
  setup: "Set up",
  settings: "Settings",
  support: "Support",
  billing: "Subscription",
};

export default function WebPane() {
  const { pane } = useLocalSearchParams<{ pane: Pane }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Set when a billing page was handed to the browser instead of shown here. */
  const [toBrowser, setToBrowser] = useState(false);

  const open = useCallback(async () => {
    setError(null);
    if (pane === "billing") {
      // Never in the app: the subscription page opens in the phone's browser.
      setToBrowser(true);
      void Linking.openURL(billingUrl());
      return;
    }
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

  /**
   * Follow our own pages; hand billing and the wider web to the phone's browser. A billing page is
   * caught here however it was reached — a link, or /setup redirecting an account that has not paid.
   */
  const shouldLoad = useCallback((nav: WebViewNavigation) => {
    const where = destinationFor(nav.url);
    if (where === "frame") return true;
    if (where === "billing") {
      setToBrowser(true);
      void Linking.openURL(billingUrl());
      return false;
    }
    void Linking.openURL(nav.url);
    return false;
  }, []);

  // The page cannot be scrolled from out here, so the frame shrinks to the space above the keyboard
  // instead and the page scrolls its own field into view, as a browser does (src/keyboard.tsx).
  const keyboard = useKeyboardHeight();

  return (
    <View style={{ flex: 1, backgroundColor: color.parchment, paddingTop: insets.top, paddingBottom: keyboard }}>
      <BackBar
        title={TITLES[pane] ?? "ScriptumIQ"}
        onBack={() => router.back()}
        right={loading && url ? <ActivityIndicator color={color.gold} style={{ marginRight: space.md }} /> : null}
      />

      {error ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <ErrorNote>{error}</ErrorNote>
          <Button title="Try again" variant="secondary" onPress={() => void open()} />
        </View>
      ) : null}

      {toBrowser ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Text style={type.heading}>Your subscription is on the website</Text>
          <Text style={type.bodyMuted}>
            Plans, payment and cancelling are all managed at scriptumiq.com. We have opened it in your browser — sign in
            there if it asks.
          </Text>
          <Button title="Open it again" variant="secondary" onPress={() => void Linking.openURL(billingUrl())} />
          <Button title="Back" variant="tertiary" onPress={() => router.back()} />
        </View>
      ) : null}

      {url && !toBrowser ? (
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
      ) : !error && !toBrowser ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={color.midnight} />
          <Text style={[type.small, { marginTop: space.sm, fontFamily: font.sans }]}>Opening…</Text>
        </View>
      ) : null}
    </View>
  );
}
