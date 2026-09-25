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
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_URL } from "@/api";
import { BackBar, Button } from "@/components/ui";
import { useSession } from "@/session";
import { TOUCH_TARGET, color, font, radius, space, type } from "@/theme";

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

/* --------------------------------------------------------------------------------------------
 * The drawings.
 *
 * Brand parts only — Midnight line, Gold accent, Notepaper fill — and each one says the slide's
 * own sentence rather than decorating it: a page becoming a page, a night sky, a stack of
 * notebooks, a loop, a phone, a shut door. Drawn as vectors rather than shipped as images so they
 * cost nothing to bundle and stay sharp at any width, and so they can invert for the dark slide
 * instead of needing a second copy.
 * ------------------------------------------------------------------------------------------ */

const ART_H = 150;
/** Everything is drawn in this box and scaled to the slide's width. */
const AW = 320;

function Frame({ w, children }: { w: number; children: React.ReactNode }) {
  return (
    <Svg viewBox={`0 0 ${AW} ${ART_H}`} width={w} height={(w * ART_H) / AW}>
      {children}
    </Svg>
  );
}

const ink = (dark: boolean) => (dark ? color.parchment : color.midnight);
const panel = (dark: boolean) => (dark ? "rgba(247,240,227,0.06)" : color.notepaper);

/** A page of handwriting becoming a typeset one. */
function ArtConvert({ w, dark }: { w: number; dark: boolean }) {
  return (
    <Frame w={w}>
      <Rect x={26} y={20} width={90} height={112} rx={5} fill={panel(dark)} stroke={ink(dark)} strokeWidth={2} />
      {[42, 60, 78, 96].map((y, i) => (
        <Path
          key={y}
          d={`M 40 ${y} C 55 ${y - 7} 66 ${y + 7} 82 ${y} C 94 ${y - 5} 100 ${y + 4} 104 ${y - 1}`}
          fill="none"
          stroke={ink(dark)}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.75 - i * 0.05}
        />
      ))}
      <Path d="M 132 76 L 182 76 M 168 62 L 182 76 L 168 90" fill="none" stroke={color.gold} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={200} y={20} width={94} height={112} rx={5} fill={panel(dark)} stroke={ink(dark)} strokeWidth={2} />
      {[44, 66, 88, 110].map((y) => (
        <G key={y}>
          <Rect x={212} y={y - 8} width={11} height={11} rx={2} fill="none" stroke={ink(dark)} strokeWidth={1.8} />
          <Line x1={230} y1={y - 2} x2={282} y2={y - 2} stroke={ink(dark)} strokeWidth={2.4} strokeLinecap="round" opacity={0.8} />
        </G>
      ))}
    </Frame>
  );
}

/** Night, and a page being read under it. */
function ArtNight({ w }: { w: number; dark: boolean }) {
  return (
    <Frame w={w}>
      <Rect x={0} y={0} width={AW} height={ART_H} rx={10} fill={color.midnight} />
      <Path d="M 66 34 A 22 22 0 1 0 90 62 A 17 17 0 1 1 66 34 Z" fill={color.sunrise} />
      {[[44, 96], [96, 40], [124, 104], [156, 56], [190, 112]].map(([cx, cy], i) => (
        <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={i % 2 ? 2 : 3} fill={color.parchment} opacity={0.7} />
      ))}
      <Rect x={206} y={34} width={90} height={92} rx={5} fill={color.notepaper} stroke={color.gold} strokeWidth={2} />
      {[56, 76, 96].map((y) => (
        <Line key={y} x1={220} y1={y} x2={282} y2={y} stroke={color.midnight} strokeWidth={2.2} strokeLinecap="round" opacity={0.7} />
      ))}
      <Circle cx={251} cy={112} r={7} fill={color.gold} />
    </Frame>
  );
}

/** Three notebooks, waiting in the morning. */
function ArtNotebooks({ w, dark }: { w: number; dark: boolean }) {
  const spines = [color.gold, color.midnight, color.sunrise];
  return (
    <Frame w={w}>
      {[0, 1, 2].map((i) => (
        <G key={spines[i]} transform={`translate(${26 + i * 92} ${14 + i * 6})`}>
          <Rect width={80} height={116} rx={5} fill={panel(dark)} stroke={ink(dark)} strokeWidth={2} />
          <Rect x={0} y={0} width={7} height={116} rx={3} fill={spines[i]} opacity={dark && i === 1 ? 0.45 : 1} />
          {[26, 46, 66, 86, 106].map((y) => (
            <Line key={y} x1={18} y1={y} x2={66} y2={y} stroke={ink(dark)} strokeWidth={2} strokeLinecap="round" opacity={0.55} />
          ))}
        </G>
      ))}
    </Frame>
  );
}

