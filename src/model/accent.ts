import type { AccentStrip, Step } from './types';

export type InsertStep = Extract<Step, { type: 'insert' }>;

/** A strip with only the fields it uses, so a plain strip carries no empty pattern or offset. */
function tidy(a: AccentStrip): AccentStrip {
  const out: AccentStrip = { species: a.species, thickness: a.thickness };
  if (a.pattern?.length) {
    out.pattern = a.pattern;
    if (a.offset) out.offset = a.offset;
  }
  return out;
}

/**
 * The strips an "Insert accent strips" step puts in each gap, in order. The first is the step's
 * own `species`, `thickness`, `pattern` and `offset`, which is all a design saved before a gap
 * could hold several strips has; any others are in `more`.
 */
export function accentStrips(step: InsertStep): AccentStrip[] {
  return [tidy(step), ...(step.more ?? []).map(tidy)];
}

/** The step with its strips replaced by `strips`, in order. An empty list leaves the step as it was: a gap always holds at least one strip. */
export function withAccentStrips(step: InsertStep, strips: AccentStrip[]): InsertStep {
  if (!strips.length) return step;
  const [first, ...more] = strips.map(tidy);
  const next: InsertStep = { ...step, species: first.species, thickness: first.thickness };
  delete next.pattern;
  delete next.offset;
  if (first.pattern) next.pattern = first.pattern;
  if (first.offset) next.offset = first.offset;
  if (more.length) next.more = more;
  else delete next.more;
  return next;
}

/** The width of one repeat of a patterned strip's pattern. */
export function patternPeriod(a: AccentStrip): number {
  return (a.pattern ?? []).reduce((w, s) => w + s.width, 0);
}
