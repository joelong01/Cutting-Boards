import { DEFAULT_FINISH } from './finish';
import { withAutoName } from './naming';
import { BUILTIN_SPECIES } from './species';
import type { Design, Selector, Step, StripSpec } from './types';

let counter = 0;
/** A unique id for a strip, step or custom wood, used as a stable list key. */
export const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Shorthand for one strip in a preset. */
const strip = (species: string, width: number): StripSpec => ({ id: newId(), species, width });
const ALL: Selector = { mode: 'all' };
const everyOther: Selector = { mode: 'every', n: 2, offset: 1 };

type StepInit = Step extends infer S ? (S extends { id: string } ? Omit<S, 'id'> : never) : never;
/** Give each preset step a fresh id. */
const steps = (...list: StepInit[]): Step[] => list.map((s) => ({ ...s, id: newId() }) as Step);

/** Which face of the wood ends up on top of the finished board. */
export type BoardType = 'end' | 'edge';

export interface Preset {
  key: string;
  type: BoardType;
  /** The pattern, as it appears in the design's name. */
  style: string;
  label: string;
  blurb: string;
  make: () => Design;
}

const STARTERS: Preset[] = [
  {
    key: 'single-end-grain',
    style: 'end grain',
    type: 'end',
    label: 'Single-wood end grain',
    blurb: 'The classic butcher block: one species, end grain up, every other slice reversed to mix the grain.',
    make: () => ({
      version: 1,
      name: 'Maple end grain',
      target: { length: 18, width: 12, thickness: 1.5 },
      layup: {
        length: 22.5, thickness: 1.625, repeat: 8, closeWithFirst: false,
        strips: [strip('maple', 1.5)],
      },
      steps: steps(
        // The first glue-up never comes out flat or square: plane it and true the ends first.
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'crosscut', width: 1.625, kerf: 0.125, angle: 0 },
        { type: 'turn', sel: ALL },
        { type: 'flip', sel: everyOther, how: 'end' },
        { type: 'glue' },
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ),
      customSpecies: [],
    }),
  },
  {
    key: 'single-edge-grain',
    style: 'edge grain',
    type: 'edge',
    label: 'Single-wood edge grain',
    blurb: 'Plain and quick: strips of one species glued side by side, trimmed and flattened.',
    make: () => ({
      version: 1,
      name: 'Walnut edge grain',
      target: { length: 16, width: 12, thickness: 1.125 },
      layup: {
        length: 16.5, thickness: 1.25, repeat: 8, closeWithFirst: false,
        strips: [strip('walnut', 1.5)],
      },
      steps: steps(
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ),
      customSpecies: [],
    }),
  },
  {
    key: 'edge-grain-stripes',
    style: 'stripes',
    type: 'edge',
    label: 'Edge-grain stripes',
    blurb: 'The simplest board: one glue-up of long strips, no cross cut. Wide maple and cherry with thin walnut lines.',
    make: () => ({
      version: 1,
      name: 'Edge-grain stripes',
      target: { length: 16, width: 11, thickness: 1.125 },
      layup: {
        length: 16.5, thickness: 1.25, repeat: 3, closeWithFirst: true,
        strips: [strip('maple', 1.5), strip('walnut', 0.25), strip('cherry', 1.5), strip('walnut', 0.25)],
      },
      steps: steps(
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ),
      customSpecies: [],
    }),
  },
  {
    key: 'maple-purpleheart',
    style: 'grid',
    type: 'end',
    label: 'Maple blocks, purpleheart grid',
    blurb: 'End grain. 1″ maple squares with 1/8″ purpleheart lines both ways.',
    make: () => ({
      version: 1,
      name: 'Maple blocks, purpleheart grid',
      target: { length: 16, width: 12, thickness: 1.125 },
      layup: {
        length: 20.5, thickness: 1.125, repeat: 10, closeWithFirst: true,
        strips: [strip('maple', 1), strip('purpleheart', 0.125)],
      },
      steps: steps(
        // The first glue-up never comes out flat or square: plane it and true the ends first.
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'crosscut', width: 1.25, kerf: 0.125, angle: 0 },
        { type: 'turn', sel: ALL },
        { type: 'insert', species: 'purpleheart', thickness: 0.125, every: 1 },
        { type: 'glue' },
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ),
      customSpecies: [],
    }),
  },
  {
    key: 'checkerboard',
    style: 'checkerboard',
    type: 'end',
    label: 'Walnut and maple checkerboard',
    blurb: 'End grain. Flip every other slice end for end.',
    make: () => ({
      version: 1,
      name: 'Walnut and maple checkerboard',
      target: { length: 18, width: 12, thickness: 1.5 },
      layup: {
        length: 22.5, thickness: 1.625, repeat: 4, closeWithFirst: false,
        strips: [strip('walnut', 1.5), strip('maple', 1.5)],
      },
      steps: steps(
        // The first glue-up never comes out flat or square: plane it and true the ends first.
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'crosscut', width: 1.625, kerf: 0.125, angle: 0 },
        { type: 'turn', sel: ALL },
        { type: 'flip', sel: everyOther, how: 'end' },
        { type: 'glue' },
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ),
      customSpecies: [],
    }),
  },
  {
    key: 'brick',
    style: 'brick',
    type: 'end',
    label: 'Brick (running bond)',
    blurb: 'End grain, one species. Every other slice slides half a block; trim the ragged edges.',
    make: () => ({
      version: 1,
      name: 'Teak brick',
      target: { length: 16.25, width: 13, thickness: 1.5 },
      layup: {
        length: 24.5, thickness: 1.375, repeat: 7, closeWithFirst: false,
        strips: [strip('teak', 2)],
      },
      steps: steps(
        // The first glue-up never comes out flat or square: plane it and true the ends first.
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'crosscut', width: 1.625, kerf: 0.125, angle: 0 },
        { type: 'turn', sel: ALL },
        { type: 'shift', sel: everyOther, amount: 1 },
        { type: 'glue' },
        { type: 'trim', auto: true, x0: 0, x1: 0, z0: 0, z1: 0 },
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ),
      customSpecies: [],
    }),
  },
  {
    key: 'basket-weave',
    style: 'basket weave',
    type: 'end',
    label: 'Basket weave',
    blurb: 'Walnut bars woven over and under, a maple square at every crossing, a cherry line round everything, in a walnut border. Two panels, each cross cut, then interleaved.',
    make: () => basketWeave(),
  },
  {
    key: 'chevron',
    style: 'chevron',
    type: 'edge',
    label: 'Chevron',
    blurb: 'Long grain. Cross cut at 45°, flip every other slice face down, trim.',
    make: () => ({
      version: 1,
      name: 'Three-wood chevron',
      target: { length: 16, width: 10, thickness: 0.8125 },
      layup: {
        length: 30, thickness: 1, repeat: 5, closeWithFirst: false,
        strips: [strip('maple', 0.75), strip('walnut', 0.75), strip('cherry', 0.75), strip('padauk', 0.25)],
      },
      steps: steps(
        // The corners of an angled cut are waste anyway, so only the faces are trued first.
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
        { type: 'crosscut', width: 2, kerf: 0.125, angle: 45 },
        { type: 'flip', sel: everyOther, how: 'face' },
        { type: 'glue' },
        { type: 'trim', auto: true, x0: 0, x1: 0, z0: 0, z1: 0 },
        { type: 'flatten', top: 0.03125, bottom: 0.03125 },
      ),
      customSpecies: [],
    }),
  },
];

