/**
 * "See how it works", one scene per swipe: the web's storyboard on a phone.
 *
 * A COPY of the scenes and captions in apps/web/src/components/storyboard/Storyboard.tsx — same
 * order, same words, same drawings at the same coordinates. Change one, change the other: the
 * website and the app tell the same story, and a customer who has seen one will notice if the
 * other says something different. The motion is ./motion.tsx; the pieces are ./parts.tsx.
 */
import type { ReactNode } from "react";
import { Circle, G, Line, Path, Rect } from "react-native-svg";
import { Dashed, Fly, Pop, Pulse, Send, Stroke, Turn, Twinkle } from "./motion";
import { C, Checkbox, Chip, Envelope, Ground, Ink, Label, Laptop, Person, Phone, Rose, Tablet } from "./parts";

export type Phase = "setup" | "day" | "night" | "morning";

export interface Scene {
  phase: Phase;
  time: string;
  title: string;
  lines: readonly string[];
  /** What the picture shows, for a screen reader. */
  label: string;
  art: ReactNode;
}

export const PHASES: Record<Phase, { title: string; when: string }> = {
  setup: { title: "Set up once", when: "Day 1 · about ten minutes" },
  day: { title: "Then just write", when: "During the day" },
  night: { title: "While you sleep", when: "Overnight" },
  morning: { title: "The result", when: "Next morning, and every morning" },
};

