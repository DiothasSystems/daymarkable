/**
 * The storyboard's motions, on a phone.
 *
 * The web animates each frame with CSS keyframes (apps/web/src/components/storyboard/storyboard.css).
 * Here every motion is a phase of ONE clock per screen — an 8-second linear loop, the web's period —
 * so a motion is just a keyframe table read off that clock, shifted by the element's delay exactly as
 * CSS `animation-delay` shifts it. The shorter web loops (the compass's 4s turn, the 2s pulse) are
 * whole repeats inside the 8 seconds, so everything stays in step and nothing drifts.
 *
 * It is React Native's Animated on the JS thread, not the native driver, for the reason Hero.tsx
 * gives: the native driver writes into native VIEW props and react-native-svg's shapes are not views.
 * Only the visible scene is bound to the clock; the rest are drawn still. With no clock (a scene off
 * screen, or reduced motion turned on) every piece renders its resting state — the whole picture,
 * still — which is also what the web shows with motion turned off.
 */
import { createContext, useContext, type ReactNode } from "react";
import { Animated } from "react-native";
import { G, Path } from "react-native-svg";

export const LOOP_MS = 8000;
const LOOP_S = LOOP_MS / 1000;

/** The visible scene's clock (0 → 1 over LOOP_MS, repeating), or null to draw still. */
export const Motion = createContext<Animated.Value | null>(null);

type Stops = readonly (readonly [number, number])[];

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** A keyframe table's value at x (0..1), linear between stops. */
function valueAt(stops: Stops, x: number): number {
  for (let i = 1; i < stops.length; i++) {
    const [p1, v1] = stops[i]!;
    const [p0, v0] = stops[i - 1]!;
    if (x <= p1) return p1 === p0 ? v1 : v0 + ((v1 - v0) * (x - p0)) / (p1 - p0);
  }
  return stops[stops.length - 1]![1];
}

/** A table that runs n times inside one loop: the web's 4s turn is twice round the 8s clock. */
function times(stops: Stops, n: number): Stops {
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) for (const [p, v] of stops) out.push([(k + p) / n, v]);
  return out;
}

/**
 * A keyframe table read off the clock, started `delay` seconds late. Shifting a cyclic table
 * moves its stops round the loop; the value where the loop wraps is added at both ends. Two stops
 * can land on the same instant (where the shifted cycle restarts) — Animated allows an equal pair
 * in inputRange, which is a jump, and the one from the END of the cycle must come first.
 */
export function track(clock: Animated.Value, stops: Stops, delay = 0) {
  const s = (((delay / LOOP_S) % 1) + 1) % 1;
  const pts = stops.map(([p, v]) => {
    let at = p + s;
    if (at > 1) at -= 1;
    return { at, local: p, v };
  });
  const edge = valueAt(stops, s === 0 ? 0 : 1 - s);
  pts.push({ at: 0, local: -1, v: edge }, { at: 1, local: 2, v: edge });
  pts.sort((a, b) => a.at - b.at || (a.at === 0 ? a.local - b.local : b.local - a.local));
  return clock.interpolate({ inputRange: pts.map((p) => p.at), outputRange: pts.map((p) => p.v), extrapolate: "clamp" });
}

const at = (p: number, v: number) => [p, v] as const;

// The web's keyframes, transcribed. Each is named after its CSS class.
const POP_OPACITY: Stops = [at(0, 0), at(0.08, 0), at(0.18, 1), at(0.88, 1), at(0.96, 0), at(1, 0)];
const POP_RISE: Stops = [at(0, 8), at(0.08, 8), at(0.18, 0), at(1, 0)];
const POP_SCALE: Stops = [at(0, 0.92), at(0.08, 0.92), at(0.18, 1), at(1, 1)];
const DRAW: Stops = [at(0, 1), at(0.06, 1), at(0.22, 0), at(0.88, 0), at(0.96, 1), at(1, 1)];
const FLY_OPACITY: Stops = [at(0, 0), at(0.1, 0), at(0.16, 1), at(0.44, 1), at(0.52, 0), at(1, 0)];
const FLY_TRIP: Stops = [at(0, 0), at(0.1, 0), at(0.44, 1), at(1, 1)];
const FLY_SCALE: Stops = [at(0, 1), at(0.1, 1), at(0.44, 0.55), at(0.52, 0.4), at(1, 0.4)];
const SEND_OPACITY: Stops = [at(0, 0), at(0.08, 0), at(0.14, 1), at(0.42, 1), at(0.5, 0), at(1, 0)];
const SEND_TRIP: Stops = [at(0, 0), at(0.08, 0), at(0.42, 1), at(1, 1)];
/** 4s on the web: twice per loop. */
const TURN: Stops = times([at(0, 0), at(0.4, 0), at(0.6, 90), at(1, 90)], 2);
/** 2s on the web: four times per loop. */
const PULSE: Stops = times([at(0, 1), at(0.5, 1.06), at(1, 1)], 4);
/** 3s on the web; three per loop here (2.7s) so it stays on the clock. */
const TWINKLE: Stops = times([at(0, 1), at(0.5, 0.35), at(1, 1)], 3);
/** 0.9s each way on the web; five round trips per loop here (1.6s). */
const HAND_X: Stops = times([at(0, -3), at(0.5, 3), at(1, -3)], 5);
const HAND_Y: Stops = times([at(0, 0), at(0.5, 1), at(1, 0)], 5);
const HAND_R: Stops = times([at(0, -2), at(0.5, 2), at(1, -2)], 5);

