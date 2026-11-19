// All lengths are inches. Axes: X = along the board (first grain direction), Y = up, Z = across.

export type Vec3 = [number, number, number];

/** The plane n.p = d, with n a unit normal. */
export interface Plane {
  n: Vec3;
  d: number;
  /** One of the six faces of the whole board, as opposed to a glue face inside it. */
  outer?: boolean;
}

/** One piece of wood: a convex solid, stored as outward-facing polygon loops. */
export interface Piece {
  species: string;
  /** Unit vector along the wood fibres. A face square to it shows end grain. */
  grain: Vec3;
  /** Lightness jitter carried from the original strip, so offcuts of one strip match. */
  tone: number;
  faces: Vec3[][];
  /**
   * Set on every piece of the Finish stage: the planes of the block before any finishing cut.
   * The view draws an edge only if it lies on two of them (an edge of the block) or on one that
   * is a glue face (a glue line, wherever the surface now is). Facet lines on rounded edges and
   * seams from splitting a block round the groove fail both tests and are not drawn. Only
   * meaningful in the stage that made it.
   */
  origin?: Plane[];
}

/** How a slice got here from the previous stage; used only to animate. */
export interface Motion {
  axis: 'y' | 'z' | null;
  angle: number;
  shift: number;
}

export interface Slice {
  pieces: Piece[];
  motion?: Motion;
}

export interface StockLine {
  species: string;
  count: number;
  thickness: number;
  width: number;
  length: number;
  use: string;
}

export interface Stage {
  /** A panel is one glued-up slab (a single slice). Slices are loose strips in order along X. */
  kind: 'panel' | 'slices';
  slices: Slice[];
  size: Vec3;
  title: string;
  /** Plain-language instruction for the order of operations. */
  summary: string;
  error?: string;
  warning?: string;
  /** Z range fully covered by every slice at the last glue-up; drives auto trim. */
  trimHint?: { zLo: number; zHi: number };
  stock?: StockLine[];
}

export interface StripSpec {
  id: string;
  species: string;
  width: number;
}

export interface Layup {
  length: number;
  thickness: number;
  strips: StripSpec[];
  repeat: number;
  /** Add the first strip once more at the end so the panel is symmetric. */
  closeWithFirst: boolean;
}

export type Selector =
  | { mode: 'all' }
  | { mode: 'every'; n: number; offset: number }
  | { mode: 'pick'; indices: number[] };

export type Step =
  | { id: string; type: 'crosscut'; width: number; kerf: number; angle: number }
  | { id: string; type: 'turn'; sel: Selector }
  | { id: string; type: 'flip'; sel: Selector; how: 'end' | 'face' }
  | { id: string; type: 'shift'; sel: Selector; amount: number }
  | { id: string; type: 'insert'; species: string; thickness: number; every: number }
  | { id: string; type: 'glue' }
  | { id: string; type: 'trim'; auto: boolean; x0: number; x1: number; z0: number; z1: number }
  | { id: string; type: 'flatten'; top: number; bottom: number }
  | { id: string; type: 'rotate' };

export type StepType = Step['type'];

export interface Species {
  id: string;
  name: string;
  color: string;
  custom?: boolean;
}

export interface Finish {
  /**
   * Juice groove around the top. `inset` is from the board's edge to the groove's outer edge.
   * `cornerRadius` is the radius of the path the centre of the bit follows at each corner. Zero is
   * a router guided by straight rails: the path turns a square corner, which leaves the outside of
   * the groove rounded to the bit's own radius and the inside sharp. With `align` on, `inset` is
   * only where to aim: each side of the groove moves to the nearest place that sits evenly on the
   * pattern, centred in a row of blocks or on an accent line.
   */
  groove: { on: boolean; inset: number; width: number; depth: number; cornerRadius: number; align: boolean };
  /** 45-degree chamfer on the bottom edges, all the way round. */
  chamfer: { on: boolean; size: number };
  /** The four corners rounded, seen from above. */
  corners: { on: boolean; radius: number };
  /** The top edges rounded over, all the way round. */
  roundover: { on: boolean; radius: number };
}

export interface Allowance {
  thickness: number;
  width: number;
  length: number;
}

export interface Design {
  version: 1;
  name: string;
  /** The pattern, in the words used in the name: "grid", "checkerboard", "brick". */
  style?: string;
  /**
   * True while the app owns the name and keeps it in step with the woods. False once the user
   * types a name or saves the design under it. Absent on designs from before this existed.
   */
  autoName?: boolean;
  target: { length: number; width: number; thickness: number };
  /**
   * Keep the finished board at the target length and width: after any change to the strips or
   * steps, the repeat count and stock length are found again. Absent means on.
   */
  autoFit?: boolean;
  /**
   * Extra to leave on each strip when breaking down rough lumber, before it is jointed and planed
   * to the size the glue-up needs. Thickness and width are totals, not per face. Absent means the
   * defaults in cutlist.ts.
   */
  allowance?: Allowance;
  /** Juice groove, chamfer, rounded corners and rounded top edge. Absent means the defaults in finish.ts: all on. */
  finish?: Finish;
  layup: Layup;
  steps: Step[];
  customSpecies: Species[];
}
