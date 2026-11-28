import { blockRecipe, reblock } from './blocks';
import { makeDesign, type Parts } from './design';
import { DEFAULT_FINISH, NO_FINISH } from './finish';
import { fitThickness, fitToTarget } from './fit';
import { withAutoName } from './naming';
import { BUILTIN_SPECIES } from './species';
import type { Design, Selector, Step, StripSpec } from './types';

import { newId } from './ids';

export { newId } from './ids';
export { newStep } from './pipeline';

/** Shorthand for one strip in a preset. */
const strip = (species: string, width: number): StripSpec => ({ id: newId(), species, width });
const ALL: Selector = { mode: 'all' };
const everyOther: Selector = { mode: 'every', n: 2, offset: 1 };

type StepInit = Step extends infer S ? (S extends { id: string } ? Omit<S, 'id'> : never) : never;
/** Give each preset step a fresh id. */
const steps = (...list: StepInit[]): Step[] => list.map((s) => ({ ...s, id: newId() }) as Step);

export interface Preset {
  key: string;
  /** The pattern, as it appears in the design's name. */
  style: string;
  /** The design's name and what it is, as the lists of designs show them. Neither says which grain is on top: that is chosen on the board, not by picking a design. */
  label: string;
  blurb: string;
  /**
   * True for a starter that is another one in the other grain. It is left out of the lists of
   * designs, since the grain is a switch on the board, but still opens by its key.
   */
  twin?: boolean;
  make: () => Design;
}

