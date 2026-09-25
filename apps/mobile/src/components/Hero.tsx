/**
 * The web's hero, on a phone: you write on the tablet, the emblem reads the page, and your pages
 * land on the pile. Four conversions to a 24-second loop, same as the site.
 *
 * It is a PORT of `apps/web/src/components/hero/HeroBuild.tsx`, not a WebView of it, and it keeps
 * that scene's viewBox and coordinates so the two cannot drift into different compositions. What
 * it drops is deliberate and all of one kind — detail that is under a millimetre once 1060 units
 * are squeezed into a phone's width:
 *
 *   - the five handwriting strokes animating on individually, and the pen that writes them. The
 *     strokes are still drawn, because a blank tablet reads as a broken image; they simply arrive
 *     with the page rather than being written stroke by stroke.
 *   - the mono captions under each act. At this scale they would be three grey smudges.
 *
 * What it keeps is the part that carries the meaning: the page leaving the tablet, the points
 * ticking a quarter turn as it is read, the core lighting, and four finished pages flying out.
 *
 * The emblem is two images because the web's is: a disc with the points erased, which never
 * moves, and the points alone, which turn. The ring is shaded from one side, so rotating the
 * whole emblem would light it from the wrong direction at three stops out of four.
 *
 * Reduced motion is honoured by rendering the settled frame and starting no loop at all, which on
 * a phone is also the battery-cheap path.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, Pressable, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { color, font } from "@/theme";

/** The scene, in viewBox units — the web's numbers, unchanged. */
const W = 1060;
const H = 535;
const CX = 530;
const CY = 195;
/** Radius of the emblem's navy ring: the unit the whole lockup is measured in. */
const R = 128;

/** From apps/web/src/components/hero/logo-geometry.ts, which is generated from the artwork. */
const LOGO = {
  emblem: { size: 2.2, dx: -1.1, dy: -1.1 },
  wordmark: { x: -1.7681, y: 1.0256, w: 3.5134, h: 0.8938 },
  tagline: { x: -1.4724, y: 1.9848, w: 2.9633, h: 0.0791 },
} as const;

const at = (dx: number, dy: number) => ({ x: CX + dx * R, y: CY + dy * R });
const EMBLEM = { ...at(LOGO.emblem.dx, LOGO.emblem.dy), size: LOGO.emblem.size * R };
const WORDMARK = { ...at(LOGO.wordmark.x, LOGO.wordmark.y), w: LOGO.wordmark.w * R, h: LOGO.wordmark.h * R };
const TAGLINE = { ...at(LOGO.tagline.x, LOGO.tagline.y), w: LOGO.tagline.w * R, h: LOGO.tagline.h * R };

const TABLET = { x: 40, y: 65, w: 200, h: 260 };
const PAGE = { x: 52, y: 80, w: 176, h: 230 };
const CARD = { w: 140, h: 180 };
/** Where each output page settles, and the tilt it settles at. */
const DOCS = [
  { x: 820, y: 120, r: -6, title: "Tomorrow" },
  { x: 832, y: 112, r: 4, title: "Actions" },
  { x: 824, y: 104, r: -3, title: "Notes" },
  { x: 838, y: 96, r: 6, title: "Calendar" },
] as const;

/** The handwriting, as the site draws it. Static here — see the header comment. */
const INK = [
  "M 22 70 C 40 60 52 78 72 68 C 90 60 104 76 124 67 C 140 60 152 70 168 66",
  "M 22 105 L 36 105 M 46 101 C 64 93 78 109 100 100 C 118 92 134 107 156 99 C 164 96 170 100 176 98",
  "M 22 140 C 42 130 56 148 78 138 C 96 130 110 146 130 137 C 144 132 152 138 162 135",
  "M 22 175 L 36 175 M 46 171 C 62 163 74 179 96 170 C 114 162 130 177 150 169",
  "M 22 210 C 36 202 46 216 62 208 C 78 200 92 214 110 206 M 128 208 C 142 200 154 214 172 206",
] as const;

const LOOP_MS = 24000;
const AnimatedG = Animated.createAnimatedComponent(G);

/** One conversion's worth of the loop, as a fraction of it. Four fit in a cycle. */
const BEAT = 0.25;

