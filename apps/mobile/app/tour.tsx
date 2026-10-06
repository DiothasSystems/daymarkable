/**
 * What ScriptumIQ is, for someone holding the phone and not yet convinced.
 *
 * It is the website's "See how it works" storyboard — a day with ScriptumIQ, from the invitation
 * to the morning after — one animated scene per swipe (src/storyboard/, a copy of the web's scenes;
 * keep the two in step). Drawn natively rather than a WebView of /how-it-works, which would bring
 * the marketing site's header, footer and links into a frame that looks like the app. A tour has
 * one job and then gets out of the way.
 *
 * Only the scene on screen moves: it is the one bound to the clock, which restarts when it lands so
 * every scene plays from its beginning. The others are drawn still, as is everything when the phone
 * asks for reduced motion.
 *
 * Rule 14 shapes this more than anything else. There is no price here and there must never be one:
 * not a figure, not a plan comparison, not "from $X". The trial's LENGTH is not a price and is
 * fine to say. What it costs is the web's to tell, on the page where the plan is chosen, and the
 * last slide's button is how someone gets there.
 *
 * Where that button goes depends on who is holding the phone, because the two cases are not the
 * same transaction:
 *
 *   Signed in — they have an account and may simply not have checked out yet. Checkout is the
 *   website's, in the phone's browser, never a frame inside the app (src/webRouting.ts, rule 14):
 *   the browser may ask them to sign in, which is the price of keeping money out of the app.
 *
 *   Signed out — there is nothing to hand a session to, and registration is closed anyway
 *   (rule 15). An invitation is the whole of what opens it, so the honest button asks for one, on
 *   the public site, in the phone's own browser rather than in a frame pretending to be the app.
 */
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Dimensions, Easing, Linking, Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Svg from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { siteUrl } from "@/api";
import { BackBar, Button } from "@/components/ui";
import { useSession } from "@/session";
import { LOOP_MS, Motion } from "@/storyboard/motion";
import { FRAME_H, FRAME_W, C } from "@/storyboard/parts";
import { PHASES, SCENES } from "@/storyboard/scenes";
import { TOUCH_TARGET, color, radius, space, type } from "@/theme";
import { billingUrl } from "@/webRouting";

export default function Tour() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const width = Dimensions.get("window").width;
  const [page, setPage] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const clock = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduceMotion(on));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => live && setReduceMotion(on));
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  // One loop for the visible scene, started afresh each time a scene lands. JS driver: see motion.tsx.
  useEffect(() => {
    if (reduceMotion) return;
    clock.setValue(0);
    const loop = Animated.loop(Animated.timing(clock, { toValue: 1, duration: LOOP_MS, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [clock, page, reduceMotion]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setPage((p) => (p === next ? p : next));
    },
    [width],
  );

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(SCENES.length - 1, i));
      scroller.current?.scrollTo({ x: clamped * width, animated: true });
      setPage(clamped);
    },
    [width],
  );

  /** The one thing this screen is for. See the header comment for why it forks on the session. */
  const start = useCallback(() => {
    if (session) {
      // Checking out happens on the website, in the phone's browser — never in the app (rule 14).
      void Linking.openURL(billingUrl());
      return;
    }
    void Linking.openURL(`${siteUrl()}/start`);
  }, [session]);

  const last = page === SCENES.length - 1;
  const artWidth = width - space.xl * 2;

  return (
    <View style={{ flex: 1, backgroundColor: color.parchment, paddingTop: insets.top }}>
      <BackBar title="How it works" onBack={() => router.back()} />

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ flex: 1 }}
      >
        {SCENES.map((s, i) => {
          const phase = PHASES[s.phase];
          return (
            <ScrollView key={s.title} style={{ width }} contentContainerStyle={{ padding: space.xl, paddingTop: space.md }}>
              <Text style={[type.label, { color: color.goldText, marginBottom: space.sm }]}>
                {`${phase.title} · ${phase.when}`.toUpperCase()}
              </Text>

              {/* The frame, as the web's card draws it: Parchment ground, a hairline, a soft corner. */}
              <View
                style={{
                  borderRadius: radius.card,
                  borderWidth: 1,
                  borderColor: color.border,
                  backgroundColor: color.parchment,
                  overflow: "hidden",
                  marginBottom: space.lg,
                }}
                accessible
                accessibilityRole="image"
                accessibilityLabel={s.label}
              >
                <Motion.Provider value={i === page && !reduceMotion ? clock : null}>
                  <Svg viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} width={artWidth - 2} height={((artWidth - 2) * FRAME_H) / FRAME_W} style={{ backgroundColor: C.parch }}>
                    {s.art}
                  </Svg>
                </Motion.Provider>
              </View>

              <Text style={[type.label, { color: color.goldText, marginBottom: space.xs }]}>
                {`${String(i + 1).padStart(2, "0")} · ${s.time}`.toUpperCase()}
              </Text>
              <Text style={[type.title, { marginBottom: space.md }]}>{s.title}</Text>
              {s.lines.map((l) => (
                <Text key={l} style={[type.bodyMuted, { marginBottom: space.sm }]}>
                  {l}
                </Text>
              ))}
            </ScrollView>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: space.xl, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }} accessibilityRole="tablist">
          {SCENES.map((s, i) => (
            <Pressable
              key={s.title}
              onPress={() => goTo(i)}
              accessibilityRole="tab"
              accessibilityLabel={`Step ${i + 1} of ${SCENES.length}: ${s.title}`}
              accessibilityState={{ selected: i === page }}
              hitSlop={6}
              style={{ height: TOUCH_TARGET / 2, justifyContent: "center" }}
            >
              <View
                style={{
                  width: i === page ? 18 : 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: i === page ? color.gold : color.borderStrong,
                }}
              />
            </Pressable>
          ))}
        </View>

        {/* Register sits on EVERY scene, not only the last one. Someone convinced by scene two
            should not have to page through twelve more to act on it. Side by side with Next, so
            the buttons leave the picture and its words most of the screen. */}
        <View style={{ flexDirection: "row", gap: space.md }}>
          {last ? null : <Button title="Next" variant="secondary" onPress={() => goTo(page + 1)} style={{ flex: 1 }} />}
          {/* No price, ever, on this side of the wire (rule 14). What it costs is on the page the
              button opens, which is the web's and stays the web's. */}
          <Button title={session ? "Start your free trial" : "Register"} onPress={start} style={{ flex: last ? 1 : 1.4 }} />
        </View>
        <Text style={[type.small, { textAlign: "center" }]}>
          {session
            ? "Opens your account on the web, where plans and payment live."
            : "ScriptumIQ is invitation-only while it is new. This opens the site in your browser."}
        </Text>
      </View>
    </View>
  );
}
