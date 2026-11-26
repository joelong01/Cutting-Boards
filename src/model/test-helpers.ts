import { run as runAll } from './pipeline';
import type { Design, Stage } from './types';

/**
 * A design's stages with its first two, ripping the strips and gluing them up, shown as one
 * stage: the first glue-up, carrying the strips' stock and both instructions, the way any step
 * made of two actions shows, under its old title. So `[0]` is the first glue-up and `[i - 1]`
 * is the result of `steps[i]` for every step after those two.
 *
 * The tests of what a recipe produces were written against that shape, before ripping was a step
 * of its own, and they count stages from the first glue-up. They run through this so that every
 * size, piece, stock line and sentence they expect is still checked, unchanged. Tests of the two
 * first steps themselves use `run` from pipeline.ts.
 *
 * In the same way the finishing steps at the end (corners, chamfer, roundover, groove, sand) are
 * shown as the one stage, titled Finish, that they were before each became a step: the finished
 * board, with their instructions one after another and their warnings likewise.
 */
export function run(design: Design, names?: (speciesId: string) => string): Stage[] {
  const [strips, glued, ...every] = runAll(design, names);
  const rest = every.filter((s) => !s.finish);
  const touches = every.filter((s) => s.finish);
  if (touches.length) {
    const last = touches[touches.length - 1];
    rest.push({
      kind: 'panel', slices: last.slices, size: last.size, title: 'Finish',
      summary: touches.map((s) => s.summary).filter(Boolean).join(' '),
      warning: touches.map((s) => s.warning).filter(Boolean).join(' ') || undefined,
    });
  }
  // With no strips there is nothing to glue: the one stage is the empty panel with the reason.
  if (strips.error) return [{ ...strips, kind: 'panel', slices: [{ pieces: [] }], title: 'First glue-up' }, ...rest];
  return [{ ...glued, title: 'First glue-up', stock: strips.stock, summary: `${strips.summary} ${glued.summary}` }, ...rest];
}
