import { accentStrips, withAccentStrips } from './accent';
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
 * When a step puts several strips in each gap, each of them is matched on its own. A patterned
 * strip and a border follow a change of wood, by the same rule, but never a change of width.
 */
export function changeStrip(design: Design, stripId: string, patch: Partial<Pick<StripSpec, 'species' | 'width'>>): StripChange {
  const before = design.layup.strips.find((s) => s.id === stripId);
  const followed = { species: false, width: false };
  if (!before) return { design, followed };
  const after = { ...before, ...patch };
  const strips = design.layup.strips.map((s) => (s.id === stripId ? after : s));
  const oldWoodStillUsed = strips.some((s) => s.species === before.species);
  const steps = design.steps.map((step) => {
    // A border in a wood that is swapped out of the strips follows it too.
    if (step.type === 'frame' && after.species !== before.species && !oldWoodStillUsed
      && (step.species === before.species || step.lineSpecies === before.species)) {
      followed.species = true;
      return {
        ...step,
        species: step.species === before.species ? after.species : step.species,
        lineSpecies: step.lineSpecies === before.species ? after.species : step.lineSpecies,
      };
    }
    // So do the strips of a second panel, and the faces glued to them.
    if (step.type === 'panel' && after.species !== before.species && !oldWoodStillUsed) {
      const swap = (id: string) => (id === before.species ? after.species : id);
      const strips = step.strips.map((st) => ({ ...st, species: swap(st.species), ...(st.faces ? { faces: { ...st.faces, species: swap(st.faces.species) } } : {}) }));
      if (JSON.stringify(strips) === JSON.stringify(step.strips)) return step;
      followed.species = true;
      return { ...step, strips };
    }
    if (step.type !== 'insert') return step;
    let changed = false;
    const accents = accentStrips(step).map((a) => {
      if (a.pattern) {
        // A patterned strip is a panel of its own, so its widths are its own. Its woods are the
        // board's woods, though: when a wood is swapped out of the strips, swap it here as well.
        if (after.species === before.species || oldWoodStillUsed) return a;
        const swap = (id: string) => (id === before.species ? after.species : id);
        const pattern = a.pattern.map((st) => ({ ...st, species: swap(st.species), ...(st.faces ? { faces: { ...st.faces, species: swap(st.faces.species) } } : {}) }));
        if (JSON.stringify(pattern) === JSON.stringify(a.pattern) && a.species !== before.species) return a;
        followed.species = true;
        changed = true;
        return { ...a, species: swap(a.species), pattern };
      }
      if (a.species !== before.species) return a;
      let next = a;
      if (after.width !== before.width && Math.abs(a.thickness - before.width) < 1e-9) {
        next = { ...next, thickness: after.width };
        followed.width = true;
      }
      if (after.species !== before.species && !oldWoodStillUsed) {
        next = { ...next, species: after.species };
        followed.species = true;
      }
      changed ||= next !== a;
      return next;
    });
    return changed ? withAccentStrips(step, accents) : step;
  });
  return { design: { ...design, layup: { ...design.layup, strips }, steps }, followed };
}
