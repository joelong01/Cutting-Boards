import { EMPTY, act, failed, type Action, type Names } from './actions';
import { AS_ASKED, milledStrips, sizingOf, type Sizing } from './design';
import { finishOf } from './finish';
import { newId } from './ids';
import type { Design, Finish, FinishPart, Stage, Step, StockLine } from './types';

export { describeSelector, expandStrips, matches } from './actions';

/**
 * What a step of a design is: its name in the list, whether it works on a glued panel or on
 * loose slices, and the primitive actions (see actions.ts) that carry it out, in order. Most
 * steps are one action. Several steps can be the same action with different settings, which is
 * the point: the engine only knows the actions.
 */
interface StepDef<K extends Step['type']> {
  title: string;
  /** What must be on the bench: a glued panel, loose slices, or nothing at all (the first step). */
  needs: Stage['kind'] | 'nothing';
  /** True when the step also takes ripped strips, as gluing up does. */
  orStrips?: boolean;
  /** The actions, with the sizes adjusted the way the design's fit says (see `Sizing`). */
  actions: (step: Extract<Step, { type: K }>, sizing: Sizing) => Action[];
  /** The values a new step of this type starts with, for the "Add a step" buttons. */
  start: () => Omit<Extract<Step, { type: K }>, 'id' | 'type'>;
}

const EVERY_OTHER = { mode: 'every', n: 2, offset: 1 } as const;

/** Every step a design can have. To add one, add it to the `Step` type and describe it here. */
const STEPS: { [K in Step['type']]: StepDef<K> } = {
  strips: {
    title: 'Rip the strips', needs: 'nothing',
    actions: (s, z) => [{ type: 'rip', strips: milledStrips(s), thickness: s.thickness + (z.alongOn === 'thickness' ? z.along : 0), length: s.length, repeat: s.repeat, closeWithFirst: s.closeWithFirst }],
    start: () => ({ strips: [{ id: newId(), species: 'maple', width: 1.5 }], thickness: 1.25, length: 18, repeat: 8, closeWithFirst: false }),
  },
  crosscut: { title: 'Cross cut', needs: 'panel', actions: (s, z) => [{ type: 'crosscut', width: s.width + (z.alongOn === 'crosscut' && Math.abs(s.width - z.cut) < 1e-9 ? z.along : 0), kerf: s.kerf, angle: s.angle }], start: () => ({ width: 1.25, kerf: 0.125, angle: 0 }) },
  rip: { title: 'Rip the panel', needs: 'panel', actions: (s) => [{ type: 'ripPanel', width: s.width, kerf: s.kerf }], start: () => ({ width: 1.25, kerf: 0.125 }) },
  // Standing the slices up is what makes a board end grain: a quarter turn about each one's length.
  turn: { title: 'Turn to end grain', needs: 'slices', actions: (s) => [{ type: 'rotate', axis: 'z', angle: s.angle ?? 90, sel: s.sel }], start: () => ({ sel: { mode: 'all' } }) },
  flip: { title: 'Flip', needs: 'slices', actions: (s) => [{ type: 'rotate', axis: s.how === 'end' ? 'y' : 'z', angle: 180, sel: s.sel }], start: () => ({ sel: EVERY_OTHER, how: 'end' }) },
  // A slide is measured across the strips, so it keeps its proportion to them when they are scaled.
  shift: { title: 'Offset', needs: 'slices', actions: (s, z) => [{ type: 'shift', sel: s.sel, amount: s.amount * z.scale }], start: () => ({ sel: EVERY_OTHER, amount: 0.5 }) },
  insert: { title: 'Insert accent strips', needs: 'slices', actions: (s) => [{ type: 'addStrips', spec: s }], start: () => ({ species: 'walnut', thickness: 0.125, every: 1 }) },
  glue: { title: 'Glue up', needs: 'slices', orStrips: true, actions: () => [{ type: 'glue' }], start: () => ({}) },
  trim: { title: 'Trim', needs: 'panel', actions: (s) => [{ type: 'trim', auto: s.auto, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 }], start: () => ({ auto: true, x0: 0, x1: 0, z0: 0, z1: 0 }) },
  flatten: { title: 'Flatten', needs: 'panel', actions: (s) => [{ type: 'flatten', top: s.top, bottom: s.bottom }], start: () => ({ top: 0.0625, bottom: 0.0625 }) },
  rotate: { title: 'Quarter-turn panel', needs: 'panel', actions: () => [{ type: 'rotate', axis: 'y', angle: 90 }], start: () => ({}) },
  frame: { title: 'Add a border', needs: 'panel', actions: (s) => [{ type: 'border', spec: s }], start: () => ({ species: 'walnut', width: 1.5, lineSpecies: 'maple', line: 0.125, block: 3 }) },
  // A second panel is the first two steps over again, once the slices are out of the way.
  panel: {
    title: 'Start another panel', needs: 'slices',
    actions: (s) => [{ type: 'setAside' }, { type: 'rip', strips: s.strips, thickness: s.thickness, extra: s.extra, repeat: s.repeat, length: s.length }, { type: 'glue' }],
    start: () => ({ strips: [{ id: newId(), species: 'walnut', width: 1 }, { id: newId(), species: 'maple', width: 1 }], thickness: 0.875, extra: 0 }),
  },
  combine: { title: 'Interleave the slices', needs: 'slices', actions: () => [{ type: 'interleave' }], start: () => ({}) },
};

