"use client";
import { useEffect, useRef, useState } from "react";
import { HERO_H, HERO_W, LAYERS, type LayerName } from "./layers";
import "./hero.css";

/**
 * The website hero: the supplied dayMarkable artwork builds itself over ten seconds and then
 * holds with only ambient motion. Every visible element is a cut-out of the reference image
 * (see scripts/hero-slice.py) that flies from its own direction and depth into the exact
 * position the artwork gives it; the last step fades the reference frame itself over the top,
 * so the resting composition is the source image to the pixel. The wordmark is the one part
 * set live, so it reads dayMarkable — capital M — in the brand typeface.
 *
 * Timeline (seconds): 0–1.5 environment · 1.5–3 icons + trails · 3–4.5 mechanism + brain ·
 * 4.5–6.5 task cards · 6.5–8 brand · 8–9 convergence · 9–10 hold.
 */

interface Flight {
  delay: number;
  dur: number;
  dx?: string;
  dy?: string;
  s?: number;
  r?: string;
  b?: string;
  /** Horizontal leg on its own easing so the path bends. */
  ax?: string;
}

const PLAN: Record<Exclude<LayerName, "trails" | "line_left" | "line_right">, Flight> = {
  // 1.5–3.0 productivity icons, from every side and depth
  icon_note: { delay: 1.5, dur: 1.25, ax: "-22cqw", dy: "5cqw", s: 0.7, b: "6px" },
  icon_calendar: { delay: 1.62, dur: 1.2, ax: "-6cqw", dy: "-19cqw", s: 0.9, b: "3px" },
  icon_bulb_hi: { delay: 1.74, dur: 1.2, ax: "15cqw", dy: "-11cqw", s: 1.4, b: "6px" },
  icon_bulb_mid: { delay: 1.7, dur: 1.25, ax: "-3cqw", dy: "17cqw", s: 0.55, b: "5px" },
  icon_people: { delay: 1.86, dur: 1.2, ax: "-17cqw", dy: "13cqw", s: 1.45, b: "7px" },
  icon_checklist: { delay: 1.96, dur: 1.15, ax: "5cqw", dy: "19cqw", s: 1.1, b: "4px" },
  icon_gear: { delay: 2.06, dur: 1.05, ax: "9cqw", dy: "7cqw", s: 0.4, b: "6px" },
  // 3.0–4.5 the mechanism assembles; the brain arrives last from deep in the scene
  mech_pedestal: { delay: 3.0, dur: 0.95, dy: "13cqw", s: 1.25, b: "6px" },
  mech_ring_outer: { delay: 3.1, dur: 1.25, dx: "-21cqw", r: "-42deg", s: 0.92, b: "4px" },
  mech_ring_inner: { delay: 3.28, dur: 1.15, dx: "17cqw", r: "38deg", s: 0.85, b: "4px" },
  mech_left: { delay: 3.45, dur: 0.95, dy: "7cqw", s: 1.55, b: "8px" },
  mech_right: { delay: 3.52, dur: 0.95, dx: "7cqw", s: 0.5, b: "6px" },
  brain: { delay: 3.85, dur: 0.75, s: 0.22, b: "10px" },
  // 4.5–6.5 organised output
  card_today: { delay: 4.5, dur: 1.05, dx: "17cqw", dy: "-15cqw", s: 0.95, b: "3px" },
  card_week: { delay: 4.95, dur: 1.1, dx: "23cqw", dy: "-2cqw", s: 0.68, b: "6px" },
  card_month: { delay: 5.4, dur: 1.05, dy: "17cqw", s: 1.32, b: "7px" },
  card_quarter: { delay: 5.85, dur: 1.05, dx: "19cqw", dy: "15cqw", s: 1.05, b: "4px" },
  // 6.5–8.0 brand assembly
  emblem: { delay: 6.5, dur: 1.25, s: 0.55, r: "-8deg", b: "8px" },
  tagline: { delay: 7.35, dur: 0.85, dy: "2.6cqw", b: "2px" },
  overnight: { delay: 7.2, dur: 0.85, dy: "2.2cqw", b: "1px" },
  ai_text: { delay: 7.45, dur: 0.85, dy: "2.2cqw", b: "1px" },
  star: { delay: 7.85, dur: 0.6, s: 0, r: "90deg" },
};

const T_CONVERGE = 8.0;
const T_HOLD = 9.2;

function pct(n: number, of: number): string {
  return `${(n / of) * 100}%`;
}

function box(name: LayerName): React.CSSProperties {
  const [x, y, w] = LAYERS[name];
  return { left: pct(x, HERO_W), top: pct(y, HERO_H), width: pct(w, HERO_W) };
}