/** Write, read, print, write again. */
function ArtLoop({ w, dark }: { w: number; dark: boolean }) {
  return (
    <Frame w={w}>
      <Path d="M 160 24 A 52 52 0 1 1 108 76" fill="none" stroke={color.gold} strokeWidth={5} strokeLinecap="round" />
      <Path d="M 146 12 L 160 24 L 146 36" fill="none" stroke={color.gold} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={130} y={52} width={60} height={48} rx={4} fill={panel(dark)} stroke={ink(dark)} strokeWidth={2} />
      <Path d="M 145 76 L 156 87 L 177 62" fill="none" stroke={color.gold} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** The same list, in a pocket. */
function ArtPhone({ w, dark }: { w: number; dark: boolean }) {
  return (
    <Frame w={w}>
      <Rect x={122} y={10} width={76} height={130} rx={12} fill={panel(dark)} stroke={ink(dark)} strokeWidth={2.5} />
      <Line x1={148} y1={22} x2={172} y2={22} stroke={ink(dark)} strokeWidth={2.5} strokeLinecap="round" opacity={0.45} />
      {[48, 72, 96, 120].map((y, i) => (
        <G key={y}>
          <Rect x={134} y={y - 8} width={12} height={12} rx={2.5} fill={i < 2 ? color.gold : "none"} stroke={i < 2 ? color.gold : ink(dark)} strokeWidth={2} />
          {i < 2 ? (
            <Path d={`M 137 ${y - 2} L 140 ${y + 1} L 144 ${y - 5}`} fill="none" stroke={color.notepaper} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
          <Line x1={154} y1={y - 2} x2={186} y2={y - 2} stroke={ink(dark)} strokeWidth={2.4} strokeLinecap="round" opacity={i < 2 ? 0.35 : 0.8} />
        </G>
      ))}
    </Frame>
  );
}

/** What never leaves. */
function ArtPromise({ w, dark }: { w: number; dark: boolean }) {
  return (
    <Frame w={w}>
      <Path
        d="M 160 14 L 216 36 L 216 78 C 216 110 190 128 160 138 C 130 128 104 110 104 78 L 104 36 Z"
        fill={panel(dark)}
        stroke={color.gold}
        strokeWidth={2.5}
      />
      <Path d="M 137 76 L 154 93 L 187 57" fill="none" stroke={color.gold} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

interface Slide {
  kicker: string;
  title: string;
  body: string;
  /** Short, concrete lines. A phone slide holds about four before it stops being read. */
  points?: readonly string[];
  /**
   * Which ground the slide sits on. The site alternates plain page, tinted band and a dark block
   * to break a long read into chapters; six phone slides need that more, not less, because there
   * is no scrollbar to show how far in you are.
   *
   * A dark slide is a dark BLOCK inside the page, never the page itself. Tinting the whole screen
   * put a Midnight button and a Midnight back arrow on a Midnight ground - both simply vanished.
   */
  tone: "page" | "paper" | "dark";
  art: (props: { w: number; dark: boolean }) => React.ReactNode;
}

const SLIDES: readonly Slide[] = [
  {
    kicker: "WHAT IT IS",
    title: "Notes in. Executive function out.",
    body:
      "You already write things down. ScriptumIQ reads what you wrote today and hands you tomorrow — organised, typeset, and back on the same tablet you wrote it on. No app to open, no keyboard, no sync button.",
    tone: "page",
    art: ArtConvert,
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
    tone: "paper",
    art: ArtNight,
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
    tone: "page",
    art: ArtNotebooks,
  },
  {
    kicker: "THE POINT",
    title: "Tick it on paper. It knows.",
    body:
      "Every page it prints is also a form. Ticks, crossings-out and margin notes on last night's pages are read the next night — completed tasks roll off, new notes roll in. That loop is the whole product.",
    tone: "paper",
    art: ArtLoop,
  },
  {
    kicker: "AND ON THE PHONE",
    title: "The same list, when the tablet is at home.",
    body:
      "This app carries the action list and the calendar so you can tick something off in a corridor, fix a misread word, or add what you just agreed to. Edit here and the notebooks are rebuilt and sent back to the tablet.",
    tone: "page",
    art: ArtPhone,
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
    tone: "dark",
    art: ArtPromise,
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
    // Parchment throughout: the chrome never inverts, so the back arrow and the button below are
    // always on the ground their colours were chosen for.
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
        {SLIDES.map((s) => {
          const isDark = s.tone === "dark";
          const artWidth = width - space.xl * 2;
          return (
            <ScrollView key={s.title} style={{ width }} contentContainerStyle={{ padding: space.xl }}>
              {/* The colour box, which on a dark slide wraps the whole block - art and words
                  together - the way the site's band does, rather than only the picture. */}
              <View
                style={{
                  borderRadius: radius.card,
                  padding: s.tone === "page" ? 0 : space.lg,
                  backgroundColor: isDark ? color.midnight : s.tone === "paper" ? color.notepaper : "transparent",
                  borderWidth: s.tone === "paper" ? 1 : 0,
                  borderColor: color.border,
                }}
              >
                <View style={{ alignItems: "center", marginBottom: space.lg }}>
                  {s.art({ w: artWidth - (s.tone === "page" ? 0 : space.lg * 2), dark: isDark })}
                </View>

                <Text style={[type.label, { marginBottom: space.sm, color: isDark ? color.gold : color.meta }]}>{s.kicker}</Text>
                <Text style={[type.title, { marginBottom: space.md, color: isDark ? color.parchment : color.midnight }]}>{s.title}</Text>
                <Text style={[type.body, { marginBottom: s.points ? space.lg : 0, color: isDark ? color.parchment : color.midnight }]}>{s.body}</Text>

                {s.points?.map((p) => (
                  <View key={p} style={{ flexDirection: "row", marginBottom: space.sm }}>
                    <Text style={{ color: isDark ? color.gold : color.goldText, fontFamily: font.sansBold, fontSize: 15, marginRight: space.sm }}>→</Text>
                    <Text style={[type.bodyMuted, { flex: 1, color: isDark ? "rgba(247,240,227,0.82)" : color.bodyMuted }]}>{p}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        })}
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