/** The design a first launch opens with. */
/**
 * The starter designs. Each one's `make` returns a fresh design that knows its pattern and is
 * named from its woods, so the name follows when the woods are changed.
 */
export const PRESETS: Preset[] = STARTERS.map((p) => ({
  ...p,
  make: () => withAutoName({ ...p.make(), style: p.style, autoName: true }, BUILTIN_SPECIES),
}));

export const defaultDesign = (): Design => PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();

/** A step of the given type with sensible starting values, for the "Add a step" buttons. */
export function newStep(type: Step['type']): Step {
  const id = newId();
  switch (type) {
    case 'crosscut': return { id, type, width: 1.25, kerf: 0.125, angle: 0 };
    case 'turn': return { id, type, sel: { mode: 'all' } };
    case 'flip': return { id, type, sel: { mode: 'every', n: 2, offset: 1 }, how: 'end' };
    case 'shift': return { id, type, sel: { mode: 'every', n: 2, offset: 1 }, amount: 0.5 };
    case 'insert': return { id, type, species: 'walnut', thickness: 0.125, every: 1 };
    case 'glue': return { id, type };
    case 'trim': return { id, type, auto: true, x0: 0, x1: 0, z0: 0, z1: 0 };
    case 'flatten': return { id, type, top: 0.0625, bottom: 0.0625 };
    case 'rotate': return { id, type };
    case 'frame': return { id, type, species: 'walnut', width: 1.5, lineSpecies: 'maple', line: 0.125, block: 3 };
    case 'panel': return { id, type, strips: [{ id: newId(), species: 'walnut', width: 1 }, { id: newId(), species: 'maple', width: 1 }], thickness: 0.875, extra: 0 };
    case 'combine': return { id, type };
  }
}

