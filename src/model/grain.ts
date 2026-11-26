import { isBlocks } from './blocks';
import { turnedBlocks } from './blocksFlat';
import { OPENING_STEPS, layupOf, unfitted, withLayup } from './design';
import { fitThickness, fitToTarget } from './fit';
import { newId } from './ids';
import type { Design, Step } from './types';

/** Which face of the wood ends up on top of the finished board. */
export type Grain = 'end' | 'edge';

/** The grain a design's recipe puts on top: end grain if any step turns slices up on end. A 3D board's two recipes do and do not. */
export function grainOf(design: Design): Grain {
  return design.steps.some((s) => s.type === 'turn') ? 'end' : 'edge';
}

/** What a flattening takes off both faces in all, or 0 for any other step. */
const flatOff = (s: Step) => (s.type === 'flatten' ? s.top + s.bottom : 0);

/**
 * The same pattern built the other way up, or null when this recipe cannot be turned round.
 *
 * The pattern comes from the strips, the cuts, the flips and the offsets; the grain comes only
 * from whether the slices are turned up on end after the first cross cut. So:
 *
 * - **End to edge**: the turns come out. What stood up becomes the board's thickness, so the
 *   stock thickness and the first cross cut swap: the cut makes the blocks as wide as the stock
 *   was thick, and the stock is milled as thick as the slices were cut (so squares stay square).
 * - **Edge to end**: a turn goes in after the first cross cut, with the same swap. A recipe with
 *   no cross cut (stripes, a bordered board) gets one, with a turn and a glue-up, after the
 *   panel is first trued: cut it into slices as wide as the stock is thick and stand them up.
 *
 * Either way the sizes are only a starting point: fit the result to its target, and its thickness
 * with `fitThickness`, before using it. Returns null for recipes this does not understand: ones
 * built from several panels (basket weave), ones that turn only some slices, angled cuts,
 * whose slices would stand up at a slant. A 3D board is turned by swapping its whole recipe for
 * the other one (`turnedBlocks`).
 */
export function convertGrain(asFitted: Design, to: Grain): Design | null {
  if (grainOf(asFitted) === to) return asFitted;
  // A 3D board has a recipe of its own for each grain: lengths of log on end, or flat diamond tiles.
  if (isBlocks(asFitted)) return turnedBlocks(asFitted, to === 'edge');
  // Work from the sizes asked for: what the last fit added belongs to the board as it was.
  const design = unfitted(asFitted);
  const steps = design.steps;
  if (steps.some((s) => s.type === 'panel' || s.type === 'combine')) return null;
  const cutAt = steps.findIndex((s) => s.type === 'crosscut');
  const cut = cutAt >= 0 ? (steps[cutAt] as Extract<Step, { type: 'crosscut' }>) : null;
  if (cut && cut.angle !== 0) return null;
  // Flattening done before the cross cut comes off the stock's thickness, not the slices'.
  const before = steps.slice(0, cutAt >= 0 ? cutAt : steps.length).reduce((t, s) => t + flatOff(s), 0);

  if (to === 'edge') {
    if (!cut || steps.some((s) => s.type === 'turn' && s.sel.mode !== 'all')) return null;
    const stock = cut.width + before;
    const width = Math.max(0.125, layupOf(design).thickness - before);
    return withLayup({
      ...design,
      steps: steps.filter((s) => s.type !== 'turn').map((s) => (s === cut ? { ...cut, width } : s)),
    }, { thickness: stock });
  }

  const turn: Step = { id: newId(), type: 'turn', sel: { mode: 'all' } };
  if (cut) {
    const stock = cut.width + before;
    const width = Math.max(0.125, layupOf(design).thickness - before);
    return withLayup({
      ...design,
      steps: [...steps.slice(0, cutAt), { ...cut, width }, turn, ...steps.slice(cutAt + 1)],
    }, { thickness: stock });
  }
  // No cross cut: true the panel as it was, then cut it up, stand the slices on end and glue
  // them back together before anything else (a border, say) goes on.
  let at = OPENING_STEPS;
  while (at < steps.length && (steps[at].type === 'trim' || steps[at].type === 'flatten')) at++;
  const trued = steps.slice(0, at).reduce((t, s) => t + flatOff(s), 0);
  const slice: Step = { id: newId(), type: 'crosscut', width: Math.max(0.125, layupOf(design).thickness - trued), kerf: 0.125, angle: 0 };
  const glue: Step = { id: newId(), type: 'glue' };
  return { ...design, steps: [...steps.slice(0, at), slice, turn, glue, ...steps.slice(at)] };
}

/**
 * The design built with `grain` up, ready to use: turned round by `convertGrain`, refitted to its
 * target length and width when "Keep the board at this size" is on, and to its target thickness
 * either way, since the turn changes which of the stock and the cross cut sets the thickness.
 * Null when the recipe cannot be turned round; the design itself when it already has that grain.
 */
export function withGrain(design: Design, grain: Grain): Design | null {
  if (grainOf(design) === grain) return design;
  const turned = convertGrain(design, grain);
  if (!turned) return null;
  return fitThickness(design.autoFit === false ? turned : fitToTarget(turned));
}
