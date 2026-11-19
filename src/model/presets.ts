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
    blurb: 'Rip a striped panel into square logs, roll every other log, glue, then cross cut to end grain.',
    make: () => ({
      version: 1,
      name: 'Maple and wenge basket weave',
      target: { length: 16, width: 12.75, thickness: 1.25 },
      layup: {
        length: 13, thickness: 2.25, repeat: 6, closeWithFirst: false,
        strips: [strip('maple', 0.9375), strip('wenge', 0.125), strip('maple', 0.9375), strip('wenge', 0.125)],
      },
      steps: steps(
        // The first glue-up never comes out flat or square: plane it and true the ends first.
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
        { type: 'trim', auto: false, x0: 0.25, x1: 0.25, z0: 0, z1: 0 },
        { type: 'rotate' },
        // Kerf 0: in the shop these logs are glued up one at a time rather than ripped from one panel.
        { type: 'crosscut', width: 2.125, kerf: 0, angle: 0 },
        { type: 'turn', sel: everyOther },
        { type: 'glue' },
        // All from one face: the rolled logs have their thin dark line on the other face, and
        // an even cut would halve it.
        { type: 'flatten', top: 0.125, bottom: 0 },
        { type: 'rotate' },
        { type: 'crosscut', width: 1.375, kerf: 0.125, angle: 0 },
        { type: 'turn', sel: ALL },
        { type: 'flip', sel: everyOther, how: 'end' },
        { type: 'glue' },
        { type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ),
      customSpecies: [],
    }),
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
