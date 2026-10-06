/**
 * The storyboard's drawing pieces — a figure, a tablet, a laptop, a phone, the compass rose — in
 * react-native-svg. A transcription of the pieces in apps/web/src/components/storyboard/Storyboard.tsx,
 * same coordinates and the same 480×280 frame, so a scene can be copied across line for line.
 */
import type { ReactNode } from "react";
import { Circle, G, Line, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { font } from "@/theme";
import { Hand, Pop, Stroke, Turn } from "./motion";

export const C = {
  ink: "#1E2A44",
  ink2: "#2E3D5C",
  gold: "#C9973F",
  goldText: "#B8862F",
  paper: "#FDFAF3",
  parch: "#F7F0E3",
  border: "#E3D9C2",
  borderStrong: "#D9CDB4",
  sun: "#F0DDA9",
  muted: "#4A5266",
  meta: "#8A7D5F",
  eink: "#FBFBF9",
  rule: "#D8D4C8",
  grey: "#9A9A9A",
} as const;

export const FRAME_W = 480;
export const FRAME_H = 280;

export function Ground({ y = 252 }: { y?: number }) {
  return <Line x1={0} y1={y} x2={480} y2={y} stroke={C.borderStrong} strokeWidth={2} />;
}

/**
 * A figure, feet at (x, y). Seated figures sit on a seat at y-46. `hand` is where the writing
 * hand is, and the arm reaches it; with `writing` the hand moves as a pen does.
 */
export function Person({ x, y, seated = false, hand, writing = true, tone = C.ink }: { x: number; y: number; seated?: boolean; hand?: [number, number]; writing?: boolean; tone?: string }) {
  const hip = seated ? y - 46 : y - 54;
  const shoulderY = hip - 40;
  const arm = hand ? (
    <G>
      <Line x1={x + 12} y1={shoulderY + 6} x2={hand[0]} y2={hand[1]} stroke={tone} strokeWidth={8} strokeLinecap="round" />
      {writing ? <Line x1={hand[0]} y1={hand[1]} x2={hand[0] + 9} y2={hand[1] - 12} stroke={C.gold} strokeWidth={2.5} strokeLinecap="round" /> : null}
    </G>
  ) : null;
  return (
    <G>
      <Circle cx={x} cy={shoulderY - 18} r={13} fill={tone} />
      <Path d={`M ${x - 17} ${shoulderY} Q ${x} ${shoulderY - 6} ${x + 17} ${shoulderY} L ${x + 14} ${hip} L ${x - 14} ${hip} Z`} fill={tone} />
      {seated ? (
        <>
          <Rect x={x - 14} y={hip - 2} width={40} height={11} rx={5} fill={tone} />
          <Rect x={x + 16} y={hip + 4} width={10} height={y - hip - 4} rx={4} fill={tone} />
        </>
      ) : (
        <>
          <Rect x={x - 13} y={hip - 2} width={10} height={y - hip + 2} rx={4} fill={tone} />
          <Rect x={x + 3} y={hip - 2} width={10} height={y - hip + 2} rx={4} fill={tone} />
        </>
      )}
      {arm && writing ? <Hand pivot={[x + 12, shoulderY + 6]}>{arm}</Hand> : arm}
    </G>
  );
}

/** A reMarkable: an e-ink page in a dark frame. Children draw on the page, in page coordinates. */
export function Tablet({ x, y, w = 70, h = 92, children }: { x: number; y: number; w?: number; h?: number; children?: ReactNode }) {
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={5} fill={C.ink2} />
      <Rect x={x + 4} y={y + 4} width={w - 8} height={h - 12} rx={2} fill={C.eink} />
      <G transform={`translate(${x + 4} ${y + 4})`}>{children}</G>
    </G>
  );
}

/** A line of handwriting being written, from (x, y) across w. */
export function Ink({ x, y, w, delay, color = C.ink, width = 1.6 }: { x: number; y: number; w: number; delay: number; color?: string; width?: number }) {
  // A gentle wave reads as handwriting where a straight line reads as a rule.
  const d = `M ${x} ${y} q ${w / 8} -3 ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0`;
  return <Stroke d={d} length={w * 1.05 + 2} delay={delay} color={color} width={width} />;
}