type Point = readonly [number, number];
const origin = ([x, y]: Point) => `${x},${y}`;

/** Something arriving: fades and rises into place. `centre` lets it grow from its own middle. */
export function Pop({ delay = 0, centre, children }: { delay?: number; centre?: Point; children: ReactNode }) {
  const clock = useContext(Motion);
  if (!clock) return <G>{children}</G>;
  return (
    <AnimatedG
      opacity={track(clock, POP_OPACITY, delay)}
      translateY={track(clock, POP_RISE, delay)}
      {...(centre ? { scale: track(clock, POP_SCALE, delay), origin: origin(centre) } : {})}
    >
      {children}
    </AnimatedG>
  );
}

/**
 * Ink being written: a stroke drawn along its length. The web says pathLength="1"; react-native-svg
 * does not honour that, so each stroke carries its own length, near enough — a dash a little longer
 * than the path only means the pen pauses at the end.
 */
export function Stroke({ d, length, delay = 0, color, width, cap = "round", join }: { d: string; length: number; delay?: number; color: string; width: number; cap?: "round" | "butt"; join?: "round" }) {
  const clock = useContext(Motion);
  const common = { d, fill: "none", stroke: color, strokeWidth: width, strokeLinecap: cap, strokeLinejoin: join } as const;
  if (!clock) return <Path {...common} />;
  const offset = track(clock, DRAW, delay).interpolate({ inputRange: [0, 1], outputRange: [0, length] });
  return <AnimatedPath {...common} strokeDasharray={[length, length]} strokeDashoffset={offset} />;
}

/** A dashed line with something travelling along it: pairing, forwarding. */
export function Dashed({ d, color, width, pattern = [6, 6] }: { d: string; color: string; width: number; pattern?: [number, number] }) {
  const clock = useContext(Motion);
  const common = { d, fill: "none", stroke: color, strokeWidth: width, strokeDasharray: pattern } as const;
  if (!clock) return <Path {...common} />;
  // About the web's 1.2s per pattern: seven patterns' travel per loop, so the wrap is seamless.
  const run = (pattern[0] + pattern[1]) * 7;
  return <AnimatedPath {...common} strokeDashoffset={clock.interpolate({ inputRange: [0, 1], outputRange: [0, -run] })} />;
}

/** The writing hand's small to-and-fro, pivoting at the shoulder. */
export function Hand({ pivot, children }: { pivot: Point; children: ReactNode }) {
  const clock = useContext(Motion);
  if (!clock) return <G>{children}</G>;
  return (
    <AnimatedG translateX={track(clock, HAND_X)} translateY={track(clock, HAND_Y)} rotation={track(clock, HAND_R)} origin={origin(pivot)}>
      {children}
    </AnimatedG>
  );
}

/** A page leaving the tablet for the compass, overnight. Off screen it is not drawn at all. */
export function Fly({ delay = 0, dx, dy, centre, children }: { delay?: number; dx: number; dy: number; centre: Point; children: ReactNode }) {
  const clock = useContext(Motion);
  if (!clock) return null;
  const trip = track(clock, FLY_TRIP, delay);
  return (
    <AnimatedG
      opacity={track(clock, FLY_OPACITY, delay)}
      translateX={trip.interpolate({ inputRange: [0, 1], outputRange: [0, dx] })}
      translateY={trip.interpolate({ inputRange: [0, 1], outputRange: [0, dy] })}
      scale={track(clock, FLY_SCALE, delay)}
      origin={origin(centre)}
    >
      {children}
    </AnimatedG>
  );
}

/** An envelope crossing the frame. Like Fly, it has nowhere still to be, so a still frame omits it. */
export function Send({ delay = 0, dx, dy, children }: { delay?: number; dx: number; dy: number; children: ReactNode }) {
  const clock = useContext(Motion);
  if (!clock) return null;
  const trip = track(clock, SEND_TRIP, delay);
  return (
    <AnimatedG
      opacity={track(clock, SEND_OPACITY, delay)}
      translateX={trip.interpolate({ inputRange: [0, 1], outputRange: [0, dx] })}
      translateY={trip.interpolate({ inputRange: [0, 1], outputRange: [0, dy] })}
    >
      {children}
    </AnimatedG>
  );
}

/** A quarter turn, then a rest — the emblem's motion. Turns about `centre`. */
export function Turn({ centre = [0, 0], children }: { centre?: Point; children: ReactNode }) {
  const clock = useContext(Motion);
  if (!clock) return <G>{children}</G>;
  return (
    <AnimatedG rotation={track(clock, TURN)} origin={origin(centre)}>
      {children}
    </AnimatedG>
  );
}

/** A button asking to be noticed. */
export function Pulse({ centre, children }: { centre: Point; children: ReactNode }) {
  const clock = useContext(Motion);
  if (!clock) return <G>{children}</G>;
  return (
    <AnimatedG scale={track(clock, PULSE)} origin={origin(centre)}>
      {children}
    </AnimatedG>
  );
}

/** A star. */
export function Twinkle({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  const clock = useContext(Motion);
  if (!clock) return <G>{children}</G>;
  return <AnimatedG opacity={track(clock, TWINKLE, delay)}>{children}</AnimatedG>;
}