/**
 * The design with a step put in after stage `at` (0 is the first glue-up, so 0 makes it the first
 * step). Positions past the end, such as the Finish stage, add it as the last step.
 */
export function insertStep(design: Design, at: number, step: Step): Design {
  const i = Math.min(Math.max(0, Math.floor(at)), design.steps.length);
  return { ...design, steps: [...design.steps.slice(0, i), step, ...design.steps.slice(i)] };
}

/** Squares along each side of a chess board. */
export const CHESS_SQUARES = 8;

export interface ChessOptions {
  /** Width of one square. The board is eight of these each way. */
  square: number;
  /** Wood ids for the two colours. */
  dark: string;
  light: string;
  /** Finished thickness of the board. */
  thickness: number;
  /** End grain up (blocks on end) or face grain up (the classic flat board). */
  grain: 'end' | 'face';
}

/**
 * A chess board: always eight squares by eight in two woods, with no juice groove. Eight strips
 * a square wide are glued up, cross cut into eight slices, and every other slice is turned end
 * for end. For end grain the strips are milled square and each slice is turned up, so the stock
 * thickness sets the square and the cross cut sets the board's thickness; for face grain it is
 * the other way round. Stock and cuts carry 1/16 a face for each flattening, a kerf between
 * slices and 1/4 to square each end. The design does not hold a target size: refitting it could
 * change the number of squares.
 */
export function chessBoard(o: ChessOptions): Design {
  const kerf = 0.125, flat = 0.0625, endTrim = 0.25;
  const end = o.grain === 'end';
  // What is cut off each slice's width by the cross cut: the board's thickness or the square.
  const cut = end ? o.thickness + 2 * flat : o.square;
  const flatten = { type: 'flatten', top: flat, bottom: flat } as const;
  const side = o.square * CHESS_SQUARES;
  return withAutoName({
    version: 1,
    name: 'Chess board',
    style: 'chess board',
    autoName: true,
    target: { length: side, width: side, thickness: o.thickness },
    autoFit: false,
    finish: { ...DEFAULT_FINISH, groove: { ...DEFAULT_FINISH.groove, on: false } },
    layup: {
      length: CHESS_SQUARES * cut + (CHESS_SQUARES - 1) * kerf + 2 * endTrim,
      thickness: (end ? o.square : o.thickness + 2 * flat) + 2 * flat,
      repeat: CHESS_SQUARES / 2,
      closeWithFirst: false,
      strips: [strip(o.dark, o.square), strip(o.light, o.square)],
    },
    steps: steps(
      flatten,
      { type: 'trim', auto: false, x0: endTrim, x1: endTrim, z0: 0, z1: 0 },
      { type: 'crosscut', width: cut, kerf, angle: 0 },
      ...(end ? [{ type: 'turn', sel: ALL } as const] : []),
      { type: 'flip', sel: everyOther, how: 'end' },
      { type: 'glue' },
      flatten,
    ),
    customSpecies: [],
  }, BUILTIN_SPECIES);
}

export interface DoubleBorderOptions {
  /** Width of one field block, which is square. */
  block: number;
  /** Thickness of each border strip: the inner border and the outer border are both this thick. */
  line: number;
  /** Wood ids: the blocks, the border touching each block, and the border around that. */
  field: string;
  inner: string;
  outer: string;
  /**
   * Wood for the spacer strips of the first glue-up, which the last cross cut saws out. Something
   * cheap; poplar if not given.
   */
  spacer?: string;
  /** How many blocks across the board's width and along its length. */
  across: number;
  along: number;
  /** Finished thickness of the board. */
  thickness: number;
  /** End grain up (blocks on end) or face grain up. */
  grain: 'end' | 'face';
}