export const SCENES: readonly Scene[] = [
  // ---- Day 1 ------------------------------------------------------------------------------
  {
    phase: "setup",
    time: "Day 1 · 1",
    title: "Your invitation",
    lines: [
      "ScriptumIQ opens by invitation. Choose a password and your 14-day free trial begins.",
      "Each time you sign in we also email you a link to finish, so a password on its own never opens your notes.",
    ],
    label: "A person at a laptop receives an invitation and sets a password",
    art: (
      <>
        <Ground />
        <Rect x={250} y={186} width={200} height={10} rx={3} fill={C.borderStrong} />
        <Rect x={262} y={196} width={8} height={56} fill={C.borderStrong} />
        <Rect x={430} y={196} width={8} height={56} fill={C.borderStrong} />
        <Person x={210} y={252} seated hand={[300, 176]} writing={false} />
        <Laptop x={300} y={98} w={140}>
          <Label x={64} y={18} anchor="middle" size={10} color={C.goldText}>YOU&apos;RE INVITED</Label>
          <Rect x={14} y={28} width={100} height={14} rx={2} fill="none" stroke={C.borderStrong} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Pop key={i} delay={1.2 + i * 0.18}>
              <Circle cx={22 + i * 11} cy={35} r={2.6} fill={C.ink} />
            </Pop>
          ))}
          <Pop delay={3} centre={[64, 60]}>
            <Rect x={30} y={52} width={68} height={16} rx={3} fill={C.ink} />
          </Pop>
          <Label x={64} y={63} anchor="middle" size={9} color={C.parch} face="sans" weight={700}>Set password</Label>
        </Laptop>
        <Send dx={230} dy={40}>
          <Envelope x={40} y={60} />
        </Send>
        <Pop delay={3.6} centre={[98, 154]}>
          <Rect x={38} y={140} width={120} height={28} rx={14} fill={C.sun} stroke={C.gold} />
          <Label x={98} y={158} anchor="middle" size={11} color={C.ink} weight={600}>14 DAYS FREE</Label>
        </Pop>
      </>
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
    label: "A code typed on the laptop links it to the tablet",
    art: (
      <>
        <Ground />
        <Laptop x={50} y={92} w={170}>
          <Label x={79} y={22} anchor="middle" size={10}>ONE-TIME CODE</Label>
          {"ABCDEFGH".split("").map((ch, i) => (
            <Pop key={i} delay={0.6 + i * 0.22}>
              <Rect x={10 + i * 18} y={32} width={15} height={22} rx={2} fill={C.parch} stroke={C.borderStrong} />
              <Label x={17.5 + i * 18} y={48} anchor="middle" size={13} color={C.ink} weight={600}>{ch}</Label>
            </Pop>
          ))}
          <Pop delay={2.8} centre={[79, 74]}>
            <Rect x={44} y={66} width={70} height={16} rx={3} fill={C.ink} />
          </Pop>
          <Label x={79} y={77} anchor="middle" size={9} color={C.parch} face="sans" weight={700}>Pair</Label>
        </Laptop>
        <Dashed d="M 240 150 C 280 110, 320 110, 352 140" color={C.gold} width={2.5} />
        <Tablet x={352} y={104} w={84} h={112}>
          <Pop delay={3.4} centre={[38, 60]}>
            <Circle cx={38} cy={44} r={18} fill={C.sun} />
            <Path d="M 29 44 l 7 7 l 12 -14" fill="none" stroke={C.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            <Label x={38} y={84} anchor="middle" size={8} color={C.ink}>PAIRED</Label>
          </Pop>
        </Tablet>
      </>
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
    label: "Folders being ticked, a clock set to the user's time, and a choice of where notebooks go",
    art: (
      <>
        <Rect x={34} y={34} width={190} height={200} rx={6} fill={C.paper} stroke={C.border} />
        <Label x={50} y={58}>WATCH FOLDERS</Label>
        {(
          [
            ["Work", true],
            ["Meetings", true],
            ["Journal", true],
            ["Groceries", true],
            ["PDFs", false],
          ] as const
        ).map(([name, on], i) => (
          <G key={name}>
            <Rect x={50} y={72 + i * 30} width={13} height={13} rx={2} fill="none" stroke={C.ink} strokeWidth={1.4} />
            {on ? <Stroke d={`M 52 ${79 + i * 30} l 3.5 4 l 6 -8`} length={16} delay={0.5 + i * 0.5} color={C.ink} width={2} /> : null}
            <Label x={74} y={83 + i * 30} size={13} color={on ? C.ink : C.meta} face="sans" weight={500}>{name}</Label>
          </G>
        ))}
        <G transform="translate(320 92)">
          <Circle r={40} fill={C.paper} stroke={C.ink} strokeWidth={3} />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
            <Line key={h} x1={0} y1={-34} x2={0} y2={-30} stroke={C.ink} strokeWidth={2} rotation={h * 30} />
          ))}
          <Line x1={0} y1={0} x2={0} y2={-26} stroke={C.ink} strokeWidth={3} strokeLinecap="round" />
          <Turn>
            <Line x1={0} y1={0} x2={0} y2={-34} stroke={C.gold} strokeWidth={2} strokeLinecap="round" />
          </Turn>
          <Label x={0} y={62} anchor="middle" size={10}>YOUR TIMEZONE</Label>
        </G>
        <Chip x={262} y={182} w={110} text="ScriptumIQ folder" delay={3} dark />
        <Chip x={380} y={182} w={72} text="or root" delay={3.4} />
        <Label x={262} y={226} size={10}>WHERE NOTEBOOKS LAND</Label>
      </>
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
    label: "A page marked with an asterisk, an underline and TODO, beside a handwriting sample sheet",
    art: (
      <>
        <Tablet x={40} y={30} w={170} h={220}>
          <Label x={12} y={22} size={9}>WORK · p.12</Label>
          <Pop delay={0.4}>
            <Label x={12} y={52} size={22} color={C.gold} face="serif">*</Label>
          </Pop>
          <Ink x={28} y={48} w={110} delay={0.6} />
          <Ink x={12} y={82} w={120} delay={1.8} />
          <Stroke d="M 12 90 h 120" length={120} delay={2.6} color={C.gold} width={2.2} cap="butt" />
          <Pop delay={3.2}>
            <Label x={12} y={122} size={11} color={C.ink} weight={700} face="sans">TODO</Label>
          </Pop>
          <Ink x={54} y={118} w={90} delay={3.4} />
          <Ink x={12} y={150} w={130} delay={4.4} color={C.grey} />
          <Ink x={12} y={176} w={100} delay={5} color={C.grey} />
        </Tablet>
        <Chip x={234} y={48} w={150} text="*  =  an action" delay={1} dark />
        <Chip x={234} y={82} w={150} text="underline  =  follow-up" delay={2.6} />
        <Chip x={234} y={116} w={150} text="TODO  =  an action" delay={3.4} />
        <Pop delay={4.4}>
          <Rect x={234} y={160} width={206} height={84} rx={4} fill={C.eink} stroke={C.borderStrong} />
          <Label x={246} y={180} size={9}>HANDWRITING SAMPLE</Label>
          <Label x={246} y={198} size={10} color={C.muted} face="serif">&quot;Send Priya the Q4 deck by Friday…&quot;</Label>
          <Ink x={246} y={222} w={170} delay={5.2} />
        </Pop>
      </>
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
    label: "Options switching on: Daily Update, Daily Puzzle, PDFs by email, meeting emails, forwarding address",
    art: (
      <>
        {(
          [
            ["Daily Update · your headlines", 0.4],
            ["Daily Puzzle", 1.2],
            ["PDFs by email", 2],
            ["An email per meeting", 2.8],
            ["you@cal.scriptumiq.com", 3.6],
          ] as const
        ).map(([text, d], i) => (
          <Pop key={text} delay={d} centre={[240, 51 + i * 44]}>
            <Rect x={60} y={34 + i * 44} width={360} height={34} rx={6} fill={C.paper} stroke={C.border} />
            <Label x={78} y={56 + i * 44} size={14} color={C.ink} face="sans" weight={500}>{text}</Label>
            <Rect x={358} y={42 + i * 44} width={40} height={18} rx={9} fill={C.ink} />
            <Circle cx={389} cy={51 + i * 44} r={7} fill={C.gold} />
          </Pop>
        ))}
      </>
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
    label: "Three people at a meeting table, one writing on a tablet",
    art: (
      <>
        <Ground />
        <Rect x={60} y={170} width={360} height={12} rx={4} fill={C.borderStrong} />
        <Rect x={80} y={182} width={10} height={70} fill={C.borderStrong} />
        <Rect x={390} y={182} width={10} height={70} fill={C.borderStrong} />
        <Person x={110} y={252} seated tone={C.ink2} />
        <Person x={370} y={252} seated tone={C.ink2} />
        <Person x={240} y={252} seated hand={[262, 164]} />
        <Pop delay={0.3}>
          <Circle cx={128} cy={96} r={3} fill={C.meta} />
          <Circle cx={138} cy={92} r={3} fill={C.meta} />
          <Circle cx={148} cy={96} r={3} fill={C.meta} />
        </Pop>
        <Tablet x={250} y={70} w={96} h={96}>
          <Label x={6} y={13} size={7} color={C.ink} weight={700} face="sans">Vendor review · 10/2</Label>
          <Ink x={6} y={30} w={70} delay={0.8} width={1.3} />
          <Ink x={6} y={44} w={56} delay={1.8} width={1.3} />
          <Pop delay={3}>
            <Label x={4} y={64} size={14} color={C.gold} face="serif">*</Label>
          </Pop>
          <Ink x={14} y={60} w={62} delay={3.2} width={1.3} />
        </Tablet>
      </>
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
    label: "A person at a desk ticking a checkbox on a printed planner page",
    art: (
      <>
        <Ground />
        <Rect x={180} y={176} width={270} height={10} rx={3} fill={C.borderStrong} />
        <Rect x={196} y={186} width={8} height={66} fill={C.borderStrong} />
        <Rect x={426} y={186} width={8} height={66} fill={C.borderStrong} />
        <Person x={150} y={252} seated hand={[262, 150]} />
        <Tablet x={250} y={56} w={130} h={120}>
          <Label x={8} y={14} size={9} color={C.ink} weight={700} face="serif">Friday, Oct 2</Label>
          <Line x1={8} y1={20} x2={114} y2={20} stroke={C.ink} strokeWidth={1.2} />
          {[0, 1, 2, 3].map((i) => (
            <G key={i}>
              <Checkbox x={8} y={30 + i * 18} ticked={i === 1 || i === 3} delay={i === 1 ? 1 : 3.4} />
              <Line x1={22} y1={35 + i * 18} x2={i % 2 ? 84 : 98} y2={35 + i * 18} stroke={C.grey} strokeWidth={2} strokeLinecap="round" />
            </G>
          ))}
          <Ink x={88} y={88} w={22} delay={4.4} color={C.ink} width={1.2} />
        </Tablet>
        <Rect x={400} y={150} width={24} height={26} rx={3} fill={C.paper} stroke={C.ink} strokeWidth={1.5} />
      </>
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
    label: "A person in a grocery aisle writing a list on a tablet",
    art: (
      <>
        <Ground />
        {[0, 1, 2].map((r) => (
          <G key={r}>
            <Rect x={300} y={60 + r * 62} width={160} height={6} fill={C.borderStrong} />
            {[0, 1, 2, 3, 4].map((i) => (
              <Rect key={i} x={308 + i * 30} y={34 + r * 62} width={20} height={26} rx={3} fill={[C.sun, C.paper, C.border, C.sun, C.paper][(i + r) % 5]} stroke={C.borderStrong} />
            ))}
          </G>
        ))}
        <G>
          <Path d="M 40 200 h 80 l -10 34 h -60 Z" fill="none" stroke={C.ink} strokeWidth={3} strokeLinejoin="round" />
          <Line x1={30} y1={190} x2={42} y2={200} stroke={C.ink} strokeWidth={3} />
          <Circle cx={60} cy={244} r={7} fill={C.ink} />
          <Circle cx={104} cy={244} r={7} fill={C.ink} />
        </G>
        <Person x={190} y={252} hand={[206, 168]} />
        <Tablet x={200} y={146} w={62} h={80}>
          <Label x={6} y={12} size={7} color={C.ink} weight={700} face="sans">Groceries</Label>
          <Ink x={6} y={26} w={40} delay={0.6} width={1.3} />
          <Ink x={6} y={38} w={30} delay={1.4} width={1.3} />
          <Ink x={6} y={50} w={44} delay={2.2} width={1.3} />
          <Pop delay={3.4}>
            <Label x={4} y={68} size={12} color={C.gold} face="serif">*</Label>
          </Pop>
          <Ink x={13} y={64} w={38} delay={3.6} width={1.3} />
        </Tablet>
      </>
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
    label: "A person on a couch writing, with a phone showing a Sync now button",
    art: (
      <>
        <Ground />
        <Rect x={70} y={180} width={250} height={44} rx={10} fill={C.borderStrong} />
        <Rect x={70} y={140} width={32} height={84} rx={10} fill={C.borderStrong} />
        <Rect x={290} y={150} width={36} height={74} rx={10} fill={C.borderStrong} />
        <Rect x={80} y={224} width={10} height={28} fill={C.borderStrong} />
        <Rect x={300} y={224} width={10} height={28} fill={C.borderStrong} />
        <Line x1={380} y1={252} x2={380} y2={110} stroke={C.ink} strokeWidth={3} />
        <Path d="M 360 110 h 40 l -8 -28 h -24 Z" fill={C.sun} stroke={C.gold} />
        <Person x={150} y={226} seated hand={[174, 152]} />
        <Tablet x={168} y={124} w={58} h={76}>
          <Ink x={6} y={18} w={40} delay={0.6} width={1.3} />
          <Ink x={6} y={30} w={36} delay={1.6} width={1.3} />
          <Stroke d="M 16 46 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0" length={57} delay={2.6} color={C.ink} width={1.3} />
        </Tablet>
        <Phone x={404} y={130}>
          <Label x={24} y={22} anchor="middle" size={7}>TODAY</Label>
          <Pulse centre={[24, 64]}>
            <Rect x={6} y={56} width={36} height={16} rx={3} fill={C.ink} />
            <Label x={24} y={67} anchor="middle" size={7} color={C.parch} face="sans" weight={700}>Sync now</Label>
          </Pulse>
        </Phone>
      </>
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
    label: "A calendar invite forwarded by email lands on the planner",
    art: (
      <>
        <Laptop x={36} y={70} w={160}>
          <Label x={10} y={18} size={9}>INVITATION</Label>
          <Rect x={10} y={26} width={128} height={30} rx={3} fill={C.sun} />
          <Label x={16} y={40} size={10} color={C.ink} face="sans" weight={700}>Board review</Label>
          <Label x={16} y={52} size={9} color={C.muted}>THU 10:00–11:00</Label>
          <Rect x={10} y={64} width={50} height={14} rx={3} fill={C.ink} />
          <Label x={35} y={74} anchor="middle" size={8} color={C.parch} face="sans" weight={700}>Forward</Label>
        </Laptop>
        <Dashed d="M 210 120 C 250 90, 290 90, 318 112" color={C.gold} width={2} />
        <Send delay={0.8} dx={110} dy={-6}>
          <Envelope x={200} y={106} w={34} />
        </Send>
        <Tablet x={318} y={44} w={128} h={190}>
          <Label x={8} y={14} size={9} color={C.ink} weight={700} face="serif">Thursday</Label>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <G key={i}>
              <Label x={8} y={38 + i * 24} size={7}>{`${9 + i}:00`}</Label>
              <Line x1={30} y1={34 + i * 24} x2={116} y2={34 + i * 24} stroke={C.rule} />
            </G>
          ))}
          <Pop delay={3.6} centre={[73, 71]}>
            <Rect x={32} y={60} width={82} height={22} rx={5} fill="#F1EFE7" stroke={C.grey} />
            <Label x={38} y={74} size={8} color={C.ink} face="sans" weight={700}>Board review</Label>
          </Pop>
        </Tablet>
      </>
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
    label: "At night, pages fly from the tablet into the turning compass",
    art: (
      <>
        <Rect x={0} y={0} width={480} height={280} fill={C.ink} />
        <Circle cx={420} cy={50} r={20} fill={C.parch} />
        <Circle cx={430} cy={44} r={18} fill={C.ink} />
        {(
          [
            [40, 40],
            [110, 70],
            [200, 30],
            [300, 60],
            [360, 110],
            [70, 140],
          ] as const
        ).map(([x, y], i) => (
          <Twinkle key={i} delay={i * 0.5}>
            <Circle cx={x} cy={y} r={2} fill={C.parch} />
          </Twinkle>
        ))}
        <Tablet x={60} y={150} w={80} h={104}>
          <Ink x={6} y={20} w={50} delay={0} color={C.grey} width={1.2} />
          <Ink x={6} y={34} w={40} delay={0} color={C.grey} width={1.2} />
        </Tablet>
        {[0, 1, 2].map((i) => (
          <Fly key={i} delay={i * 1.1} dx={220} dy={-60} centre={[95, 190]}>
            <Rect x={80} y={170} width={30} height={40} rx={2} fill={C.eink} stroke={C.gold} />
          </Fly>
        ))}
        <Rose cx={330} cy={130} r={34} turning color={C.parch} />
        <Chip x={260} y={196} w={64} text="action" delay={3.4} />
        <Chip x={332} y={196} w={58} text="date" delay={3.8} />
        <Chip x={398} y={196} w={58} text="note" delay={4.2} />
        <Pop delay={4.8} centre={[360, 244]}>
          <Rect x={300} y={232} width={120} height={24} rx={12} fill={C.sun} />
          <Label x={360} y={248} anchor="middle" size={11} color={C.ink} weight={600}>? → INBOX</Label>
        </Pop>
      </>
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
    label: "Five documents arrive on the tablet: Planner, Action List, Notes, Daily Update, Daily Puzzle",
    art: (
      <>
        <Rect x={0} y={0} width={480} height={280} fill={C.sun} opacity={0.35} />
        {(
          [
            ["Planner", "Fri · Oct 2"],
            ["Action List", "12 open"],
            ["Notes - 10-01-2026", "3 notebooks"],
            ["Daily Update", "headlines"],
            ["Daily Puzzle", "crossword"],
          ] as const
        ).map(([name, sub], i) => {
          const dy = (i % 2) * 18;
          return (
            <Pop key={name} delay={0.4 + i * 0.7} centre={[81 + i * 82, 128 + dy]}>
              <Rect x={44 + i * 82} y={70 + dy} width={74} height={116} rx={5} fill={C.ink2} />
              <Rect x={48 + i * 82} y={74 + dy} width={66} height={104} rx={2} fill={C.eink} />
              <Rose cx={102 + i * 82} cy={86 + dy} r={4} />
              <Line x1={54 + i * 82} y1={96 + dy} x2={108 + i * 82} y2={96 + dy} stroke={C.ink} strokeWidth={1.2} />
              {[0, 1, 2, 3].map((r) => (
                <Line key={r} x1={54 + i * 82} y1={110 + r * 12 + dy} x2={(r % 2 ? 96 : 104) + i * 82} y2={110 + r * 12 + dy} stroke={C.rule} strokeWidth={2} />
              ))}
              <Label x={81 + i * 82} y={206 + dy} anchor="middle" size={9} color={C.ink} face="sans" weight={700}>{name}</Label>
              <Label x={81 + i * 82} y={220 + dy} anchor="middle" size={8}>{sub}</Label>
            </Pop>
          );
        })}
      </>
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
    label: "Emails arriving, and a phone showing the action list with Fix, Approve and Remove",
    art: (
      <>
        <Rect x={36} y={40} width={210} height={200} rx={6} fill={C.paper} stroke={C.border} />
        <Rect x={36} y={40} width={210} height={28} rx={6} fill={C.ink} />
        <Rose cx={56} cy={54} r={6} color={C.parch} />
        <Label x={70} y={58} size={10} color={C.parch} face="sans" weight={700}>ScriptumIQ</Label>
        {(
          [
            ["Vendor review — Oct 1 10:00", "3 decisions · 2 follow-ups"],
            ["Board review — Oct 1 15:00", "1 decision"],
            ["ScriptumIQ — 2026-10-02", "5 PDFs attached"],
          ] as const
        ).map(([s, b], i) => (
          <Pop key={s} delay={0.5 + i * 0.8} centre={[141, 102 + i * 50]}>
            <Rect x={48} y={82 + i * 50} width={186} height={40} rx={4} fill={C.parch} stroke={C.border} />
            <Label x={58} y={99 + i * 50} size={10} color={C.ink} face="sans" weight={700}>{s}</Label>
            <Label x={58} y={113 + i * 50} size={9}>{b}</Label>
          </Pop>
        ))}
        <G transform="translate(296 36) scale(1.6)">
          <Phone x={0} y={0}>
            <Label x={4} y={12} size={6}>INBOX · 1</Label>
            <Label x={4} y={26} size={7} color={C.ink} face="sans" weight={600}>Ring Kolb?</Label>
            <Label x={4} y={35} size={5}>PLUME · p.3</Label>
            <Pop delay={2.4}>
              <Rect x={3} y={40} width={13} height={9} rx={2} fill="none" stroke={C.ink} strokeWidth={0.8} />
              <Label x={9.5} y={46.6} anchor="middle" size={5} color={C.ink} face="sans" weight={700}>Fix</Label>
              <Rect x={18} y={40} width={26} height={9} rx={2} fill={C.ink} />
              <Label x={31} y={46.6} anchor="middle" size={5} color={C.parch} face="sans" weight={700}>Approve</Label>
              <Label x={4} y={57} size={5} color={C.goldText} face="sans" weight={700}>Remove</Label>
            </Pop>
            <Label x={4} y={70} size={6}>OPEN · 12</Label>
            {[0, 1].map((i) => (
              <G key={i}>
                <Rect x={4} y={74 + i * 7} width={5} height={5} fill="none" stroke={C.ink} strokeWidth={0.8} />
                <Line x1={12} y1={77 + i * 7} x2={40} y2={77 + i * 7} stroke={C.grey} strokeWidth={1.5} />
              </G>
            ))}
          </Phone>
        </G>
      </>
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
    label: "A circle of pen, night and morning, with a ticked box at its centre",
    art: (
      <>
        <Dashed d="M 148 140 a 92 92 0 1 0 184 0 a 92 92 0 1 0 -184 0" color={C.borderStrong} width={3} pattern={[4, 10]} />
        <G>
          <Circle cx={240} cy={48} r={24} fill={C.paper} stroke={C.ink} strokeWidth={2} />
          <Line x1={230} y1={58} x2={250} y2={38} stroke={C.gold} strokeWidth={4} strokeLinecap="round" />
          <Label x={240} y={20} anchor="middle" size={10}>YOU WRITE</Label>
        </G>
        <G>
          <Circle cx={332} cy={180} r={24} fill={C.ink} />
          <Circle cx={326} cy={176} r={9} fill={C.parch} />
          <Circle cx={330} cy={173} r={8} fill={C.ink} />
          <Label x={370} y={222} anchor="middle" size={10}>WE READ · 00:01</Label>
        </G>
        <G>
          <Circle cx={148} cy={180} r={24} fill={C.sun} stroke={C.gold} strokeWidth={2} />
          <Rose cx={148} cy={180} r={8} />
          <Label x={110} y={222} anchor="middle" size={10}>YOU WAKE UP READY</Label>
        </G>
        <G transform="translate(222 122)">
          <Rect width={36} height={36} rx={4} fill={C.paper} stroke={C.ink} strokeWidth={3} />
          <Stroke d="M 7 19 l 8 9 l 15 -20" length={38} delay={0.5} color={C.ink} width={4} join="round" />
        </G>
      </>
    ),
  },
];