function vars(f: Flight): React.CSSProperties {
  const v: Record<string, string | number> = { "--delay": `${f.delay}s`, "--dur": `${f.dur}s` };
  if (f.dx) v["--dx"] = f.dx;
  if (f.dy) v["--dy"] = f.dy;
  if (f.s !== undefined) v["--s"] = f.s;
  if (f.r) v["--r"] = f.r;
  if (f.b) v["--b"] = f.b;
  if (f.ax) v["--ax"] = f.ax;
  return v as React.CSSProperties;
}

function Layer({ name }: { name: keyof typeof PLAN }) {
  const f = PLAN[name];
  const img = <img src={`/hero/layers/${name}.webp`} alt="" draggable={false} />;
  if (f.ax) {
    return (
      <div className="arc" style={{ ...box(name), ...vars(f) }}>
        <div className="hl fly" style={vars({ ...f, ax: undefined })}>{img}</div>
      </div>
    );
  }
  return <div className="hl fly" style={{ ...box(name), ...vars(f) }}>{img}</div>;
}

// Scene anchors in source pixels (brain centre, icon centres, card centres).
const BRAIN = [478, 395] as const;
const ICON_NAMES = ["icon_note", "icon_calendar", "icon_bulb_hi", "icon_bulb_mid", "icon_people", "icon_checklist", "icon_gear"] as const;
const CARD_NAMES = ["card_today", "card_week", "card_month", "card_quarter"] as const;
const centre = (n: LayerName) => [LAYERS[n][0] + LAYERS[n][2] / 2, LAYERS[n][1] + LAYERS[n][3] / 2] as const;

interface Mote { x: number; y: number; vx: number; vy: number; r: number; ph: number; sp: number; kind: "gold" | "star" }
interface Flow { a: readonly [number, number]; b: readonly [number, number]; start: number; dur: number; wobble: number; size: number }

