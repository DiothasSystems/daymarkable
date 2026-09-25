/**
 * What ScriptumIQ is, for someone holding the phone and not yet convinced.
 *
 * The content is the marketing site's own — `apps/web/src/app/(marketing)/product/page.tsx` — cut
 * down to what fits a phone screen. It is a COPY, and deliberately so: the alternative is a
 * WebView of /product, which would mean a marketing page with its own header, footer and links to
 * every other page, inside a frame that looks like the app. A tour has one job and then gets out
 * of the way.
 *
 * Rule 14 shapes this more than anything else. There is no price here and there must never be one:
 * not a figure, not a plan comparison, not "from $X". The trial's LENGTH is not a price and is
 * fine to say. What it costs is the web's to tell, on the page where the plan is chosen, and the
 * last slide's button is how someone gets there.
 *
 * Where that button goes depends on who is holding the phone, because the two cases are not the
 * same transaction:
 *
 *   Signed in — they have an account and may simply not have checked out yet. `/subscription` and
 *   `/billing` both want a session, and the app has one, so the WebView opens the web's own page
 *   already signed in (app/web/[pane].tsx). That is the "mobile html purchase flow": one checkout,
 *   on the web, reached without typing a password again.
 *
 *   Signed out — there is nothing to hand a session to, and registration is closed anyway
 *   (rule 15). An invitation is the whole of what opens it, so the honest button asks for one, on
 *   the public site, in the phone's own browser rather than in a frame pretending to be the app.
 */
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Dimensions, Linking, Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_URL } from "@/api";
import { BackBar, Button } from "@/components/ui";
import { useSession } from "@/session";
import { TOUCH_TARGET, color, font, space, type } from "@/theme";

/**
 * The public site, derived from the service host rather than configured separately.
 *
 * The app is built against `app.scriptumiq.com`; the marketing site is the same domain without
 * that label. Deriving it means one environment variable still decides everything, so a build
 * pointed at a laptop does not send someone to the live site to sign up. The fallback only matters
 * for a host that is not shaped that way, which is the dev case.
 */
function siteUrl(): string {
  try {
    const u = new URL(API_URL);
    if (u.hostname.startsWith("app.")) {
      u.hostname = u.hostname.slice(4);
      return u.origin;
    }
  } catch {
    // Not a URL we can reason about — fall through.
  }
  return "https://scriptumiq.com";
}

interface Slide {
  kicker: string;
  title: string;
  body: string;
  /** Short, concrete lines. A phone slide holds about four before it stops being read. */
  points?: readonly string[];
}

const SLIDES: readonly Slide[] = [
  {
    kicker: "WHAT IT IS",
    title: "Notes in. Executive function out.",
    body:
      "You already write things down. ScriptumIQ reads what you wrote today and hands you tomorrow — organised, typeset, and back on the same tablet you wrote it on. No app to open, no keyboard, no sync button.",
  },
  {
    kicker: "WHILE YOU SLEEP",
    title: "A minute after midnight, in your timezone.",
    body:
      "Only the pages you changed that day are read. Claude vision turns each one into structured items — tasks, meetings with dates and times, people, projects, notes — each with a confidence score.",
    points: [
      "Tell it which of your own marks mean action, follow-up or priority",
      "An asterisk, an underline, a circle, a margin star — the ones you actually use",
      "Anything it is unsure of goes to an Inbox to confirm, never silently onto your list",
    ],
  },
  {
    kicker: "WHAT ARRIVES",
    title: "Three notebooks, waiting in the morning.",
    body: "Written back to your reMarkable overnight, typeset, with room to keep writing on every page.",
    points: [
      "A planner at every horizon — day, week, month, quarter, year",
      "One living Action List, append-only, ordered by date then priority",
      "Meeting Notes, plus one email per meeting to your own address",
      "Your Outlook or Google calendar laid over the planner pages",
    ],
  },
  {
    kicker: "THE POINT",
    title: "Tick it on paper. It knows.",
    body:
      "Every page it prints is also a form. Ticks, crossings-out and margin notes on last night's pages are read the next night — completed tasks roll off, new notes roll in. That loop is the whole product.",
  },
  {
    kicker: "AND ON THE PHONE",
    title: "The same list, when the tablet is at home.",
    body:
      "This app carries the action list and the calendar so you can tick something off in a corridor, fix a misread word, or add what you just agreed to. Edit here and the notebooks are rebuilt and sent back to the tablet.",
  },
  {
    kicker: "WHAT IT NEVER DOES",
    title: "Some promises belong in the code.",
    body: "These are enforced where it matters, not written in a policy page.",
    points: [
      "Never keeps your page images beyond 24 hours",
      "Never emails an address it read on one of your pages",
      "Never sends a calendar invite you did not confirm",
      "Never logs what your notes say — counts and hashes only",
    ],
  },
];

export default function Tour() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const width = Dimensions.get("window").width;
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setPage((p) => (p === next ? p : next));
    },
    [width],
  );

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
      scroller.current?.scrollTo({ x: clamped * width, animated: true });
      setPage(clamped);
    },
    [width],
  );

  /** The one thing this screen is for. See the header comment for why it forks on the session. */
  const start = useCallback(() => {
    if (session) {
      router.push({ pathname: "/web/[pane]", params: { pane: "billing" } });
      return;
    }
    void Linking.openURL(`${siteUrl()}/start`);
  }, [session, router]);

  const last = page === SLIDES.length - 1;

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
        {SLIDES.map((s) => (
          <ScrollView key={s.title} style={{ width }} contentContainerStyle={{ padding: space.xl, paddingBottom: space.xl }}>
            <Text style={[type.label, { marginBottom: space.sm }]}>{s.kicker}</Text>
            <Text style={[type.title, { marginBottom: space.md }]}>{s.title}</Text>
            <Text style={[type.body, { marginBottom: s.points ? space.lg : 0 }]}>{s.body}</Text>
            {s.points?.map((p) => (
              <View key={p} style={{ flexDirection: "row", marginBottom: space.sm }}>
                <Text style={{ color: color.goldText, fontFamily: font.sansBold, fontSize: 15, marginRight: space.sm }}>→</Text>
                <Text style={[type.bodyMuted, { flex: 1 }]}>{p}</Text>
              </View>
            ))}
          </ScrollView>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: space.xl, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: space.sm }} accessibilityRole="tablist">
          {SLIDES.map((s, i) => (
            <Pressable
              key={s.title}
              onPress={() => goTo(i)}
              accessibilityRole="tab"
              accessibilityLabel={`Step ${i + 1} of ${SLIDES.length}: ${s.title}`}
              accessibilityState={{ selected: i === page }}
              hitSlop={10}
              style={{ height: TOUCH_TARGET / 2, justifyContent: "center" }}
            >
              <View
                style={{
                  width: i === page ? 20 : 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: i === page ? color.gold : color.borderStrong,
                }}
              />
            </Pressable>
          ))}
        </View>

        {last ? (
          <>
            {/* No price, ever, on this side of the wire (rule 14). What it costs is on the page the
                button opens, which is the web's and stays the web's. */}
            <Button title={session ? "Start your free trial" : "Ask for an invitation"} onPress={start} />
            <Text style={[type.small, { textAlign: "center" }]}>
              {session
                ? "Opens your account on the web, where plans and payment live."
                : "ScriptumIQ is invitation-only while it is new. This opens the site in your browser."}
            </Text>
          </>
        ) : (
          <Button title="Next" onPress={() => goTo(page + 1)} />
        )}
      </View>
    </View>
  );
}