/** A starter as it is written here: its strips and the steps after the first glue-up, or a whole design. */
const STARTERS: (Omit<Preset, 'make'> & { make: () => Parts | Design })[] = [
  {
    key: 'single-end-grain',
    style: 'end grain',
    label: 'Single wood',
    blurb: 'One species all through: the plain butcher block.',
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
    label: 'Single wood, strips',
    blurb: 'Strips of one species glued side by side, trimmed and flattened.',
    twin: true,
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
    label: 'Stripes',
    blurb: 'Wide maple and cherry strips with thin walnut lines between them.',
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
    key: 'edge-grain-border',
    style: 'stripes with a border',
    label: 'Stripes in a border',
    blurb: '1″ maple strips with 1/8″ purpleheart lines, trimmed square, then a 1″ purpleheart border glued round it. The ends of the border cross the grain of the strips, so keep the board dry and oiled.',
    make: () => ({
      version: 1,
      name: 'Edge grain with a border',
      target: { length: 16, width: 12, thickness: 1.125 },
      layup: {
        // 8 repeats of 1 1/8 plus the closing maple strip is 10″ wide; 14 1/2 stock trims to 14.
        // The 1″ border on every side makes it 16 × 12.
        length: 14.5, thickness: 1.25, repeat: 8, closeWithFirst: true,
        strips: [strip('maple', 1), strip('purpleheart', 0.125)],
      },
      steps: steps(
        // The border needs square ends and flat faces to glue to, so true the panel first.
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'flatten', top: 0.03125, bottom: 0.03125 },
        { type: 'frame', species: 'purpleheart', width: 1, lineSpecies: 'maple', line: 0, block: 3 },
        { type: 'flatten', top: 0.03125, bottom: 0.03125 },
      ),
      customSpecies: [],
    }),
  },
  {
    key: 'maple-purpleheart',
    style: 'grid',
    label: 'Grid',
    blurb: '1″ maple squares with 1/8″ purpleheart lines both ways.',
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
    label: 'Checkerboard',
    blurb: 'Walnut and maple squares, turn about, as many as the size takes.',
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
    label: 'Brick (running bond)',
    blurb: 'One species. Every other row slides half a block, like brickwork.',
    make: () => ({
      version: 1,
      name: 'Hard maple brick',
      target: { length: 16.25, width: 13, thickness: 1.5 },
      layup: {
        length: 24.5, thickness: 1.375, repeat: 7, closeWithFirst: false,
        strips: [strip('maple', 2)],
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
    label: 'Basket weave',
    blurb: 'Walnut bars woven over and under, a maple square at every crossing, a cherry line round everything, in a walnut border. Two panels, each cross cut, then interleaved.',
    make: () => basketWeave(),
  },
  {
    key: 'chevron',
    style: 'chevron',
    label: 'Chevron',
    blurb: 'Three woods cut at 45° and flipped into zigzags.',
    make: () => ({
      version: 1,
      name: 'Three-wood chevron',
      target: { length: 16, width: 10, thickness: 0.8125 },
      layup: {
        // Long for its width: an angled cut only gives full-length slices from the middle of the
        // panel, and it is the slices side by side that make the board's length.
        length: 42, thickness: 1, repeat: 5, closeWithFirst: false,
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
  {
    key: 'tumbling-blocks',
    style: '3D blocks',
    label: '3D Board',
    blurb: 'Tumbling blocks: diamonds in three woods that read as stacked cubes. Made from lengths of hexagonal log stood on end, or in the other grain from flat strips cut and flipped twice.',
    // The counts, the cuts and the trim start as placeholders: `reblock` sets them from the target.
    make: () => {
      const recipe = blockRecipe([{ species: 'maple' }, { species: 'walnut' }, { species: 'cherry' }], 1.25);
      return reblock({
        version: 2,
        name: '3D blocks',
        target: { length: 16, width: 12, thickness: 1.5 },
        // The groove is set in from the edges by the amount asked for: this pattern has no rows of glue lines to line it up with.
        finish: { ...DEFAULT_FINISH, groove: { ...DEFAULT_FINISH.groove, align: false } },
        steps: [{ ...recipe.layup, id: newId(), type: 'strips' }, ...recipe.steps],
        customSpecies: [],
      });
    },
  },
];

/**
 * The starter designs. None is labelled end grain or edge grain: that follows from its steps
 * (see `grainOf`), and is changed by adding or taking out the step that stands the slices up.
 * Each one's `make` returns a fresh design that knows its pattern and is
 * named from its woods, so the name follows when the woods are changed.
 */
/** How hard a design is to make. */
export type Level = 'beginner' | 'intermediate' | 'advanced';

/** The levels, easiest first, with the words that head each group in a list of designs. */
export const LEVELS: { level: Level; label: string }[] = [
  { level: 'beginner', label: 'Beginner' },
  { level: 'intermediate', label: 'Intermediate' },
  { level: 'advanced', label: 'Advanced' },
];

/**
 * Every design on offer, by key, in the order the lists show them: easiest first, by level and
 * then within it. Beginner boards are square cuts and one or two plain glue-ups, with or without
 * a plain border. Intermediate ones add something to get right: an offset, accent strips between
 * the slices, an angled cut. Advanced ones are several glue-ups that must line up with each other, or bevels.
 */
const BY_DIFFICULTY: [string, Level][] = [
  ['single-end-grain', 'beginner'], ['edge-grain-stripes', 'beginner'], ['edge-grain-border', 'beginner'], ['checkerboard', 'beginner'], ['chess', 'beginner'],
  ['brick', 'intermediate'], ['maple-purpleheart', 'intermediate'], ['chevron', 'intermediate'],
  ['double', 'advanced'], ['basket-weave', 'advanced'], ['tumbling-blocks', 'advanced'],
];

/** A design's level, by its key. One not in the list is taken as advanced. */
export const levelOf = (key: string): Level => BY_DIFFICULTY.find(([k]) => k === key)?.[1] ?? 'advanced';

/** Things with a key, in the order the lists of designs show them: easiest first. Any not in the list go last. */
function byDifficulty<T extends { key: string }>(items: T[]): T[] {
  const place = (key: string) => {
    const at = BY_DIFFICULTY.findIndex(([k]) => k === key);
    return at < 0 ? BY_DIFFICULTY.length : at;
  };
  return [...items].sort((a, b) => place(a.key) - place(b.key));
}

/** The starters the lists of designs offer: each design once, whichever grain it starts in, easiest first. */
export const designs = (): Preset[] => byDifficulty(PRESETS.filter((p) => !p.twin));

export const PRESETS: Preset[] = STARTERS.map((p) => ({
  ...p,
  make: () => {
    const made = p.make();
    return withAutoName({ ...('layup' in made ? makeDesign(made) : made), style: p.style, autoName: true }, BUILTIN_SPECIES);
  },
}));

/**
 * A board to build from nothing: the strips and their glue-up, which every recipe starts with,
 * and no more. No pattern, no finishing touches and no feet: everything else is put in by adding
 * steps and ticking what is wanted. It has its own name, which the app does not rewrite, and no
 * pattern to be listed under, so the Target board tile shows it as "Your own design".
 */
export function customDesign(target: Design['target']): Design {
  return makeDesign({
    name: 'Custom board',
    autoName: false,
    target,
    finish: NO_FINISH,
    layup: { length: 18, thickness: 1.25, repeat: 8, closeWithFirst: false, strips: [strip('maple', 1.5)] },
    steps: [],
    customSpecies: [],
  });
}

/** The design a first launch opens with. */
export const defaultDesign = (): Design => PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();

/**
 * The design with a step put in at position `at` of its steps, so after step `at - 1`. Positions
 * past the end, such as a finishing stage, add it as the last step.
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
  return withAutoName(makeDesign({
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
  }), BUILTIN_SPECIES);
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
  return withAutoName(makeDesign({
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
      // Each cut saws out a spacer: its whole width, however thin the blade.
      { type: 'crosscut', width: cell, kerf: o.line, angle: 0, spacer: o.line },
      { type: 'insert', species: o.outer, thickness: o.line, every: 1, ends: true },
      { type: 'glue' },
      flatten,
      { type: 'trim', auto: false, x0: 0, x1: 0, z0: o.line, z1: o.line },
    ),
    customSpecies: [],
  }), BUILTIN_SPECIES);
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
  return withAutoName(makeDesign({
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
  }), BUILTIN_SPECIES);
}

/** One design a board can be started from or changed to, sized to a target when it is made. */
export interface Offer {
  key: string;
  label: string;
  blurb: string;
  /** The pattern as designs made from it carry it (`Design.style`), which is how an open design is matched to its offer. */
  style: string;
  /** How hard it is to make, which is what the lists group and order by. */
  level: Level;
  make: () => Design;
}

/** The woods and sizes a chess board and a double border board start with; all can be changed once the board is open. */
const CHESS = { dark: 'walnut', light: 'maple' };
const DOUBLE = { block: 1.5, line: 0.125, field: 'maple', inner: 'walnut', outer: 'white-oak', spacer: 'poplar' };

/** The square that makes an eight-square chess board as wide as the board asked for, to the nearest 1/8 inch. */
const chessSquare = (target: Design['target']) => Math.max(0.5, Math.round(Math.min(target.length, target.width)) / CHESS_SQUARES);

/** A design resized to the wanted board: length and width by stock, then thickness. */
const sized = (base: Design, target: Design['target']): Design => fitThickness(fitToTarget({ ...base, target }));

/**
 * Every design on offer, easiest first (see `levelOf`), each made at `target` or as near as its
 * pattern allows: the starters, each once, the chess board (eight squares each way, as wide as the board asked for) and
 * the double border board (a whole number of blocks, the nearest to the size). The board wizard
 * shows them as cards and the Target board tile lists them, both under a heading for each level.
 */
export function catalog(target: Design['target']): Offer[] {
  const blocks = {
    along: doubleBorderCount(target.length, DOUBLE.block, DOUBLE.line),
    across: doubleBorderCount(target.width, DOUBLE.block, DOUBLE.line),
  };
  return byDifficulty([
    ...designs().map((p) => ({ key: p.key, label: p.label, blurb: p.blurb, style: p.style, make: () => sized(p.make(), target) })),
    {
      key: 'chess', label: 'Chess board', style: 'chess board',
      blurb: 'For playing on: exactly eight squares each way, so the board is square, as wide as the width asked for.',
      make: () => chessBoard({ ...CHESS, square: chessSquare(target), thickness: target.thickness, grain: 'end' }),
    },
    {
      key: 'double', label: 'Double border', style: 'double border',
      blurb: 'Maple blocks, each ringed with walnut, in a white oak grid. Three glue-ups: strips with a cheap spacer in them, then slices turned on end with a three-strip stack between them, then the panel sawn through each spacer and the oak glued into the kerfs.',
      make: () => doubleBorder({ ...DOUBLE, ...blocks, thickness: target.thickness, grain: 'end' }),
    },
  ]).map((o) => ({ ...o, level: levelOf(o.key) }));
}

/**
 * Which offer an open design was made from, by its pattern, or null for one that matches none
 * (an older file, or a pattern of the user's own). A starter that is another in the other grain
 * counts as that other: the grain is a switch, not a design.
 */
export function offerOf(design: Pick<Design, 'style'>): string | null {
  const preset = PRESETS.find((p) => p.style === design.style);
  if (preset) return preset.twin ? PRESETS.find((q) => !q.twin && preset.label.startsWith(q.label))?.key ?? null : preset.key;
  return design.style === 'chess board' ? 'chess' : design.style === 'double border' ? 'double' : null;
}
