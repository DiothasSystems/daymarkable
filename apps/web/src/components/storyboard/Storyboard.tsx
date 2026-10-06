/**
 * "See how it works": a storyboard of a day with ScriptumIQ, from setting it up to the morning after.
 *
 * Each frame is an inline SVG animated with the CSS in storyboard.css — no script, no images to
 * fetch — drawn in the brand palette with a deliberately plain figure, so the pictures read as a
 * storyboard rather than as product screenshots that would date. Captions say only what the product
 * does today: forwarding an invite is real, connecting a calendar account is not yet, so the frame
 * shows forwarding.
 */
import type { CSSProperties, ReactNode } from "react";
import "./storyboard.css";

const C = {
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
};

/** Animation delay, so the pieces of one frame arrive in order. */
const at = (s: number, extra: CSSProperties = {}): CSSProperties => ({ animationDelay: `${s}s`, ...extra });
const MONO = "IBM Plex Mono, ui-monospace, monospace";
const SANS = "Public Sans, system-ui, sans-serif";
const SERIF = "Source Serif 4, Georgia, serif";

// ---------------------------------------------------------------------------------- pieces
function Ground({ y = 252 }: { y?: number }) {
  return <line x1={0} y1={y} x2={480} y2={y} stroke={C.borderStrong} strokeWidth={2} />;
}

/**
 * A figure, feet at (x, y). Seated figures sit on a seat at y-46. `hand` is where the writing
 * hand is, and the arm reaches it; with `writing` the hand moves as a pen does.
 */
function Person({ x, y, seated = false, hand, writing = true, tone = C.ink }: { x: number; y: number; seated?: boolean; hand?: [number, number]; writing?: boolean; tone?: string }) {
  const hip = seated ? y - 46 : y - 54;
  const shoulderY = hip - 40;
  return (
    <g>
      <circle cx={x} cy={shoulderY - 18} r={13} fill={tone} />
      <path d={`M ${x - 17} ${shoulderY} Q ${x} ${shoulderY - 6} ${x + 17} ${shoulderY} L ${x + 14} ${hip} L ${x - 14} ${hip} Z`} fill={tone} />
      {seated ? (
        <>
          <rect x={x - 14} y={hip - 2} width={40} height={11} rx={5} fill={tone} />
          <rect x={x + 16} y={hip + 4} width={10} height={y - hip - 4} rx={4} fill={tone} />
        </>
      ) : (
        <>
          <rect x={x - 13} y={hip - 2} width={10} height={y - hip + 2} rx={4} fill={tone} />
          <rect x={x + 3} y={hip - 2} width={10} height={y - hip + 2} rx={4} fill={tone} />
        </>
      )}
      {hand ? (
        <g className={writing ? "sb-hand" : undefined}>
          <line x1={x + 12} y1={shoulderY + 6} x2={hand[0]} y2={hand[1]} stroke={tone} strokeWidth={8} strokeLinecap="round" />
          {writing ? <line x1={hand[0]} y1={hand[1]} x2={hand[0] + 9} y2={hand[1] - 12} stroke={C.gold} strokeWidth={2.5} strokeLinecap="round" /> : null}
        </g>
      ) : null}
    </g>
  );
}

/** A reMarkable: an e-ink page in a dark frame. Children draw on the page, in page coordinates. */
function Tablet({ x, y, w = 70, h = 92, children }: { x: number; y: number; w?: number; h?: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} fill={C.ink2} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 12} rx={2} fill={C.eink} />
      <g transform={`translate(${x + 4} ${y + 4})`}>{children}</g>
    </g>
  );
}

/** A line of handwriting being written, from (x, y) across w. */
function Ink({ x, y, w, delay, color = C.ink, width = 1.6 }: { x: number; y: number; w: number; delay: number; color?: string; width?: number }) {
  // A gentle wave reads as handwriting where a straight line reads as a rule.
  const d = `M ${x} ${y} q ${w / 8} -3 ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0`;
  return <path d={d} pathLength={1} className="sb-ink" style={at(delay)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />;
}

function Laptop({ x, y, w = 150, children }: { x: number; y: number; w?: number; children?: ReactNode }) {
  const h = w * 0.62;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} fill={C.ink} />
      <rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} rx={2} fill={C.paper} />
      <path d={`M ${x - 14} ${y + h} h ${w + 28} l -10 8 h ${-(w + 8)} Z`} fill={C.ink2} />
      <g transform={`translate(${x + 6} ${y + 6})`}>{children}</g>
    </g>
  );
}

function Phone({ x, y, children }: { x: number; y: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={56} height={104} rx={9} fill={C.ink} />
      <rect x={x + 4} y={y + 8} width={48} height={88} rx={3} fill={C.paper} />
      <g transform={`translate(${x + 4} ${y + 8})`}>{children}</g>
    </g>
  );
}

