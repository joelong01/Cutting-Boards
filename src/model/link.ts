import type { Design, StripSpec } from './types';

export interface StripChange {
  design: Design;
  /** What followed along in the "Insert accent strips" steps, for telling the user. */
  followed: { species: boolean; width: boolean };
}

/**
 * Change one strip's wood, width or both, and carry the change to the accent strips that are the
 * same line running the other way.
 *
 * On a grid board the thin lines one way are strips in the first glue-up and the lines the other
 * way are inserted at a later step. They are two settings, but to the person editing the strips
 * they are one accent line. So an "Insert accent strips" step follows a strip when it matched it
 * before the change:
 *
 * - wood: the step used the strip's old wood, and no other strip still uses that wood;
 * - width: the step used the strip's wood and its thickness equalled the strip's old width.
 *
 * A step set to a different wood or thickness on purpose does not match, and is left alone.
 */
export function changeStrip(design: Design, stripId: string, patch: Partial<Pick<StripSpec, 'species' | 'width'>>): StripChange {
  const before = design.layup.strips.find((s) => s.id === stripId);
  const followed = { species: false, width: false };
  if (!before) return { design, followed };
  const after = { ...before, ...patch };
  const strips = design.layup.strips.map((s) => (s.id === stripId ? after : s));
  const oldWoodStillUsed = strips.some((s) => s.species === before.species);
  const steps = design.steps.map((step) => {
    if (step.type !== 'insert' || step.species !== before.species) return step;
    let next = step;
    if (after.width !== before.width && Math.abs(step.thickness - before.width) < 1e-9) {
      next = { ...next, thickness: after.width };
      followed.width = true;
    }
    if (after.species !== before.species && !oldWoodStillUsed) {
      next = { ...next, species: after.species };
      followed.species = true;
    }
    return next;
  });
  return { design: { ...design, layup: { ...design.layup, strips }, steps }, followed };
}