/**
 * A double border board: every field block has a ring of the inner wood round it, and a grid of
 * the outer wood runs between the rings and round the outside of the board, unbroken both ways.
 *
 * Two glue-ups cannot make that: whichever strips go in last run straight through the ones that
 * cross them, so one wood would be interrupted at every crossing. So it takes three, the outer
 * wood going in last one way by sawing out the line it replaces:
 *
 * 1. Strips of inner, field, inner and a spacer, repeated across the panel. The spacer holds the
 *    place of an outer-wood line and is sawn out in step 3, so it is a cheap wood.
 * 2. Cross cut, and between the slices (and outside the end ones) a stack of inner, outer, inner.
 *    Now the lines one way are unbroken and the spacers the other way stop at each one.
 * 3. Quarter-turn, and cross cut again with the kerf on each spacer, the kerf being exactly as
 *    thick as the spacer. A full-length outer strip goes in each
 *    kerf and on the two outside faces. The last trim takes off the spare inner strip left on
 *    the other two edges by step 2.
 *
 * The second cross cut only lands on the lines because the first slice is the same width as the
 * rest, which is why the strips start with the inner wood and the stacks go on the outside
 * faces too. The design does not hold a target size: refitting it could move those lines.
 */
export function doubleBorder(o: DoubleBorderOptions): Design {
  const kerf = 0.125, flat = 0.0625, endTrim = 0.25;
  const end = o.grain === 'end';
  const across = Math.max(1, Math.floor(o.across)), along = Math.max(1, Math.floor(o.along));
  // Three flattenings in all. Whichever of the stock thickness and the first cross cut becomes
  // the board's thickness carries the two that follow that cut; the stock also carries the first.
  const cut = end ? o.thickness + 4 * flat : o.block;
  const flatten = { type: 'flatten', top: flat, bottom: flat } as const;
  const cell = o.block + 2 * o.line;
  const wide = across * cell + (across + 1) * o.line, long = along * cell + (along + 1) * o.line;
  return withAutoName({
    version: 1,
    name: 'Double border',
    style: 'double border',
    autoName: true,
    target: { length: Math.max(wide, long), width: Math.min(wide, long), thickness: o.thickness },
    autoFit: false,
    finish: DEFAULT_FINISH,
    layup: {
      length: along * cut + (along - 1) * kerf + 2 * endTrim,
      thickness: (end ? o.block : o.thickness + 4 * flat) + 2 * flat,
      repeat: across,
      closeWithFirst: false,
      strips: [strip(o.inner, o.line), strip(o.field, o.block), strip(o.inner, o.line), { ...strip(o.spacer ?? 'poplar', o.line), spacer: true }],
    },
    steps: steps(
      flatten,
      { type: 'trim', auto: false, x0: endTrim, x1: endTrim, z0: 0, z1: 0 },
      { type: 'crosscut', width: cut, kerf, angle: 0 },
      ...(end ? [{ type: 'turn', sel: ALL } as const] : []),
      { type: 'insert', species: o.inner, thickness: o.line, every: 1, ends: true, more: [{ species: o.outer, thickness: o.line }, { species: o.inner, thickness: o.line }] },
      { type: 'glue' },
      flatten,
      { type: 'rotate' },
      { type: 'crosscut', width: cell, kerf: o.line, angle: 0 },
      { type: 'insert', species: o.outer, thickness: o.line, every: 1, ends: true },
      { type: 'glue' },
      flatten,
      { type: 'trim', auto: false, x0: 0, x1: 0, z0: o.line, z1: o.line },
    ),
    customSpecies: [],
  }, BUILTIN_SPECIES);
}

/**
 * How many blocks of a double border board come closest to a board `size` long (or wide): each
 * block brings two inner strips and one outer strip with it, and one more outer strip closes the
 * far side. Never fewer than one.
 */
export function doubleBorderCount(size: number, block: number, line: number): number {
  return Math.max(1, Math.round((size - line) / (block + 3 * line)));
}

export interface BasketWeaveOptions {
  /** Width of a bar. A bar is a little over twice as long as this. */
  bar?: number;
  /** Thickness of the line round every bar and square: one saw kerf, so 1/8. */
  line?: number;
  /** Wood ids: the bars, the small squares where four bars meet, and the lines. */
  bars?: string;
  squares?: string;
  lines?: string;
  /** How many bars across the width, and how many rows of them along the length. */
  across?: number;
  along?: number;
  /** Finished thickness of the board. */
  thickness?: number;
  /** False leaves off the border of bar wood round the weave. */
  border?: boolean;
}