/** What a step type works on: a glued panel, loose slices, or (the first step only) a clear bench. */
export function stepNeeds(type: Step['type']): Stage['kind'] | 'nothing' {
  return STEPS[type].needs;
}

/** Whether a step of this type can follow a stage of this kind. */
export function stepFits(type: Step['type'], kind: Stage['kind']): boolean {
  const def = STEPS[type];
  return def.needs === kind || (!!def.orStrips && kind === 'strips');
}

/** The name of each step type, as the step list shows it. */
export const STEP_TITLES = Object.fromEntries(
  (Object.keys(STEPS) as Step['type'][]).map((type) => [type, STEPS[type].title]),
) as Record<Step['type'], string>;

/** A step of the given type with sensible starting values, for the "Add a step" buttons. */
export function newStep(type: Step['type']): Step {
  return { ...STEPS[type].start(), id: newId(), type } as Step;
}

/** The primitive actions that carry out a step, in order, at the sizes the design's fit gives (as asked for, unless given). */
export function actionsOf(step: Step, sizing: Sizing = AS_ASKED): Action[] {
  return (STEPS[step.type] as StepDef<Step['type']>).actions(step, sizing);
}

/**
 * Do a run of actions as one step and return the one stage that shows for it, under `title`.
 * Its instruction is each action's sentence in turn and its stock is all of theirs. If any
 * action cannot be done the step is not done at all: the work is left as it was, with the error.
 */
export function perform(prev: Stage, actions: Action[], title: string, names: Names): Stage {
  if (actions.length === 1) return { ...act(prev, actions[0], names), title };
  let at = prev;
  const summaries: string[] = [];
  const stock: StockLine[] = [];
  for (const action of actions) {
    at = act(at, action, names);
    if (at.error) return failed(prev, title, at.error);
    if (at.summary) summaries.push(at.summary);
    stock.push(...(at.stock ?? []));
  }
  return { ...at, title, summary: summaries.join(' '), stock: stock.length ? stock : undefined };
}

/**
 * The finishing steps a design can have, in the order they are done. They are not in its list of
 * steps: each is on or off in the design's `finish`, and they always come last.
 */
export const FINISH_STEPS: { part: FinishPart; title: string; action: (f: Required<Finish>) => Action }[] = [
  { part: 'corners', title: 'Round the corners', action: (f) => ({ type: 'roundCorners', radius: f.corners.radius }) },
  { part: 'chamfer', title: 'Chamfer the bottom edges', action: (f) => ({ type: 'chamfer', size: f.chamfer.size }) },
  { part: 'roundover', title: 'Round over the top edges', action: (f) => ({ type: 'roundOver', radius: f.roundover.radius }) },
  {
    part: 'template', title: 'Juice groove template',
    action: (f) => ({ type: 'grooveTemplate', stripWidth: f.template.stripWidth, thickness: f.template.thickness, groove: { inset: f.groove.inset, width: f.groove.width, depth: f.groove.depth, cornerRadius: f.groove.cornerRadius, align: f.groove.align } }),
  },
  { part: 'groove', title: 'Juice groove', action: (f) => ({ type: 'groove', inset: f.groove.inset, width: f.groove.width, depth: f.groove.depth, cornerRadius: f.groove.cornerRadius, align: f.groove.align }) },
];
export const SAND_TITLE = 'Sand and oil';

/**
 * Do `actions` as the step called `title`, if the work is in a state to take it: an earlier step
 * that left nothing on the bench has to be fixed first, and the work must be of the kind the
 * step `needs` (or ripped strips, with `orStrips`). A step that needs nothing is the first one.
 */