export function Laptop({ x, y, w = 150, children }: { x: number; y: number; w?: number; children?: ReactNode }) {
  const h = w * 0.62;
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={5} fill={C.ink} />
      <Rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} rx={2} fill={C.paper} />
      <Path d={`M ${x - 14} ${y + h} h ${w + 28} l -10 8 h ${-(w + 8)} Z`} fill={C.ink2} />
      <G transform={`translate(${x + 6} ${y + 6})`}>{children}</G>
    </G>
  );
}

export function Phone({ x, y, children }: { x: number; y: number; children?: ReactNode }) {
  return (
    <G>
      <Rect x={x} y={y} width={56} height={104} rx={9} fill={C.ink} />
      <Rect x={x + 4} y={y + 8} width={48} height={88} rx={3} fill={C.paper} />
      <G transform={`translate(${x + 4} ${y + 8})`}>{children}</G>
    </G>
  );
}

/** The compass rose: a ring and four diamond points — the emblem, as drawn below 48px. */
export function Rose({ cx, cy, r, turning = false, color = C.ink }: { cx: number; cy: number; r: number; turning?: boolean; color?: string }) {
  const diamond = `0,${-r * 1.55} ${r * 0.22},${-r * 0.95} 0,${-r * 0.62} ${-r * 0.22},${-r * 0.95}`;
  const points = [0, 90, 180, 270].map((a) => <Polygon key={a} points={diamond} fill={a === 0 ? C.gold : color} rotation={a} />);
  return (
    <G transform={`translate(${cx} ${cy})`}>
      <Circle r={r} fill="none" stroke={color} strokeWidth={r * 0.16} />
      {turning ? <Turn>{points}</Turn> : <G>{points}</G>}
    </G>
  );
}

type Face = "mono" | "sans" | "serif";

/** Text. The app registers each weight as its own family, so weight picks the family. */
export function Label({ x, y, children, size = 11, color = C.meta, anchor = "start", weight = 500, face = "mono" }: { x: number; y: number; children: ReactNode; size?: number; color?: string; anchor?: "start" | "middle" | "end"; weight?: number; face?: Face }) {
  const family =
    face === "mono" ? font.mono : face === "serif" ? (weight >= 600 ? font.serifBold : font.serif) : weight >= 700 ? font.sansBold : weight >= 500 ? font.sansMedium : font.sans;
  return (
    <SvgText x={x} y={y} fontFamily={family} fontSize={size} fill={color} textAnchor={anchor} letterSpacing={face === "mono" ? 0.6 : 0}>
      {children}
    </SvgText>
  );
}

/** A small rounded tag, as the settings chips are drawn. */
export function Chip({ x, y, w, text, delay, dark = false }: { x: number; y: number; w: number; text: string; delay: number; dark?: boolean }) {
  return (
    <Pop delay={delay} centre={[x + w / 2, y + 12]}>
      <Rect x={x} y={y} width={w} height={24} rx={12} fill={dark ? C.ink : C.paper} stroke={dark ? C.ink : C.borderStrong} />
      <Label x={x + w / 2} y={y + 16} anchor="middle" size={11} color={dark ? C.parch : C.ink} face="sans" weight={600}>
        {text}
      </Label>
    </Pop>
  );
}

export function Checkbox({ x, y, ticked, delay }: { x: number; y: number; ticked: boolean; delay: number }) {
  return (
    <G>
      <Rect x={x} y={y} width={9} height={9} rx={1.5} fill="none" stroke={C.ink} strokeWidth={1.3} />
      {ticked ? <Stroke d={`M ${x + 1.5} ${y + 4.5} l 2.5 3 l 5 -7`} length={13} delay={delay} color={C.ink} width={1.8} /> : null}
    </G>
  );
}

export function Envelope({ x, y, w = 40 }: { x: number; y: number; w?: number }) {
  const h = w * 0.66;
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={3} fill={C.paper} stroke={C.ink} strokeWidth={1.6} />
      <Path d={`M ${x} ${y + 2} L ${x + w / 2} ${y + h * 0.6} L ${x + w} ${y + 2}`} fill="none" stroke={C.ink} strokeWidth={1.6} />
    </G>
  );
}