/** The compass rose: a ring and four diamond points — the emblem, as drawn below 48px. */
function Rose({ cx, cy, r, turning = false, color = C.ink }: { cx: number; cy: number; r: number; turning?: boolean; color?: string }) {
  const diamond = `0,${-r * 1.55} ${r * 0.22},${-r * 0.95} 0,${-r * 0.62} ${-r * 0.22},${-r * 0.95}`;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={r} fill="none" stroke={color} strokeWidth={r * 0.16} />
      <g className={turning ? "sb-turn" : undefined}>
        {[0, 90, 180, 270].map((a) => (
          <polygon key={a} points={diamond} fill={a === 0 ? C.gold : color} transform={`rotate(${a})`} />
        ))}
      </g>
    </g>
  );
}

function Label({ x, y, children, size = 11, color = C.meta, anchor = "start", weight = 500, font = MONO }: { x: number; y: number; children: ReactNode; size?: number; color?: string; anchor?: "start" | "middle" | "end"; weight?: number; font?: string }) {
  return (
    <text x={x} y={y} fontFamily={font} fontSize={size} fill={color} textAnchor={anchor} fontWeight={weight} letterSpacing={font === MONO ? 0.6 : 0}>
      {children}
    </text>
  );
}

/** A small rounded tag, as the settings chips are drawn. */
function Chip({ x, y, w, text, delay, dark = false }: { x: number; y: number; w: number; text: string; delay: number; dark?: boolean }) {
  return (
    <g className="sb-pop" style={at(delay)}>
      <rect x={x} y={y} width={w} height={24} rx={12} fill={dark ? C.ink : C.paper} stroke={dark ? C.ink : C.borderStrong} />
      <Label x={x + w / 2} y={y + 16} anchor="middle" size={11} color={dark ? C.parch : C.ink} font={SANS} weight={600}>
        {text}
      </Label>
    </g>
  );
}

function Checkbox({ x, y, ticked, delay }: { x: number; y: number; ticked: boolean; delay: number }) {
  return (
    <g>
      <rect x={x} y={y} width={9} height={9} rx={1.5} fill="none" stroke={C.ink} strokeWidth={1.3} />
      {ticked ? <path d={`M ${x + 1.5} ${y + 4.5} l 2.5 3 l 5 -7`} pathLength={1} className="sb-ink" style={at(delay)} fill="none" stroke={C.ink} strokeWidth={1.8} strokeLinecap="round" /> : null}
    </g>
  );
}

function Envelope({ x, y, w = 40, style, className }: { x: number; y: number; w?: number; style?: CSSProperties; className?: string }) {
  const h = w * 0.66;
  return (
    <g className={className} style={style}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={C.paper} stroke={C.ink} strokeWidth={1.6} />
      <path d={`M ${x} ${y + 2} L ${x + w / 2} ${y + h * 0.6} L ${x + w} ${y + 2}`} fill="none" stroke={C.ink} strokeWidth={1.6} />
    </g>
  );
}

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 480 280" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------------------- scenes
interface Scene {
  phase: "setup" | "day" | "night" | "morning";
  time: string;
  title: string;
  lines: string[];
  art: ReactNode;
}