function follow(prev: Stage, title: string, needs: Stage['kind'] | 'nothing', orStrips: boolean, actions: Action[], names: Names): Stage {
  if (needs === 'nothing') {
    return prev === EMPTY ? perform(prev, actions, title, names)
      : failed(prev, title, 'The strips are ripped first. For another panel, use "Start another panel".');
  }
  if (prev === EMPTY) return failed(prev, title, 'There is nothing on the bench yet. The first step has to rip the strips.');
  if (prev.error && !prev.slices.some((s) => s.pieces.length)) return failed(prev, title, 'Fix the earlier step first.');
  if (prev.kind !== needs &&!(orStrips && prev.kind === 'strips')) {
    return failed(prev, title, needs === 'panel'
      ? 'This needs a glued panel. Add a "Glue up" step before it.'
      : 'This works on loose slices. Add a "Cross cut" step before it.');
  }
  return perform(prev, actions, title, names);
}

/**
 * Run one step on the previous stage and return the new stage. Never throws: a step that cannot
 * run returns a stage with an error. Slices set aside are carried through every step untouched,
 * until "Interleave the slices" uses them up.
 */
export function applyStep(prev: Stage, step: Step, names: Names, sizing: Sizing = AS_ASKED): Stage {
  const def = STEPS[step.type];
  const out = follow(prev, def.title, def.needs, !!def.orStrips, actionsOf(step, sizing), names);
  if (prev.aside && !out.aside && (step.type !== 'combine' || out.error)) out.aside = prev.aside;
  return out;
}

/**
 * stages[i] is the result of steps[i], starting from a clear bench: in every starter design
 * stages[0] is the strips, ripped, and stages[1] the first glue-up. When the recipe ends in a sound panel, a stage follows for each finishing
 * touch the design has turned on, in the order of FINISH_STEPS, and one for sanding and oiling.
 */
export function run(design: Design, names: Names = (id) => id): Stage[] {
  const stages: Stage[] = [];
  const sizing = sizingOf(design);
  for (const step of design.steps) stages.push(applyStep(stages[stages.length - 1] ?? EMPTY, step, names, sizing));
  // A design always has something to show, even one with no steps at all.
  if (!stages.length) stages.push(failed(EMPTY, STEPS.strips.title, 'This design has no steps. Start a new board.'));
  warnUnflattened(design, stages);
  const last = stages[stages.length - 1];
  if (last.kind === 'panel' && !last.error) {
    const finish = finishOf(design);
    // The template is for the groove: without a groove there is nothing to make one for.
    const touches = FINISH_STEPS.filter((t) => finish[t.part].on && (t.part !== 'template' || finish.groove.on));
    for (const t of touches) stages.push(perform(stages[stages.length - 1], [t.action(finish)], t.title, names));
    if (touches.length) stages.push(perform(stages[stages.length - 1], [{ type: 'sand' }], SAND_TITLE, names));
  }
  return stages;
}

/**
 * Add a warning wherever a glue-up is used without being flattened first: cross cut straight
 * from the clamps, or left as the finished board. A glued panel is never flat, so the recipe
 * needs a Flatten step, and thickness to lose in it, before that point. Existing warnings and
 * errors are kept.
 */
function warnUnflattened(design: Design, stages: Stage[]) {
  // flat[i]: has stage i been flattened since it was last glued?
  let flat = false;
  design.steps.forEach((step, i) => {
    const stage = stages[i];
    if (stage.error) return;
    if (step.type === 'flatten') flat = true;
    // A border is a glue-up too: it never goes on perfectly level with the faces.
    else if (step.type === 'glue' || step.type === 'frame' || step.type === 'panel') flat = false;
    else if ((step.type === 'crosscut' || step.type === 'rip') && !flat && !stage.warning) {
      stage.warning = 'This panel is cut straight from the glue-up. Add a Flatten step before it and mill the strips thicker to allow for it.';
    }
    if (step.type === 'crosscut' || step.type === 'rip') flat = false;
  });
  const last = stages[stages.length - 1];
  if (!flat && !last.error && !last.warning && last.kind === 'panel') {
    last.warning = 'The finished board is never flattened. Add a Flatten step at the end and allow thickness for it.';
  }
}

/** Number of separate pieces of wood in a stage. */
export function pieceCount(stage: Stage): number {
  return stage.slices.reduce((n, s) => n + s.pieces.length, 0);
}
