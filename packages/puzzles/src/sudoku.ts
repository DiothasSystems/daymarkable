/**
 * Sudoku, generated rather than drawn from a library of stock puzzles.
 *
 * Two properties are non-negotiable, and both are checked here rather than hoped for: the puzzle
 * has a solution, and it has exactly ONE. A grid with two solutions is not a sudoku — a solver
 * would find a different answer from the one printed on the second page, and the customer would be
 * right and we would be wrong.
 */
import { rng, shuffle } from "./schedule.js";

export type Cell = number; // 0 = empty
export type Grid = Cell[]; // 81 cells, row-major

export type Difficulty = "gentle" | "moderate" | "hard";

/** How many cells to try to remove. Fewer givens is harder; uniqueness is what actually stops us. */
const TARGET_GIVENS: Record<Difficulty, number> = { gentle: 40, moderate: 32, hard: 26 };

export interface Sudoku {
  puzzle: Grid;
  solution: Grid;
  givens: number;
  difficulty: Difficulty;
}

const ROWS = 9;

function peers(index: number): number[] {
  const r = Math.floor(index / 9);
  const c = index % 9;
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  const out = new Set<number>();
  for (let i = 0; i < 9; i++) {
    out.add(r * 9 + i);
    out.add(i * 9 + c);
  }
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) out.add((br + dr) * 9 + bc + dc);
  out.delete(index);
  return [...out];
}

/** Peer lists never change, and computing them per cell per attempt dominated the generator. */
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => peers(i));

function allowed(grid: Grid, index: number, value: number): boolean {
  for (const p of PEERS[index]!) if (grid[p] === value) return false;
  return true;
}

/** Fill an empty grid completely, choosing candidates in a seeded order so the result is stable. */
function fill(grid: Grid, next: () => number): boolean {
  const index = grid.indexOf(0);
  if (index === -1) return true;
  for (const value of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], next)) {
    if (!allowed(grid, index, value)) continue;
    grid[index] = value;
    if (fill(grid, next)) return true;
    grid[index] = 0;
  }
  return false;
}

/**
 * How many solutions a grid has, counting no further than `cap`. Counting to two is all anyone
 * needs: one is a puzzle, two or more is not.
 */
export function countSolutions(grid: Grid, cap = 2): number {
  const work = [...grid];
  let found = 0;
  const walk = (): void => {
    if (found >= cap) return;
    // Solve the most constrained cell first: it cuts the search enormously versus left-to-right.
    let best = -1;
    let bestOptions: number[] = [];
    for (let i = 0; i < 81; i++) {
      if (work[i] !== 0) continue;
      const options: number[] = [];
      for (let v = 1; v <= 9; v++) if (allowed(work, i, v)) options.push(v);
      if (options.length === 0) return; // dead end
      if (best === -1 || options.length < bestOptions.length) {
        best = i;
        bestOptions = options;
        if (options.length === 1) break;
      }
    }
    if (best === -1) {
      found++;
      return;
    }
    for (const v of bestOptions) {
      work[best] = v;
      walk();
      work[best] = 0;
      if (found >= cap) return;
    }
  };
  walk();
  return found;
}

/**
 * Remove cells while the grid still has exactly one solution.
 *
 * Symmetrically, in pairs about the centre, because that is what a sudoku looks like in a
 * newspaper — and because taking two at a time halves the number of uniqueness checks, which are
 * the expensive part.
 */
export function generateSudoku(seed: number, difficulty: Difficulty = "moderate"): Sudoku {
  const next = rng(seed);
  const solution: Grid = new Array(81).fill(0);
  fill(solution, next);

  const puzzle = [...solution];
  const target = TARGET_GIVENS[difficulty];
  // Only the first half: each index is removed together with its mirror.
  for (const i of shuffle(Array.from({ length: 41 }, (_, k) => k), next)) {
    const mirror = 80 - i;
    if (puzzle[i] === 0 && puzzle[mirror] === 0) continue;
    const countGivens = puzzle.filter((c) => c !== 0).length;
    if (countGivens <= target) break;
    const keptA = puzzle[i]!;
    const keptB = puzzle[mirror]!;
    puzzle[i] = 0;
    puzzle[mirror] = 0;
    if (countSolutions(puzzle) !== 1) {
      puzzle[i] = keptA;
      puzzle[mirror] = keptB;
    }
  }
  return { puzzle, solution, givens: puzzle.filter((c) => c !== 0).length, difficulty };
}

/** Rows of nine, for a composer that draws a grid. */
export function toRows(grid: Grid): Cell[][] {
  return Array.from({ length: ROWS }, (_, r) => grid.slice(r * 9, r * 9 + 9));
}