/**
 * An end-grain basket weave: bars lying alternately along and across the board, a small square
 * in each gap where four bars meet, a thin line round every bar and square, and a border of the
 * bar wood round the whole weave.
 *
 * No straight cut runs through this pattern from edge to edge, so it cannot come from one panel.
 * Seen as rows across the board, it is two kinds of row, each cross cut from a panel of its own
 * and stood on end, so the recipe makes two panels with the same steps:
 *
 * - the square rows, twice the half-square thick: square, line, bar, line, repeated. The bar is
 *   one end of a bar that runs along the board. This is the first glue-up.
 * - the bar rows, a bar and two lines thick: a bar lying across with a line above and below it,
 *   then a line, an along-the-board bar and a line. The across bar is a plank of bar wood with
 *   a face of line wood glued to each side before it goes into the panel; the faces go on 1/16
 *   thick and the flattening takes them down to a line. This is the second panel.
 *
 * The bar rows repeat every two bars and alternate, row by row, shifted by one. So the square
 * rows are set aside while the second panel is made and cut, the two are interleaved, and every
 * other bar row is slid one bar spacing towards edge A. The second panel is made one spacing
 * wider than the first for that, and the trim after the glue-up squares the ragged edges.
 * A bar lying across is one piece; a bar lying along is three, end to end (square row, bar row,
 * square row), which no way of building it in rows avoids.
 *
 * With bar width W, line t and half-square h = W/4, one bar spacing is T = W + 2t + 2h, a bar is
 * W + 2t + 4h long, and a square is 2h. The weave is trimmed by h all round, so its edges fall on
 * the middle of a row of squares, before the border goes on.
 */
export function basketWeave(o: BasketWeaveOptions = {}): Design {
  const W = o.bar ?? 1.5, t = o.line ?? 0.125, h = W / 4;
  const bars = o.bars ?? 'walnut', squares = o.squares ?? 'maple', lines = o.lines ?? 'cherry';
  const across = Math.max(1, Math.floor(o.across ?? 4)), along = Math.max(1, Math.floor(o.along ?? 5));
  const thickness = o.thickness ?? 1.25;
  const border = o.border !== false;
  const kerf = 0.125, flat = 0.0625, endTrim = 0.25;
  const T = W + 2 * t + 2 * h;
  // Each slice is the board's thickness plus the flattening after each glue-up that follows.
  const cut = thickness + (border ? 4 : 2) * flat;
  // One square row for each row of bars and one to close the far end.
  const rows = along + 1;
  const flatten = { type: 'flatten', top: flat, bottom: flat } as const;
  const grown = border ? 2 * (W + t) : 0;
  return withAutoName({
    version: 1,
    name: 'Basket weave',
    style: 'basket weave',
    autoName: true,
    target: { length: Math.max(along, across) * T + grown, width: Math.min(along, across) * T + grown, thickness },
    finish: DEFAULT_FINISH,
    layup: {
      length: rows * cut + (rows - 1) * kerf + 2 * endTrim,
      thickness: 2 * h + 2 * flat,
      repeat: across,
      closeWithFirst: true,
      strips: [strip(squares, 2 * h), strip(lines, t), strip(bars, W), strip(lines, t)],
    },
    steps: steps(
      // The first glue-up never comes out flat or square: plane it and true the ends first.
      flatten,
      { type: 'trim', auto: false, x0: endTrim, x1: endTrim, z0: 0, z1: 0 },
      { type: 'crosscut', width: cut, kerf, angle: 0 },
      { type: 'turn', sel: ALL },
      // The second panel, for the bar rows. It starts at edge A with an across bar, which is where
      // the first panel has a square, a line and a bar's end; it sizes itself to the slices set aside.
      {
        type: 'panel', thickness: W + 2 * t + 2 * flat, extra: T,
        strips: [
          { ...strip(bars, T + 2 * h), faces: { species: lines, thickness: t + flat } },
          strip(lines, t), strip(bars, W), strip(lines, t),
        ],
      },
      flatten,
      { type: 'trim', auto: false, x0: endTrim, x1: endTrim, z0: 0, z1: 0 },
      { type: 'crosscut', width: cut, kerf, angle: 0 },
      { type: 'turn', sel: ALL },
      { type: 'combine' },
      // Every other bar row (slices 4, 8, 12...) slides one bar spacing towards edge A.
      { type: 'shift', sel: { mode: 'every', n: 4, offset: 3 }, amount: -T },
      { type: 'glue' },
      flatten,
      // The ragged long edges, then half a square off all round, so the edges fall on the middle
      // of a row of squares.
      { type: 'trim', auto: true, x0: h, x1: h, z0: h, z1: h },
      ...(border ? [{ type: 'frame', species: bars, width: W, lineSpecies: lines, line: t, block: W + 2 * t + 4 * h } as const, flatten] : []),
    ),
    customSpecies: [],
  }, BUILTIN_SPECIES);
}
