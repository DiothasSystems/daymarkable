import { describe, expect, it } from "vitest";
import { inkCoverage, parseInkSvg } from "./ink.js";

const svg = (body: string, box = "0 0 100 200") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200" viewBox="${box}"><g id="p1">${body}</g></svg>`;

describe("reading the page's ink", () => {
  it("keeps the geometry exactly, point for point", () => {
    const d = parseInkSvg(svg('<polyline points="10,20 30,40 50,60" />'));
    expect(d?.strokes[0]?.d).toBe("M 10 20 L 30 40 L 50 60");
  });

  // The whole point of this is that it is a copy. Anything normalised here is ink the customer
  // did not make.
  it("keeps the width, colour and cap the page recorded, from an attribute or a style", () => {
    const fromAttrs = parseInkSvg(svg('<polyline points="0,0 1,1" stroke="#c9973f" stroke-width="2.75" stroke-linecap="round" />'));
    expect(fromAttrs?.strokes[0]).toMatchObject({ width: 2.75, color: "#c9973f", cap: "round" });

    const fromStyle = parseInkSvg(svg('<polyline points="0,0 1,1" style="fill:none;stroke:#1a1a1a;stroke-width:1.5;stroke-linecap:square" />'));
    expect(fromStyle?.strokes[0]).toMatchObject({ width: 1.5, color: "#1a1a1a", cap: "square" });
  });

  it("reports no colour and no cap rather than inventing one", () => {
    const d = parseInkSvg(svg('<polyline points="0,0 1,1" />'));
    expect(d?.strokes[0]?.color).toBeNull();
    expect(d?.strokes[0]?.cap).toBeNull();
  });

  // A tap is a single point. Repeated exactly, it is a dot under round caps and nothing under
  // butt caps, which is what the page itself shows.
  it("repeats a single point without moving it", () => {
    expect(parseInkSvg(svg('<polyline points="12,34" />'))?.strokes[0]?.d).toBe("M 12 34 L 12 34");
  });

  it("carries the viewBox origin, so a page that does not start at zero still lines up", () => {
    const d = parseInkSvg(svg('<polyline points="0,0 1,1" />', "-50 -20 100 200"));
    expect(d).toMatchObject({ x: -50, y: -20, width: 100, height: 200 });
  });

  it("says nothing to draw on a page with no strokes, or no usable viewBox", () => {
    expect(parseInkSvg(svg(""))).toBeNull();
    expect(parseInkSvg(svg('<polyline points="7" />'))).toBeNull();
    expect(parseInkSvg('<svg><g><polyline points="0,0 1,1" /></g></svg>')).toBeNull();
  });
});

describe("how much of the page is inked", () => {
  it("measures the strokes' own extent against the page", () => {
    // A 50 × 100 extent on a 100 × 200 page is a quarter of it.
    expect(inkCoverage(parseInkSvg(svg('<polyline points="0,0 50,100" />'))!)).toBeCloseTo(0.25, 5);
  });

  it("is nearly nothing for a scribble in one corner", () => {
    expect(inkCoverage(parseInkSvg(svg('<polyline points="2,2 6,9" />'))!)).toBeLessThan(0.01);
  });
});
