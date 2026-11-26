import { volume } from './geometry';
import type { Allowance, Design, Stage, StockLine } from './types';

/** What to leave on rough stock when the design does not say: enough to joint and plane clean. */
export const DEFAULT_ALLOWANCE: Allowance = { thickness: 0.125, width: 0.125, length: 1 };

/** Below this, a strip is too thin to joint or plane: it is ripped straight to size. */
export const THIN = 0.375;

export interface CutLine extends StockLine {
  /**
   * Size to cut from rough lumber: the glue-up size plus the milling allowance. A dimension under
   * THIN gets no allowance, because a strip that thin is ripped to its final size from a board
   * already milled to the other dimension, not planed down to it.
   */
  rough: { thickness: number; width: number; length: number };
  /** True when one dimension is under THIN, so the strip is ripped to size and not milled. */
  ripped: boolean;
}

export interface CutList {
  lines: CutLine[];
  /** Board feet of rough stock, by wood. */
  boardFeet: { species: string; bf: number }[];
  totalBf: number;
  finished: [number, number, number];
  /** Finished volume over rough stock volume. */
  yield: number;
  /** One entry per stage. `warning` is the stage's warning or error, if it has one. */
  operations: { title: string; text: string; warning?: string }[];
  allowance: Allowance;
}

/**
 * A stock line with its cross-section named the way lumber is: thickness is the smaller of the
 * two, width the larger. The recipe names them by how the strip lies in the glue-up, so a thin
 * accent strip standing on edge comes out as "1 thick, 1/8 wide" from one step and "1/8 thick,
 * 1 1/4 wide" from another. Every line in the cut list reads thickness x width x length this way.
 */
function asBoard(l: StockLine): StockLine {
  return l.thickness <= l.width ? l : { ...l, thickness: l.width, width: l.thickness };
}

/**
 * Gather the stock lines, board feet, yield, finished size and instructions from a finished run
 * of the recipe. Each stock line carries two sizes: the one the glue-up needs, which the recipe
 * produced, and the rough size to cut first, which adds the design's milling allowance (except on
 * a dimension too thin to mill; see CutLine). Board
 * feet and yield are worked from the rough sizes, since that is the wood that has to be bought.
 */
export function buildCutList(stages: Stage[], design?: Pick<Design, 'allowance'>): CutList {
  const allowance = design?.allowance ?? DEFAULT_ALLOWANCE;
  const lines: CutLine[] = stages.flatMap((s) => s.stock ?? []).map(asBoard).map((l) => ({
    ...l,
    rough: {
      thickness: l.thickness < THIN ? l.thickness : l.thickness + allowance.thickness,
      width: l.width < THIN ? l.width : l.width + allowance.width,
      length: l.length + allowance.length,
    },
    ripped: l.thickness < THIN || l.width < THIN,
  }));
  const bySpecies = new Map<string, number>();
  let stockVolume = 0;
  for (const l of lines) {
    const v = l.count * l.rough.thickness * l.rough.width * l.rough.length;
    stockVolume += v;
    bySpecies.set(l.species, (bySpecies.get(l.species) ?? 0) + v / 144);
  }
  // Feet, when the board has them, are drawn under it: they are not its wood or its size.
  const last = [...stages].reverse().find((s) => s.finish !== 'feet') ?? stages[stages.length - 1];
  const finishedVolume = last.slices.reduce((v, s) => v + s.pieces.reduce((a, p) => a + volume(p), 0), 0);
  return {
    lines,
    boardFeet: [...bySpecies].map(([species, bf]) => ({ species, bf })),
    totalBf: stockVolume / 144,
    finished: last.size,
    yield: stockVolume > 0 ? finishedVolume / stockVolume : 0,
    operations: stages.filter((s) => s.summary || s.error || s.warning)
      .map((s) => ({ title: s.title, text: s.summary, warning: s.error ?? s.warning })),
    allowance,
  };
}
