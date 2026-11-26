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
  /**
   * A panel is one glued-up slab (a single slice). Slices are loose pieces in order along X, as a
   * cross cut leaves them. Strips are the blanks ripped for a glue-up, one slice each, lying side
   * by side across Z in the order they will be glued.
   */
  kind: 'panel' | 'slices' | 'strips';
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
  /**
   * Slices set aside while another panel is made: "Start another panel" puts the slices there,
   * every step after it carries them along untouched, and "Interleave the slices" brings them
   * back. They are drawn beside the work.
   */
  aside?: Slice[];
  /** Set on the stage of a finishing step: which touch it is. */
  finish?: FinishPart | 'sand';
  /**
   * Carried by a panel once finishing has started: the panel as it was before any finishing cut,
   * and the touches applied so far. Each further touch is cut from that panel together with the
   * ones before it, because they depend on each other: the roundover must clear the chamfer, the
   * groove must clear the roundover, and all three follow the rounded corners.
   */
  finishing?: { pieces: Piece[]; size: Vec3; applied: Finish };
}

/** The finishing touches, in the order they are done. */
export type FinishPart = 'corners' | 'chamfer' | 'roundover' | 'template' | 'groove';

export interface StripSpec {
  id: string;
  species: string;
  /** The width asked for. A strip that is not locked is milled a little under this when the board is held to its target size. */
  width: number;
  /**
   * True for a strip that keeps exactly the width asked for when the board is fitted to its
   * target; false for one that gives way. Absent, a strip under 3/8 inch (an accent line) and a
   * spacer are locked and the rest are not.
   */
  locked?: boolean;
  /**
   * True for a strip that only holds a place: a later cut saws it out, so none of it is in the
   * finished board and any cheap wood will do. It is milled and glued like the rest, but its
   * wood is left out of the board's name.
   */
  spacer?: boolean;
  /**
   * A layer of another wood glued to both faces of this strip before it goes into the panel, each
   * `thickness` thick as glued on. The strip and its two faces together are as thick as the panel.
   */
  faces?: { species: string; thickness: number };
}

export interface Layup {
  length: number;
  thickness: number;
  strips: StripSpec[];
  repeat: number;
  /** Add the first strip once more at the end so the panel is symmetric. */
  closeWithFirst: boolean;
  /**
   * Set by fitting the board to its target, never typed. `scale` multiplies the width of every
   * strip that is not locked, so the board comes out exactly the target width. `along` is added,
   * in inches, to whichever size sets the length of a block along the board, so it comes out
   * exactly the target length: the strips' thickness when the slices are stood on end, the cross
   * cut's width when they are not. Absent means the sizes are used as asked for.
   */
  scale?: number;
  along?: number;
}

export type Selector =
  | { mode: 'all' }
  | { mode: 'every'; n: number; offset: number }
  | { mode: 'pick'; indices: number[] };

/**
 * One strip of the stack an "Insert accent strips" step puts between slices. With the step's
 * `ends` on, the same stack also goes on the outside of the first and last slice.
 *
 * A strip is one wood, `species`, unless it has a `pattern`. Then it is a slice cut from another
 * glue-up: a panel whose strips, `pattern`, repeat across its width the way the first glue-up's
 * do, and it lies between the slices with those strips showing along its length. `offset` is how
 * far in from the board's edge A the pattern starts. `species` is then its main wood, for naming.
 */
export interface AccentStrip {
  species: string;
  thickness: number;
  pattern?: PatternStrip[];
  offset?: number;
}

/**
 * One strip of a patterned accent strip's panel. With `faces` it is a plank that has a layer of
 * another wood glued to both faces before it goes into the panel: the plank and its two faces
 * together are as thick as the panel, and `faces.thickness` is one face.
 */
export interface PatternStrip {
  species: string;
  width: number;
  faces?: { species: string; thickness: number };
}

// On an insert step, `pattern` and `offset` belong to its first strip (see AccentStrip), and
// `stagger` slides the patterned strips of every other gap that far along, so two rows of a
// pattern can alternate.
export type Step =
  /** Rip and mill the strips the board starts from. Always the first step. */
  | ({ id: string; type: 'strips' } & Layup)
  | { id: string; type: 'crosscut'; width: number; kerf: number; angle: number }
  /** Saw a glued panel lengthways into strips `width` wide. They are then worked as slices. */
  | { id: string; type: 'rip'; width: number; kerf: number }
  /** Stand the chosen slices up on end: a turn of `angle` degrees about each one's length, a quarter turn (90) unless given. */
  | { id: string; type: 'turn'; sel: Selector; angle?: number }
  | { id: string; type: 'flip'; sel: Selector; how: 'end' | 'face' }
  | { id: string; type: 'shift'; sel: Selector; amount: number }
  | { id: string; type: 'insert'; species: string; thickness: number; every: number; more?: AccentStrip[]; ends?: boolean; pattern?: AccentStrip['pattern']; offset?: number; stagger?: number }
  | { id: string; type: 'glue' }
  | { id: string; type: 'trim'; auto: boolean; x0: number; x1: number; z0: number; z1: number }
  | { id: string; type: 'flatten'; top: number; bottom: number }
  | { id: string; type: 'rotate' }
  /**
   * Set the loose slices aside and start another panel, glued up from `strips` like the first.
   * Unless `repeat` and `length` are given it sizes itself to the slices set aside: as wide as
   * they are long plus `extra` (room to slide slices along later), and long enough to cross cut
   * one slice for each gap between them.
   */
  | { id: string; type: 'panel'; strips: StripSpec[]; thickness: number; extra: number; repeat?: number; length?: number }
  /** Bring back the slices set aside and put one of the new slices after each, ends lined up at edge A. */
  | { id: string; type: 'combine' }
  /**
   * A border glued round the panel: an optional thin line of `lineSpecies`, `line` thick, then
   * `species`, `width` wide, made up of blocks about `block` long. The two ends go on first and
   * the two long sides cover them.
   */
  | { id: string; type: 'frame'; species: string; width: number; lineSpecies: string; line: number; block: number };

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
  /**
   * A template stuck to the top for the router to rest on and run round while it cuts the juice
   * groove: a frame of strips `stripWidth` wide and `thickness` thick, inside the groove, whose
   * outside edge the bit's bearing follows. It is a step only when the groove is on. Absent in
   * designs saved before there was one, which is the same as off.
   */
  template?: { on: boolean; stripWidth: number; thickness: number };
}

export interface Allowance {
  thickness: number;
  width: number;
  length: number;
}

export interface Design {
  version: 2;
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
  /** Everything done to the wood, in order, starting with ripping the strips. */
  steps: Step[];
  customSpecies: Species[];
}