const SCENES: Scene[] = [
  // ---- Day 1 ------------------------------------------------------------------------------
  {
    phase: "setup",
    time: "Day 1 · 1",
    title: "Your invitation",
    lines: [
      "ScriptumIQ opens by invitation. Choose a password and your 14-day free trial begins.",
      "Each time you sign in we also email you a link to finish, so a password on its own never opens your notes.",
    ],
    art: (
      <Frame label="A person at a laptop receives an invitation and sets a password">
        <Ground />
        <rect x={250} y={186} width={200} height={10} rx={3} fill={C.borderStrong} />
        <rect x={262} y={196} width={8} height={56} fill={C.borderStrong} />
        <rect x={430} y={196} width={8} height={56} fill={C.borderStrong} />
        <Person x={210} y={252} seated hand={[300, 176]} writing={false} />
        <Laptop x={300} y={98} w={140}>
          <Label x={64} y={18} anchor="middle" size={10} color={C.goldText}>YOU&apos;RE INVITED</Label>
          <rect x={14} y={28} width={100} height={14} rx={2} fill="none" stroke={C.borderStrong} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <circle key={i} className="sb-pop" style={at(1.2 + i * 0.18)} cx={22 + i * 11} cy={35} r={2.6} fill={C.ink} />
          ))}
          <rect className="sb-pop" style={at(3)} x={30} y={52} width={68} height={16} rx={3} fill={C.ink} />
          <Label x={64} y={63} anchor="middle" size={9} color={C.parch} font={SANS} weight={700}>Set password</Label>
        </Laptop>
        <Envelope className="sb-send" style={at(0, { "--dx": "230px", "--dy": "40px" } as CSSProperties)} x={40} y={60} />
        <g className="sb-pop" style={at(3.6)}>
          <rect x={38} y={140} width={120} height={28} rx={14} fill={C.sun} stroke={C.gold} />
          <Label x={98} y={158} anchor="middle" size={11} color={C.ink} weight={600}>14 DAYS FREE</Label>
        </g>
      </Frame>
    ),
  },
  {
    phase: "setup",
    time: "Day 1 · 2",
    title: "Pair your tablet",
    lines: [
      "Get a one-time code from my.remarkable.com and paste it into setup.",
      "ScriptumIQ can now read your notebooks and put its pages back on your tablet. You do this once.",
    ],
    art: (
      <Frame label="A code typed on the laptop links it to the tablet">
        <Ground />
        <Laptop x={50} y={92} w={170}>
          <Label x={79} y={22} anchor="middle" size={10}>ONE-TIME CODE</Label>
          {"ABCDEFGH".split("").map((ch, i) => (
            <g key={i} className="sb-pop" style={at(0.6 + i * 0.22)}>
              <rect x={10 + i * 18} y={32} width={15} height={22} rx={2} fill={C.parch} stroke={C.borderStrong} />
              <Label x={17.5 + i * 18} y={48} anchor="middle" size={13} color={C.ink} weight={600}>{ch}</Label>
            </g>
          ))}
          <rect className="sb-pop" style={at(2.8)} x={44} y={66} width={70} height={16} rx={3} fill={C.ink} />
          <Label x={79} y={77} anchor="middle" size={9} color={C.parch} font={SANS} weight={700}>Pair</Label>
        </Laptop>
        <path d="M 240 150 C 280 110, 320 110, 352 140" fill="none" stroke={C.gold} strokeWidth={2.5} className="sb-dash" />
        <Tablet x={352} y={104} w={84} h={112}>
          <g className="sb-pop" style={at(3.4)}>
            <circle cx={38} cy={44} r={18} fill={C.sun} />
            <path d="M 29 44 l 7 7 l 12 -14" fill="none" stroke={C.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <Label x={38} y={84} anchor="middle" size={8} color={C.ink}>PAIRED</Label>
          </g>
        </Tablet>
      </Frame>
    ),
  },
  {
    phase: "setup",
    time: "Day 1 · 3",
    title: "Choose what we read",
    lines: [
      "Pick the folders to watch: every notebook by default, PDFs if you want them, never ebooks.",
      "Set your timezone, so midnight is your midnight, and choose where our notebooks land: a ScriptumIQ folder, or the top of your tablet.",
    ],
    art: (
      <Frame label="Folders being ticked, a clock set to the user's time, and a choice of where notebooks go">
        <rect x={34} y={34} width={190} height={200} rx={6} fill={C.paper} stroke={C.border} />
        <Label x={50} y={58}>WATCH FOLDERS</Label>
        {[
          ["Work", true],
          ["Meetings", true],
          ["Journal", true],
          ["Groceries", true],
          ["PDFs", false],
        ].map(([name, on], i) => (
          <g key={String(name)}>
            <rect x={50} y={72 + i * 30} width={13} height={13} rx={2} fill="none" stroke={C.ink} strokeWidth={1.4} />
            {on ? <path d={`M 52 ${79 + i * 30} l 3.5 4 l 6 -8`} pathLength={1} className="sb-ink" style={at(0.5 + i * 0.5)} fill="none" stroke={C.ink} strokeWidth={2} strokeLinecap="round" /> : null}
            <Label x={74} y={83 + i * 30} size={13} color={on ? C.ink : C.meta} font={SANS} weight={500}>{String(name)}</Label>
          </g>
        ))}
        <g transform="translate(320 92)">
          <circle r={40} fill={C.paper} stroke={C.ink} strokeWidth={3} />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
            <line key={h} x1={0} y1={-34} x2={0} y2={-30} stroke={C.ink} strokeWidth={2} transform={`rotate(${h * 30})`} />
          ))}
          <line x1={0} y1={0} x2={0} y2={-26} stroke={C.ink} strokeWidth={3} strokeLinecap="round" />
          <g className="sb-turn">
            <line x1={0} y1={0} x2={0} y2={-34} stroke={C.gold} strokeWidth={2} strokeLinecap="round" />
          </g>
          <Label x={0} y={62} anchor="middle" size={10}>YOUR TIMEZONE</Label>
        </g>
        <Chip x={262} y={182} w={110} text="ScriptumIQ folder" delay={3} dark />
        <Chip x={380} y={182} w={72} text="or root" delay={3.4} />
        <Label x={262} y={226} size={10}>WHERE NOTEBOOKS LAND</Label>
      </Frame>
    ),
  },
  {
    phase: "setup",
    time: "Day 1 · 4",
    title: "Teach it your marks, and your hand",
    lines: [
      "Tell us which marks mean something: an asterisk for an action, an underline for a follow-up, a box, a margin star, or a word of your own like TODO.",
      "Then copy a short passage in your own writing and add the names and project words you use. That is how it learns to read you.",
    ],
    art: (
      <Frame label="A page marked with an asterisk, an underline and TODO, beside a handwriting sample sheet">
        <Tablet x={40} y={30} w={170} h={220}>
          <Label x={12} y={22} size={9}>WORK · p.12</Label>
          <text x={12} y={52} fontFamily={SERIF} fontSize={22} fill={C.gold} className="sb-pop" style={at(0.4)}>*</text>
          <Ink x={28} y={48} w={110} delay={0.6} />
          <Ink x={12} y={82} w={120} delay={1.8} />
          <path d="M 12 90 h 120" pathLength={1} className="sb-ink" style={at(2.6)} stroke={C.gold} strokeWidth={2.2} fill="none" />
          <Label x={12} y={122} size={11} color={C.ink} weight={700} font={SANS}>
            <tspan className="sb-pop" style={at(3.2)}>TODO</tspan>
          </Label>
          <Ink x={54} y={118} w={90} delay={3.4} />
          <Ink x={12} y={150} w={130} delay={4.4} color={C.grey} />
          <Ink x={12} y={176} w={100} delay={5} color={C.grey} />
        </Tablet>
        <Chip x={234} y={48} w={150} text="*  =  an action" delay={1} dark />
        <Chip x={234} y={82} w={150} text="underline  =  follow-up" delay={2.6} />
        <Chip x={234} y={116} w={150} text="TODO  =  an action" delay={3.4} />
        <g className="sb-pop" style={at(4.4)}>
          <rect x={234} y={160} width={206} height={84} rx={4} fill={C.eink} stroke={C.borderStrong} />
          <Label x={246} y={180} size={9}>HANDWRITING SAMPLE</Label>
          <Label x={246} y={198} size={10} color={C.muted} font={SERIF}>&quot;Send Priya the Q4 deck by Friday…&quot;</Label>
          <Ink x={246} y={222} w={170} delay={5.2} />
        </g>
      </Frame>
    ),
  },
  {
    phase: "setup",
    time: "Day 1 · 5",
    title: "Choose your extras",
    lines: [
      "Turn on a Daily Update with headlines on topics you choose, and a Daily Puzzle: sudoku, word search or crossword.",
      "Have each night's pages emailed as PDFs to an address you confirm, get an email for every meeting, and receive your own address for forwarding meeting invites.",
    ],
    art: (
      <Frame label="Options switching on: Daily Update, Daily Puzzle, PDFs by email, meeting emails, forwarding address">
        {[
          ["Daily Update · your headlines", 0.4],
          ["Daily Puzzle", 1.2],
          ["PDFs by email", 2],
          ["An email per meeting", 2.8],
          ["you@cal.scriptumiq.com", 3.6],
        ].map(([text, d], i) => (
          <g key={String(text)} className="sb-pop" style={at(Number(d))}>
            <rect x={60} y={34 + i * 44} width={360} height={34} rx={6} fill={C.paper} stroke={C.border} />
            <Label x={78} y={56 + i * 44} size={14} color={C.ink} font={SANS} weight={500}>{String(text)}</Label>
            <rect x={358} y={42 + i * 44} width={40} height={18} rx={9} fill={C.ink} />
            <circle cx={389} cy={51 + i * 44} r={7} fill={C.gold} />
          </g>
        ))}
      </Frame>
    ),
  },

  // ---- The day ---------------------------------------------------------------------------
  {
    phase: "day",
    time: "9:00 · The meeting",
    title: "Write the way you always do",
    lines: [
      "The meeting's name and date at the top make the page a meeting note.",
      "A star beside \"send the contract\" makes it an action. There is nothing to tag, and nothing to sync.",
    ],
    art: (
      <Frame label="Three people at a meeting table, one writing on a tablet">
        <Ground />
        <rect x={60} y={170} width={360} height={12} rx={4} fill={C.borderStrong} />
        <rect x={80} y={182} width={10} height={70} fill={C.borderStrong} />
        <rect x={390} y={182} width={10} height={70} fill={C.borderStrong} />
        <Person x={110} y={252} seated tone={C.ink2} />
        <Person x={370} y={252} seated tone={C.ink2} />
        <Person x={240} y={252} seated hand={[262, 164]} />
        <g className="sb-pop" style={at(0.3)}>
          <circle cx={128} cy={96} r={3} fill={C.meta} />
          <circle cx={138} cy={92} r={3} fill={C.meta} />
          <circle cx={148} cy={96} r={3} fill={C.meta} />
        </g>
        <Tablet x={250} y={70} w={96} h={96}>
          <Label x={6} y={13} size={7} color={C.ink} weight={700} font={SANS}>Vendor review · 10/2</Label>
          <Ink x={6} y={30} w={70} delay={0.8} width={1.3} />
          <Ink x={6} y={44} w={56} delay={1.8} width={1.3} />
          <text x={4} y={64} fontFamily={SERIF} fontSize={14} fill={C.gold} className="sb-pop" style={at(3)}>*</text>
          <Ink x={14} y={60} w={62} delay={3.2} width={1.3} />
        </Tablet>
      </Frame>
    ),
  },
  {
    phase: "day",
    time: "13:00 · At the desk",
    title: "Tick it off on paper",
    lines: [
      "Today's planner is waiting on your tablet. Tick a box when something is done, or write a date beside it.",
      "Every ScriptumIQ page is also a form you can write on.",
    ],
    art: (
      <Frame label="A person at a desk ticking a checkbox on a printed planner page">
        <Ground />
        <rect x={180} y={176} width={270} height={10} rx={3} fill={C.borderStrong} />
        <rect x={196} y={186} width={8} height={66} fill={C.borderStrong} />
        <rect x={426} y={186} width={8} height={66} fill={C.borderStrong} />
        <Person x={150} y={252} seated hand={[262, 150]} />
        <Tablet x={250} y={56} w={130} h={120}>
          <Label x={8} y={14} size={9} color={C.ink} weight={700} font={SERIF}>Friday, Oct 2</Label>
          <line x1={8} y1={20} x2={114} y2={20} stroke={C.ink} strokeWidth={1.2} />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <Checkbox x={8} y={30 + i * 18} ticked={i === 1 || i === 3} delay={i === 1 ? 1 : 3.4} />
              <line x1={22} y1={35 + i * 18} x2={i % 2 ? 84 : 98} y2={35 + i * 18} stroke={C.grey} strokeWidth={2} strokeLinecap="round" />
            </g>
          ))}
          <Ink x={88} y={88} w={22} delay={4.4} color={C.ink} width={1.2} />
        </Tablet>
        <rect x={400} y={150} width={24} height={26} rx={3} fill={C.paper} stroke={C.ink} strokeWidth={1.5} />
      </Frame>
    ),
  },
  {
    phase: "day",
    time: "17:30 · Groceries",
    title: "Any notebook counts",
    lines: [
      "A shopping list, a reminder to call the dentist: write it wherever it falls.",
      "ScriptumIQ reads every notebook you chose to watch, not just the ones for work.",
    ],
    art: (
      <Frame label="A person in a grocery aisle writing a list on a tablet">
        <Ground />
        {[0, 1, 2].map((r) => (
          <g key={r}>
            <rect x={300} y={60 + r * 62} width={160} height={6} fill={C.borderStrong} />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={308 + i * 30} y={34 + r * 62} width={20} height={26} rx={3} fill={[C.sun, C.paper, C.border, C.sun, C.paper][(i + r) % 5]} stroke={C.borderStrong} />
            ))}
          </g>
        ))}
        <g>
          <path d="M 40 200 h 80 l -10 34 h -60 Z" fill="none" stroke={C.ink} strokeWidth={3} strokeLinejoin="round" />
          <line x1={30} y1={190} x2={42} y2={200} stroke={C.ink} strokeWidth={3} />
          <circle cx={60} cy={244} r={7} fill={C.ink} />
          <circle cx={104} cy={244} r={7} fill={C.ink} />
        </g>
        <Person x={190} y={252} hand={[206, 168]} />
        <Tablet x={200} y={146} w={62} h={80}>
          <Label x={6} y={12} size={7} color={C.ink} weight={700} font={SANS}>Groceries</Label>
          <Ink x={6} y={26} w={40} delay={0.6} width={1.3} />
          <Ink x={6} y={38} w={30} delay={1.4} width={1.3} />
          <Ink x={6} y={50} w={44} delay={2.2} width={1.3} />
          <text x={4} y={68} fontFamily={SERIF} fontSize={12} fill={C.gold} className="sb-pop" style={at(3.4)}>*</text>
          <Ink x={13} y={64} w={38} delay={3.6} width={1.3} />
        </Tablet>
      </Frame>
    ),
  },
  {
    phase: "day",
    time: "21:00 · On the couch",
    title: "An idea before bed",
    lines: [
      "Ideas count too. Want tonight's pages sooner? Press Sync now in the app or on the website, up to three times a day.",
      "A sync stands in for that night's run, so nothing is read twice.",
    ],
    art: (
      <Frame label="A person on a couch writing, with a phone showing a Sync now button">
        <Ground />
        <rect x={70} y={180} width={250} height={44} rx={10} fill={C.borderStrong} />
        <rect x={70} y={140} width={32} height={84} rx={10} fill={C.borderStrong} />
        <rect x={290} y={150} width={36} height={74} rx={10} fill={C.borderStrong} />
        <rect x={80} y={224} width={10} height={28} fill={C.borderStrong} />
        <rect x={300} y={224} width={10} height={28} fill={C.borderStrong} />
        <line x1={380} y1={252} x2={380} y2={110} stroke={C.ink} strokeWidth={3} />
        <path d="M 360 110 h 40 l -8 -28 h -24 Z" fill={C.sun} stroke={C.gold} />
        <Person x={150} y={226} seated hand={[174, 152]} />
        <Tablet x={168} y={124} w={58} h={76}>
          <Ink x={6} y={18} w={40} delay={0.6} width={1.3} />
          <Ink x={6} y={30} w={36} delay={1.6} width={1.3} />
          <circle cx={25} cy={46} r={9} fill="none" stroke={C.ink} strokeWidth={1.3} pathLength={1} className="sb-ink" style={at(2.6)} />
        </Tablet>
        <Phone x={404} y={130}>
          <Label x={24} y={22} anchor="middle" size={7}>TODAY</Label>
          <g className="sb-pulse">
            <rect x={6} y={56} width={36} height={16} rx={3} fill={C.ink} />
            <Label x={24} y={67} anchor="middle" size={7} color={C.parch} font={SANS} weight={700}>Sync now</Label>
          </g>
        </Phone>
      </Frame>
    ),
  },
  {
    phase: "day",
    time: "Any time · A forwarded invite",
    title: "Meetings from your calendar",
    lines: [
      "An invite arrives in Outlook or Google Calendar. Forward it to your own ScriptumIQ address.",
      "It lands on your planner at the right time, and only from addresses you have confirmed.",
    ],
    art: (
      <Frame label="A calendar invite forwarded by email lands on the planner">
        <Laptop x={36} y={70} w={160}>
          <Label x={10} y={18} size={9}>INVITATION</Label>
          <rect x={10} y={26} width={128} height={30} rx={3} fill={C.sun} />
          <Label x={16} y={40} size={10} color={C.ink} font={SANS} weight={700}>Board review</Label>
          <Label x={16} y={52} size={9} color={C.muted}>THU 10:00–11:00</Label>
          <rect x={10} y={64} width={50} height={14} rx={3} fill={C.ink} />
          <Label x={35} y={74} anchor="middle" size={8} color={C.parch} font={SANS} weight={700}>Forward</Label>
        </Laptop>
        <path d="M 210 120 C 250 90, 290 90, 318 112" fill="none" stroke={C.gold} strokeWidth={2} className="sb-dash" />
        <Envelope className="sb-send" style={at(0.8, { "--dx": "110px", "--dy": "-6px" } as CSSProperties)} x={200} y={106} w={34} />
        <Tablet x={318} y={44} w={128} h={190}>
          <Label x={8} y={14} size={9} color={C.ink} weight={700} font={SERIF}>Thursday</Label>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={i}>
              <Label x={8} y={38 + i * 24} size={7}>{`${9 + i}:00`}</Label>
              <line x1={30} y1={34 + i * 24} x2={116} y2={34 + i * 24} stroke={C.rule} />
            </g>
          ))}
          <g className="sb-pop" style={at(3.6)}>
            <rect x={32} y={60} width={82} height={22} rx={5} fill="#F1EFE7" stroke={C.grey} />
            <Label x={38} y={74} size={8} color={C.ink} font={SANS} weight={700}>Board review</Label>
          </g>
        </Tablet>
      </Frame>
    ),
  },

  // ---- Overnight -------------------------------------------------------------------------
  {
    phase: "night",
    time: "00:01 · While you sleep",
    title: "We read what changed",
    lines: [
      "A minute after midnight, ScriptumIQ reads only the pages you changed that day, and finds the actions, dates, meetings and notes.",
      "Anything it is not sure it read correctly goes to your Inbox to confirm, never straight onto your list.",
    ],
    art: (
      <Frame label="At night, pages fly from the tablet into the turning compass">
        <rect x={0} y={0} width={480} height={280} fill={C.ink} />
        <circle cx={420} cy={50} r={20} fill={C.parch} />
        <circle cx={430} cy={44} r={18} fill={C.ink} />
        {[
          [40, 40],
          [110, 70],
          [200, 30],
          [300, 60],
          [360, 110],
          [70, 140],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2} fill={C.parch} className="sb-twinkle" style={at(i * 0.5)} />
        ))}
        <Tablet x={60} y={150} w={80} h={104}>
          <Ink x={6} y={20} w={50} delay={0} color={C.grey} width={1.2} />
          <Ink x={6} y={34} w={40} delay={0} color={C.grey} width={1.2} />
        </Tablet>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={80} y={170} width={30} height={40} rx={2} fill={C.eink} stroke={C.gold} className="sb-fly" style={at(i * 1.1, { "--dx": "220px", "--dy": "-60px" } as CSSProperties)} />
        ))}
        <Rose cx={330} cy={130} r={34} turning color={C.parch} />
        <Chip x={260} y={196} w={64} text="action" delay={3.4} />
        <Chip x={332} y={196} w={58} text="date" delay={3.8} />
        <Chip x={398} y={196} w={58} text="note" delay={4.2} />
        <g className="sb-pop" style={at(4.8)}>
          <rect x={300} y={232} width={120} height={24} rx={12} fill={C.sun} />
          <Label x={360} y={248} anchor="middle" size={11} color={C.ink} weight={600}>? → INBOX</Label>
        </g>
      </Frame>
    ),
  },

  // ---- The morning -----------------------------------------------------------------------
  {
    phase: "morning",
    time: "7:00 · On your tablet",
    title: "Your pages, ready for your pen",
    lines: [
      "Today's Planner (day, week, month, quarter and year), your living Action List, and Notes from yesterday, under each notebook's name.",
      "Plus the Daily Update and Daily Puzzle if you chose them. Yesterday's copies are filed away in their own folders.",
    ],
    art: (
      <Frame label="Five documents arrive on the tablet: Planner, Action List, Notes, Daily Update, Daily Puzzle">
        <rect x={0} y={0} width={480} height={280} fill={C.sun} opacity={0.35} />
        {[
          ["Planner", "Fri · Oct 2"],
          ["Action List", "12 open"],
          ["Notes - 10-01-2026", "3 notebooks"],
          ["Daily Update", "headlines"],
          ["Daily Puzzle", "crossword"],
        ].map(([name, sub], i) => (
          <g key={name} className="sb-pop" style={at(0.4 + i * 0.7)}>
            <rect x={44 + i * 82} y={70 + (i % 2) * 18} width={74} height={116} rx={5} fill={C.ink2} />
            <rect x={48 + i * 82} y={74 + (i % 2) * 18} width={66} height={104} rx={2} fill={C.eink} />
            <Rose cx={102 + i * 82} cy={86 + (i % 2) * 18} r={4} />
            <line x1={54 + i * 82} y1={96 + (i % 2) * 18} x2={108 + i * 82} y2={96 + (i % 2) * 18} stroke={C.ink} strokeWidth={1.2} />
            {[0, 1, 2, 3].map((r) => (
              <line key={r} x1={54 + i * 82} y1={110 + r * 12 + (i % 2) * 18} x2={(r % 2 ? 96 : 104) + i * 82} y2={110 + r * 12 + (i % 2) * 18} stroke={C.rule} strokeWidth={2} />
            ))}
            <Label x={81 + i * 82} y={206 + (i % 2) * 18} anchor="middle" size={9} color={C.ink} font={SANS} weight={700}>{name}</Label>
            <Label x={81 + i * 82} y={220 + (i % 2) * 18} anchor="middle" size={8}>{sub}</Label>
          </g>
        ))}
      </Frame>
    ),
  },
  {
    phase: "morning",
    time: "7:05 · Email and phone",
    title: "In your inbox, in your pocket",
    lines: [
      "One email per meeting, with its decisions and follow-ups, plus your PDFs if you asked for them.",
      "The phone app and the website show the same lists. Fix, approve or remove anything it was unsure of, and see every day's notes.",
    ],
    art: (
      <Frame label="Emails arriving, and a phone showing the action list with Fix, Approve and Remove">
        <rect x={36} y={40} width={210} height={200} rx={6} fill={C.paper} stroke={C.border} />
        <rect x={36} y={40} width={210} height={28} rx={6} fill={C.ink} />
        <Rose cx={56} cy={54} r={6} color={C.parch} />
        <Label x={70} y={58} size={10} color={C.parch} font={SANS} weight={700}>ScriptumIQ</Label>
        {[
          ["Vendor review — Oct 1 10:00", "3 decisions · 2 follow-ups"],
          ["Board review — Oct 1 15:00", "1 decision"],
          ["ScriptumIQ — 2026-10-02", "5 PDFs attached"],
        ].map(([s, b], i) => (
          <g key={s} className="sb-pop" style={at(0.5 + i * 0.8)}>
            <rect x={48} y={82 + i * 50} width={186} height={40} rx={4} fill={C.parch} stroke={C.border} />
            <Label x={58} y={99 + i * 50} size={10} color={C.ink} font={SANS} weight={700}>{s}</Label>
            <Label x={58} y={113 + i * 50} size={9}>{b}</Label>
          </g>
        ))}
        <g transform="translate(296 36) scale(1.6)">
        <Phone x={0} y={0}>
          <Label x={4} y={12} size={6}>INBOX · 1</Label>
          <Label x={4} y={26} size={7} color={C.ink} font={SANS} weight={600}>Ring Kolb?</Label>
          <Label x={4} y={35} size={5}>PLUME · p.3</Label>
          <g className="sb-pop" style={at(2.4)}>
            <rect x={3} y={40} width={13} height={9} rx={2} fill="none" stroke={C.ink} strokeWidth={0.8} />
            <Label x={9.5} y={46.6} anchor="middle" size={5} color={C.ink} font={SANS} weight={700}>Fix</Label>
            <rect x={18} y={40} width={26} height={9} rx={2} fill={C.ink} />
            <Label x={31} y={46.6} anchor="middle" size={5} color={C.parch} font={SANS} weight={700}>Approve</Label>
            <Label x={4} y={57} size={5} color={C.goldText} font={SANS} weight={700}>Remove</Label>
          </g>
          <Label x={4} y={70} size={6}>OPEN · 12</Label>
          {[0, 1].map((i) => (
            <g key={i}>
              <rect x={4} y={74 + i * 7} width={5} height={5} fill="none" stroke={C.ink} strokeWidth={0.8} />
              <line x1={12} y1={77 + i * 7} x2={40} y2={77 + i * 7} stroke={C.grey} strokeWidth={1.5} />
            </g>
          ))}
        </Phone>
        </g>
      </Frame>
    ),
  },
  {
    phase: "morning",
    time: "Every night after",
    title: "The loop closes",
    lines: [
      "Tick an action on paper and it is gone from tomorrow's list. Fix a misread once and the decoder remembers the word.",
      "You keep writing; ScriptumIQ keeps up.",
    ],
    art: (
      <Frame label="A circle of pen, night and morning, with a ticked box at its centre">
        <circle cx={240} cy={140} r={92} fill="none" stroke={C.borderStrong} strokeWidth={3} strokeDasharray="4 10" className="sb-dash" />
        <g>
          <circle cx={240} cy={48} r={24} fill={C.paper} stroke={C.ink} strokeWidth={2} />
          <line x1={230} y1={58} x2={250} y2={38} stroke={C.gold} strokeWidth={4} strokeLinecap="round" />
          <Label x={240} y={20} anchor="middle" size={10}>YOU WRITE</Label>
        </g>
        <g>
          <circle cx={332} cy={180} r={24} fill={C.ink} />
          <circle cx={326} cy={176} r={9} fill={C.parch} />
          <circle cx={330} cy={173} r={8} fill={C.ink} />
          <Label x={370} y={222} anchor="middle" size={10}>WE READ · 00:01</Label>
        </g>
        <g>
          <circle cx={148} cy={180} r={24} fill={C.sun} stroke={C.gold} strokeWidth={2} />
          <Rose cx={148} cy={180} r={8} />
          <Label x={110} y={222} anchor="middle" size={10}>YOU WAKE UP READY</Label>
        </g>
        <g transform="translate(222 122)">
          <rect width={36} height={36} rx={4} fill={C.paper} stroke={C.ink} strokeWidth={3} />
          <path d="M 7 19 l 8 9 l 15 -20" pathLength={1} className="sb-ink" style={at(0.5)} fill="none" stroke={C.ink} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </Frame>
    ),
  },
];