export function Hero({ onPress }: { onPress(): void }) {
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
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

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      // NOT the native driver. It animates on the UI thread by writing straight into a native
      // VIEW's props, and react-native-svg's G is not one - the page, the cards and the core glow
      // simply never moved, while the compass points (a real Image) turned, which is a confusing
      // way for this to fail. One linear value a frame on the JS thread is the cost.
      Animated.timing(clock, { toValue: 1, duration: LOOP_MS, easing: Easing.linear, useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [clock, reduceMotion]);

  /**
   * The page's flight, and the four that come back, are all phases of one clock rather than four
   * timers: a phone that backgrounds the app stops one thing, and everything restarts in step.
   */
  const anim = useMemo(() => {
    /** A ramp that runs 0 → 1 between `from` and `to` of the cycle and holds at each end. */
    const ramp = (from: number, to: number) =>
      clock.interpolate({ inputRange: [0, from, to, 1], outputRange: [0, 0, 1, 1], extrapolate: "clamp" });

    // The written page lifts off and is drawn into the emblem, once per beat.
    const pageTrip = clock.interpolate({
      inputRange: [0, BEAT * 0.45, BEAT * 0.9, 1],
      outputRange: [0, 0, 1, 1],
      extrapolate: "clamp",
    });

    return {
      pageX: pageTrip.interpolate({ inputRange: [0, 1], outputRange: [0, CX - (PAGE.x + PAGE.w / 2)] }),
      pageY: pageTrip.interpolate({ inputRange: [0, 1], outputRange: [0, CY - (PAGE.y + PAGE.h / 2)] }),
      pageScale: pageTrip.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0.35, 0.05] }),
      pageOpacity: pageTrip.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }),
      // A quarter turn per conversion, so the dial has made a full revolution by the end.
      spin: clock.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
      core: clock.interpolate({
        inputRange: [0, BEAT * 0.85, BEAT * 0.95, BEAT * 1.1, 1],
        outputRange: [0.25, 0.25, 1, 0.25, 0.25],
        extrapolate: "clamp",
      }),
      docs: DOCS.map((_, i) => ramp(BEAT * (i + 0.9), BEAT * (i + 1.25))),
    };
  }, [clock]);

  // The scene is 2:1, so the phone's width decides the height. Nothing is cropped.
  const height = (width * H) / W;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="How ScriptumIQ works — you write on your reMarkable, and overnight it hands back your planner, actions, notes and calendar. Opens the tour."
      style={({ pressed }) => ({ width, height, opacity: pressed ? 0.85 : 1 })}
    >
      <Svg viewBox={`0 0 ${W} ${H}`} width={width} height={height}>
        <Defs>
          <RadialGradient id="core" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color.gold} stopOpacity="0.55" />
            <Stop offset="55%" stopColor={color.gold} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={color.gold} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* DAYTIME — the tablet you write on */}
        <Rect x={TABLET.x} y={TABLET.y} width={TABLET.w} height={TABLET.h} rx={14} fill="#FBFBF9" stroke={color.midnight} strokeWidth={4} />
        <G transform={`translate(${TABLET.x} ${TABLET.y})`} fill="none" stroke="#1A1A1A" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          {INK.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>

        {/* the finished page, lifting off toward the emblem */}
        {/* Animated PROPS, not a style: react-native-svg maps its own x/y/scale/opacity onto the
            native view, and `origin` is what makes the page shrink into its own middle rather than
            toward the scene's corner. */}
        <AnimatedG
          opacity={anim.pageOpacity}
          translateX={anim.pageX}
          translateY={anim.pageY}
          scale={anim.pageScale}
          origin={`${PAGE.x + PAGE.w / 2},${PAGE.y + PAGE.h / 2}`}
        >
          <Rect x={PAGE.x} y={PAGE.y} width={PAGE.w} height={PAGE.h} rx={4} fill="#FBFBF9" stroke="#C9C4B6" strokeWidth={1} />
          <G transform={`translate(${TABLET.x} ${TABLET.y})`} fill="none" stroke="#1A1A1A" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            {INK.map((d) => (
              <Path key={d} d={d} />
            ))}
          </G>
        </AnimatedG>

        {/* MORNING — the pages it hands back, each flying out of the emblem's middle */}
        <Circle cx={890} cy={315} r={1} fill="none" />
        {DOCS.map((d, i) => (
          <AnimatedG
            key={d.title}
            opacity={anim.docs[i]!}
            translateX={anim.docs[i]!.interpolate({ inputRange: [0, 1], outputRange: [CX - (d.x + CARD.w / 2), 0] })}
            translateY={anim.docs[i]!.interpolate({ inputRange: [0, 1], outputRange: [CY - (d.y + CARD.h / 2), 0] })}
            scale={anim.docs[i]!.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] })}
            rotation={d.r}
            origin={`${d.x + CARD.w / 2},${d.y + CARD.h / 2}`}
          >
            <G transform={`translate(${d.x} ${d.y})`}>
              <Rect width={CARD.w} height={CARD.h} rx={6} fill="#FBFBF9" stroke={color.midnight} strokeWidth={1.5} />
              <SvgText x={12} y={26} fontFamily={font.serifBold} fontSize={16} fill="#1A1A1A">
                {d.title}
              </SvgText>
              <Line x1={12} y1={34} x2={128} y2={34} stroke="#1A1A1A" strokeWidth={1.5} />
              {[52, 72, 92, 112, 132, 152].map((y) => (
                <Line key={y} x1={12} y1={y} x2={118} y2={y} stroke="#1A1A1A" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
              ))}
            </G>
          </AnimatedG>
        ))}

        {/* OVERNIGHT — the logo, which is also the machine that reads the page */}
        <AnimatedG opacity={anim.core}>
          <Circle cx={CX} cy={CY} r={R * 0.62} fill="url(#core)" />
        </AnimatedG>
      </Svg>

      {/* The emblem and wordmark are bitmaps, so they sit over the vector scene rather than in it:
          react-native-svg has no <image href> for a bundled asset the way the web's SVG does. */}
      <View pointerEvents="none" style={{ position: "absolute", width, height }}>
        <Image
          source={require("../../assets/hero-disc.png")}
          style={px(width, EMBLEM.x, EMBLEM.y, EMBLEM.size, EMBLEM.size)}
          resizeMode="contain"
        />
        <Animated.Image
          source={require("../../assets/hero-points.png")}
          style={[px(width, EMBLEM.x, EMBLEM.y, EMBLEM.size, EMBLEM.size), { transform: [{ rotate: anim.spin }] }]}
          resizeMode="contain"
        />
        <Image
          source={require("../../assets/hero-wordmark.png")}
          style={px(width, WORDMARK.x, WORDMARK.y, WORDMARK.w, WORDMARK.h)}
          resizeMode="contain"
        />
        <Image
          source={require("../../assets/hero-tagline.png")}
          style={px(width, TAGLINE.x, TAGLINE.y, TAGLINE.w, TAGLINE.h)}
          resizeMode="contain"
        />
      </View>
    </Pressable>
  );
}

/** A viewBox rectangle, in the screen pixels this scene was scaled to. */
function px(width: number, x: number, y: number, w: number, h: number) {
  const k = width / W;
  return { position: "absolute" as const, left: x * k, top: y * k, width: w * k, height: h * k };
}
