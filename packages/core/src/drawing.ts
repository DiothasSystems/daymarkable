/**
 * Deciding that a page is a drawing, and therefore that its ink belongs in the notes.
 *
 * Two things know something here and neither is sufficient alone. The decoder can see that a
 * page carries a diagram, but it cannot be trusted to notice that the page is nearly blank. The
 * stroke geometry knows how much ink is on the page and where, but not what any of it means.
 * So the model reports and this decides, which is the first domain rule.
 */

/** Below this share of the page, there is not enough ink to be worth reproducing. */
export const MIN_INK_COVERAGE = 0.03;

/**
 * A page with ink but at most this many words is treated as a drawing even when the decoder did
 * not say so, because that is what a page the model could not read looks like from here.
 */
export const WORDS_THAT_ARE_STILL_A_DRAWING = 12;

export interface DrawingSignals {
  /** What the decoder said: this page carries a diagram or sketch. */
  hasDrawing: boolean;
  /** Words the decoder transcribed from the page. */
  words: number;
  /** Share of the page covered by the strokes' extent, 0 to 1. */
  coverage: number;
}

/**
 * Whether to reproduce this page's ink under its notes.
 *
 * Deliberately not "did the model say diagram". A page of drawing that the model failed to
 * recognise still needs reproducing, and it is exactly the page where the transcription comes
 * back nearly empty, so the absence of words is itself the signal. Equally, a caption on a page
 * that is almost bare is a margin doodle, and reproducing it wastes half a page.
 */
export function shouldReproduceInk(s: DrawingSignals): boolean {
  if (s.coverage < MIN_INK_COVERAGE) return false;
  return s.hasDrawing || s.words <= WORDS_THAT_ARE_STILL_A_DRAWING;
}

/** Words in a transcription, ignoring the bracketed notes the decoder adds for diagrams. */
export function transcribedWordCount(transcription: string): number {
  const withoutBrackets = transcription.replace(/\[[^\]]*\]/g, " ");
  return withoutBrackets.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * What to print under the drawing. The decoder's caption when it gave one, otherwise a plain
 * statement of where it came from — never a guess at what the drawing means.
 */
export function drawingCaption(caption: string | null, notebook: string, pageIndex: number): string {
  const ref = `${notebook.toUpperCase()} · p.${pageIndex + 1}`;
  return caption?.trim() ? `${ref} · ${caption.trim()}` : ref;
}