/**
 * The closing tile, after the morning: the scenes show what it does, this says what it will not.
 * The phone app's tour ends on the same page (apps/mobile/src/storyboard/promises.tsx) — same words.
 */
const PROMISES = [
  "Never keeps your page images beyond 24 hours",
  "Never emails an address it read on one of your pages",
  "Never sends a calendar invite you did not confirm",
  "Never logs what your notes say — counts and hashes only",
];

function Promises() {
  return (
    <section className="sb-promise" aria-labelledby="sb-never">
      <svg viewBox="0 0 320 150" role="img" aria-label="A shield with a tick">
        <path d="M 160 14 L 216 36 L 216 78 C 216 110 190 128 160 138 C 130 128 104 110 104 78 L 104 36 Z" fill="rgba(247,240,227,0.06)" stroke={C.gold} strokeWidth={2.5} />
        <path d="M 137 76 L 154 93 L 187 57" pathLength={1} className="sb-ink" style={at(0.4)} fill="none" stroke={C.gold} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="sb-copy">
        <div className="sb-num">Some promises belong in the code</div>
        <h3 id="sb-never">What it never does</h3>
        <p>These are enforced where it matters, not written in a policy page.</p>
        <ul>
          {PROMISES.map((p) => (
            <li key={p}>
              <span>→</span> {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const PHASES: Record<Scene["phase"], { title: string; when: string }> = {
  setup: { title: "Set up once", when: "Day 1 · about ten minutes" },
  day: { title: "Then just write", when: "During the day" },
  night: { title: "While you sleep", when: "Overnight" },
  morning: { title: "The result", when: "Next morning, and every morning" },
};

export function Storyboard() {
  const order: Scene["phase"][] = ["setup", "day", "night", "morning"];
  let n = 0;
  return (
    <div className="sb">
      {order.map((phase) => (
        <section key={phase} aria-labelledby={`sb-${phase}`}>
          <div className="sb-phase">
            <h2 className="mk-h2" id={`sb-${phase}`}>{PHASES[phase].title}</h2>
            <span className="when">{PHASES[phase].when}</span>
          </div>
          <div className="sb-grid">
            {SCENES.filter((s) => s.phase === phase).map((s) => {
              n += 1;
              return (
                <article className="sb-frame" key={s.title}>
                  {s.art}
                  <div className="sb-copy">
                    <div className="sb-num">{`${String(n).padStart(2, "0")} · ${s.time}`}</div>
                    <h3>{s.title}</h3>
                    {s.lines.map((l, i) => (
                      <p key={i}>{l}</p>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <Promises />
    </div>
  );
}
