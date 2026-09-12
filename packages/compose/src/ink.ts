/**
 * Pen strokes, kept as strokes.
 *
 * The render service builds an SVG of the page's ink and then flattens it to a PNG for the
 * decoder. This reads that SVG back so a drawing can be put into a composed notebook as real
 * vectors rather than a pasted screenshot: crisp at any size, and a few kilobytes.
 *
 * Nothing here interprets anything. A diagram goes onto the page as the same strokes the pen
 * made, because the ink is the authority and a redrawn diagram is not the customer's drawing.
 */
import type { InkDrawing, InkStroke } from "@daymarkable/core";

/** `<polyline points="x,y x,y">` is what rmc writes; a path `d` is what pdf-lib draws. */
function pointsToPath(points: string): string | null {
  const nums = points.trim().split(/[\s,]+/).map(Number);
  if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) return null;
  const parts: string[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) parts.push(`${i === 0 ? "M" : "L"} ${nums[i]} ${nums[i + 1]}`);
  // A single tap is a dot, which a two-point line of zero length would not show.
  if (parts.length === 1) parts.push(`L ${nums[0]! + 0.4} ${nums[1]! + 0.4}`);
  return parts.join(" ");
}

function attr(tag: string, name: string): string | null {
  return new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** stroke-width may be an attribute or sit inside a style="". */
function strokeWidth(tag: string): number {
  const direct = attr(tag, "stroke-width");
  if (direct && Number.isFinite(Number(direct))) return Number(direct);
  const styled = /stroke-width\s*:\s*([\d.]+)/.exec(attr(tag, "style") ?? "");
  return styled ? Number(styled[1]) : 2;
}

/**
 * Read the renderer's SVG into strokes placed in their own coordinate space.
 *
 * Returns null when there is nothing to draw, which is the common case: most pages are writing,
 * and writing belongs in the transcription rather than reproduced as a picture.
 */
export function parseInkSvg(svg: string): InkDrawing | null {
  const box = attr(svg.slice(0, svg.indexOf(">") + 1), "viewBox") ?? attr(svg, "viewBox");
  const [vx, vy, vw, vh] = (box ?? "").trim().split(/[\s,]+/).map(Number);
  if (![vx, vy, vw, vh].every(Number.isFinite) || vw! <= 0 || vh! <= 0) return null;

  const strokes: InkStroke[] = [];
  for (const tag of svg.match(/<polyline\b[^>]*>/g) ?? []) {
    const points = attr(tag, "points");
    const d = points ? pointsToPath(points) : null;
    if (d) strokes.push({ d, width: strokeWidth(tag) });
  }
  if (strokes.length === 0) return null;
  return { strokes, x: vx!, y: vy!, width: vw!, height: vh! };
}

/**
 * How much ink is on the page, as a share of its area, from the strokes' own extents. Used to
 * tell a page that is a drawing from one that merely has a doodle in the corner, without
 * asking the model to judge it.
 */
export function inkCoverage(drawing: InkDrawing): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of drawing.strokes) {
    for (const m of s.d.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return 0;
  return ((maxX - minX) * (maxY - minY)) / (drawing.width * drawing.height);
}
