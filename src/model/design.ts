import { newId } from './ids';
import type { Design, Layup, Step, StripSpec } from './types';

/**
 * How many steps every starter design begins with: rip the strips, then glue them up. They are
 * ordinary entries in the step list. Only the first is required, and it stays first: there is
 * nothing to work on until the strips are made.
 */
export const OPENING_STEPS = 2;

const NO_STRIPS: Layup = { length: 0, thickness: 0, strips: [], repeat: 1, closeWithFirst: false };

/** The strips a design starts from: its first step. A design without one has no strips. */
export function layupOf(design: Pick<Design, 'steps'>): Layup {
  const first = design.steps[0];
  return first?.type === 'strips' ? first : NO_STRIPS;
}

/** The design with some of its first step's settings changed: the strips, their thickness, length or repeat. */
export function withLayup<D extends Pick<Design, 'steps'>>(design: D, patch: Partial<Layup>): D {
  const first = design.steps[0];
  if (first?.type !== 'strips') return design;
  return { ...design, steps: [{ ...first, ...patch }, ...design.steps.slice(1)] };
}

/**
 * A design written as its strips and then the steps that follow the first glue-up, which is how
 * the starter designs are easiest to read.
 */
export interface Parts extends Omit<Design, 'version' | 'steps'> {
  version?: number;
  layup: Layup;
  steps: Step[];
}

/** The design made of those parts: a step that rips the strips, one that glues them, then the rest. */
export function makeDesign(parts: Parts): Design {
  const design = {
    ...parts,
    version: 2,
    steps: [{ ...parts.layup, id: newId(), type: 'strips' }, { id: newId(), type: 'glue' }, ...parts.steps],
  } as Design & { layup?: Layup };
  delete design.layup;
  return design;
}

/** Whether a strip keeps the width asked for when the board is fitted: accent lines and spacers do, unless marked otherwise. */
export function isLocked(strip: StripSpec): boolean {
  return strip.locked ?? (!!strip.spacer || strip.width < 0.375);
}

/** The strips at the widths they are milled to: those that are not locked take the fit's scale. */
export function milledStrips(layup: Pick<Layup, 'strips' | 'scale'>): StripSpec[] {
  const scale = layup.scale ?? 1;
  return scale === 1 ? layup.strips : layup.strips.map((s) => (isLocked(s) ? s : { ...s, width: s.width * scale }));
}

/** The design with its sizes as asked for: without what a fit added to land on the target. */
export function unfitted<D extends Pick<Design, 'steps'>>(design: D): D {
  const layup = layupOf(design);
  return layup.scale === undefined && layup.along === undefined ? design : withLayup(design, { scale: undefined, along: undefined });
}

/**
 * How a design's sizes are adjusted when it is run, from what the fit stored on its first step.
 * `alongOn` says which size `along` is added to: the strips' thickness when any step stands the
 * slices up, else the width of the cross cuts as wide as the first one, else nothing.
 */
export interface Sizing {
  scale: number;
  along: number;
  alongOn: 'thickness' | 'crosscut' | null;
  /** The width of the first cross cut, which marks the cross cuts `along` applies to. */
  cut: number;
}

/** Sizes used exactly as asked for. */
export const AS_ASKED: Sizing = { scale: 1, along: 0, alongOn: null, cut: 0 };

/** The sizing of a design: see `Sizing`. */
export function sizingOf(design: Pick<Design, 'steps'>): Sizing {
  const layup = layupOf(design);
  const cut = design.steps.find((s) => s.type === 'crosscut') as Extract<Step, { type: 'crosscut' }> | undefined;
  const stood = design.steps.some((s) => s.type === 'turn');
  return { scale: layup.scale ?? 1, along: layup.along ?? 0, alongOn: stood ? 'thickness' : cut ? 'crosscut' : null, cut: cut?.width ?? 0 };
}