/** Warm-gold particles: ambient motes along the trails, twinkling stars, and the 8–9 s convergence. */
function useParticles(canvasRef: React.RefObject<HTMLCanvasElement | null>, stageRef: React.RefObject<HTMLDivElement | null>, epoch: number) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const motes: Mote[] = [];
    for (let i = 0; i < 46; i++) motes.push({ x: rand(40, 420), y: rand(300, 540), vx: rand(6, 16), vy: rand(-4, 2), r: rand(0.6, 1.6), ph: rand(0, 6.28), sp: rand(0.6, 1.6), kind: "gold" });
    for (let i = 0; i < 34; i++) motes.push({ x: rand(20, 1120), y: rand(8, 240), vx: rand(0.4, 1.2), vy: 0, r: rand(0.4, 1.0), ph: rand(0, 6.28), sp: rand(0.4, 1.2), kind: "star" });
    const flows: Flow[] = [];
    for (let i = 0; i < 64; i++) {
      flows.push({
        a: centre(ICON_NAMES[i % ICON_NAMES.length]!),
        b: centre(CARD_NAMES[(i * 7) % CARD_NAMES.length]!),
        start: T_CONVERGE + rand(0, 0.55),
        dur: rand(0.75, 1.05),
        wobble: rand(-40, 40),
        size: rand(1.2, 2.6),
      });
    }

    // Sync to the CSS timeline so the convergence lands where the keyframes expect it.
    const animStart = (() => {
      const a = stage.getAnimations({ subtree: true }).find((x) => x.playState === "running" || x.playState === "paused");
      const ct = a && typeof a.currentTime === "number" ? a.currentTime : 0;
      return performance.now() - ct;
    })();

    let raf = 0;
    let last = performance.now();
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);

    const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

    const frame = (now: number) => {
      const t = (now - animStart) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = canvas.width / HERO_W;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";

      // ambient motes fade in with the trails and stay for the hold
      const ambient = Math.max(0, Math.min(1, (t - 1.6) / 1.2));
      if (ambient > 0) {
        for (const m of motes) {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          if (m.kind === "gold") {
            if (m.x > 430) { m.x = 40; m.y = rand(300, 540); }
            const tw = 0.45 + 0.55 * Math.abs(Math.sin(m.ph + t * m.sp));
            const hidden = t < T_HOLD ? 0.7 : 0.55; // quieter once the composition rests
            ctx.fillStyle = `rgba(255, 205, 120, ${ambient * tw * hidden})`;
          } else {
            if (m.x > 1130) m.x = 10;
            const tw = 0.25 + 0.75 * Math.abs(Math.sin(m.ph + t * m.sp * 0.7));
            ctx.fillStyle = `rgba(235, 240, 255, ${ambient * tw * 0.55})`;
          }
          ctx.beginPath();
          ctx.arc(m.x * k, m.y * k, m.r * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 8.0–9.2 s: notes → brain → organised priorities
      for (const f of flows) {
        const p = (t - f.start) / f.dur;
        if (p <= 0 || p >= 1) continue;
        const e = ease(p);
        // quadratic curve through the brain, with a little lateral wobble
        const cx = BRAIN[0] + f.wobble;
        const cy = BRAIN[1] + f.wobble * 0.4;
        const x = (1 - e) * (1 - e) * f.a[0] + 2 * (1 - e) * e * cx + e * e * f.b[0];
        const y = (1 - e) * (1 - e) * f.a[1] + 2 * (1 - e) * e * cy + e * e * f.b[1];
        const nearBrain = Math.exp(-Math.pow((e - 0.5) / 0.14, 2));
        const alpha = Math.sin(p * Math.PI) * 0.9;
        const rr = f.size * (1 + 0.6 * nearBrain);
        const g = ctx.createRadialGradient(x * k, y * k, 0, x * k, y * k, rr * 3 * k);
        const gold = `rgba(255, 200, 110, ${alpha})`;
        const blue = `rgba(120, 190, 255, ${alpha})`;
        g.addColorStop(0, nearBrain > 0.5 ? blue : gold);
        g.addColorStop(0.35, `rgba(255, 190, 90, ${alpha * 0.35})`);
        g.addColorStop(1, "rgba(255, 190, 90, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x * k, y * k, rr * 3 * k, 0, Math.PI * 2);
        ctx.fill();
      }

      // a restrained blue breath from the brain while the information passes through it
      const breath = Math.max(0, Math.min(1, (t - 8.15) / 0.4)) * Math.max(0, 1 - Math.max(0, t - 8.55) / 0.7);
      if (breath > 0) {
        const g = ctx.createRadialGradient(BRAIN[0] * k, BRAIN[1] * k, 0, BRAIN[0] * k, BRAIN[1] * k, 95 * k);
        g.addColorStop(0, `rgba(90, 170, 255, ${0.28 * breath})`);
        g.addColorStop(1, "rgba(90, 170, 255, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [canvasRef, stageRef, epoch]);
}

export function HeroScene() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(true);
  useParticles(canvasRef, stageRef, epoch);

  function replay() {
    // Dropping the play attribute for one frame restarts every CSS animation from zero.
    setPlaying(false);
    requestAnimationFrame(() => {
      setPlaying(true);
      setEpoch((e) => e + 1);
    });
  }

  const glowSize = 150;
  return (
    <div ref={stageRef} className="hero-stage" data-play={playing ? "1" : "0"} role="img" aria-label="Handwritten notes flow through dayMarkable's AI overnight and come back as organised task lists for today, this week, this month and next quarter.">
      <img className="hero-base" src="/hero/base.webp" alt="" width={HERO_W} height={HERO_H} draggable={false} />
      <img className="hero-trails" src="/hero/layers/trails.webp" alt="" style={box("trails")} draggable={false} />

      {ICON_NAMES.map((n) => <Layer key={n} name={n} />)}

      <Layer name="mech_pedestal" />
      <Layer name="mech_ring_outer" />
      <Layer name="mech_left" />
      <Layer name="mech_right" />
      <Layer name="mech_ring_inner" />
      <div className="hero-glow" style={{ left: pct(BRAIN[0] - glowSize / 2, HERO_W), top: pct(BRAIN[1] - glowSize / 2, HERO_H), width: pct(glowSize, HERO_W), aspectRatio: "1" }} />
      <Layer name="brain" />
      <div className="hero-pulse" style={{ left: pct(BRAIN[0] - 60, HERO_W), top: pct(BRAIN[1] - 60, HERO_H), width: pct(120, HERO_W), aspectRatio: "1" }} />

      {CARD_NAMES.map((n) => <Layer key={n} name={n} />)}

      <Layer name="emblem" />
      <div className="hero-wordmark" style={{ left: pct(672, HERO_W), top: pct(74, HERO_H), transform: "translateX(-50%)" }} aria-hidden>
        <span className="day hl fly" style={vars({ delay: 6.85, dur: 0.95, dx: "-7cqw", b: "2px" })}>day</span>
        <span className="mark hl fly" style={vars({ delay: 6.85, dur: 0.95, dx: "7cqw", b: "2px" })}>Markable</span>
      </div>
      <Layer name="tagline" />

      <Layer name="overnight" />
      <img className="grow-l" src="/hero/layers/line_left.webp" alt="" style={{ ...box("line_left"), "--delay": "7.3s" } as React.CSSProperties} draggable={false} />
      <img className="grow-r" src="/hero/layers/line_right.webp" alt="" style={{ ...box("line_right"), "--delay": "7.3s" } as React.CSSProperties} draggable={false} />
      <Layer name="ai_text" />
      <Layer name="star" />

      <img className="hero-final" src="/hero/final.webp" alt="" width={HERO_W} height={HERO_H} draggable={false} />
      <canvas ref={canvasRef} className="hero-canvas" aria-hidden />
      <button type="button" className="hero-replay" onClick={replay} aria-label="Replay the hero animation">Replay</button>
    </div>
  );
}
