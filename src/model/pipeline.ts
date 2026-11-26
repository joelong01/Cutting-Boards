import { BEVEL_TITLE, BOARDS_TITLE, EMPTY, act, failed, type Action, type Names } from './actions';
import { AS_ASKED, dimensionsOf, milledStrips, sizingOf, withAlong, type Sizing } from './design';
import { inches, roundTo } from './fractions';
import { finishOf } from './finish';
import { newId } from './ids';
import type { AccentStrip, Design, Finish, FinishPart, PatternStrip, Stage, Step, StripSpec } from './types';

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

/**
 * Strips with each spacer no thinner than the saw kerf, when the design sets one. A spacer is
 * glued in to hold a place and is sawn out whole by a later cut. It can be wider than the blade,
 * which then takes it out in two passes (a thin-kerf blade and a 1/8 inch spacer, say, which is
 * easier to mill than a very thin strip); it cannot be narrower, or the cut would take wood from
 * its neighbours.
 */
const sawnOut = (strips: StripSpec[], kerf: number | undefined): StripSpec[] =>
  (kerf === undefined || !strips.some((s) => s.spacer && s.width < kerf) ? strips : strips.map((s) => (s.spacer ? { ...s, width: Math.max(s.width, kerf) } : s)));

/** Every step a design can have. To add one, add it to the `Step` type and describe it here. */
const STEPS: { [K in Step['type']]: StepDef<K> } = {
  strips: {
    title: 'Rip the strips', needs: 'nothing',
    actions: (s, z) => [{ type: 'rip', strips: sawnOut(milledStrips(s, z.grid), z.kerf), thickness: z.alongOn === 'thickness' ? withAlong(s.thickness, z) : s.thickness, length: s.length, repeat: s.repeat, closeWithFirst: s.closeWithFirst,
      // The face-grain 3D board starts from ordinary strips; only the end-grain one's first step is its own.
      blocks: s.blocks?.flat ? undefined : s.blocks,
      kerf: z.kerf,
    }],
    start: () => ({ strips: [{ id: newId(), species: 'maple', width: 1.5 }], thickness: 1.25, length: 18, repeat: 8, closeWithFirst: false }),
  },
  crosscut: {
    title: 'Cross cut', needs: 'panel',
    actions: (s, z) => {
      const blade = z.kerf ?? s.kerf;
      // A cut that saws out a spacer takes the spacer's whole width, which is never less than the blade's.
      const taken = s.spacer ? Math.max(s.spacer, blade) : blade;
      return [{ type: 'crosscut', width: z.alongOn === 'crosscut' && Math.abs(s.width - z.cut) < 1e-9 ? withAlong(s.width, z) : s.width, kerf: taken, angle: s.angle, ...(taken > blade ? { blade } : {}) }];
    },
    start: () => ({ width: 1.25, kerf: 0.125, angle: 0 }),
  },
  // Loose boards are ripped only on an end-grain 3D board, with the blade tilted; the action refuses any others.
  rip: { title: 'Rip the panel', needs: 'panel', orStrips: true, actions: (s, z) => [{ type: 'ripPanel', width: s.width, kerf: z.kerf ?? s.kerf, tilt: s.tilt }], start: () => ({ width: 1.25, kerf: 0.125 }) },
  // Standing the slices up is what makes a board end grain: a quarter turn about each one's length.
  turn: { title: 'Turn to end grain', needs: 'slices', actions: (s) => [{ type: 'rotate', axis: 'z', angle: s.angle ?? 90, sel: s.sel }], start: () => ({ sel: { mode: 'all' } }) },
  flip: { title: 'Flip', needs: 'slices', actions: (s) => [{ type: 'rotate', axis: s.how === 'end' ? 'y' : 'z', angle: 180, sel: s.sel }], start: () => ({ sel: EVERY_OTHER, how: 'end' }) },
  // A slide is measured across the strips, so it keeps its proportion to them when they are scaled.
  shift: { title: 'Offset', needs: 'slices', actions: (s, z) => [{ type: 'shift', sel: s.sel, amount: s.amount * z.scale }], start: () => ({ sel: EVERY_OTHER, amount: 0.5 }) },
  insert: { title: 'Insert accent strips', needs: 'slices', actions: (s) => [{ type: 'millAccents', spec: s }, { type: 'addStrips', spec: s }], start: () => ({ species: 'walnut', thickness: 0.125, every: 1 }) },
  glue: { title: 'Glue up', needs: 'slices', orStrips: true, actions: () => [{ type: 'glue' }], start: () => ({}) },
  trim: { title: 'Trim', needs: 'panel', actions: (s) => [{ type: 'trim', auto: s.auto, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 }], start: () => ({ auto: true, x0: 0, x1: 0, z0: 0, z1: 0 }) },
  flatten: { title: 'Flatten', needs: 'panel', actions: (s) => [{ type: 'flatten', top: s.top, bottom: s.bottom }], start: () => ({ top: 0.0625, bottom: 0.0625 }) },
  rotate: { title: 'Quarter-turn panel', needs: 'panel', actions: () => [{ type: 'rotate', axis: 'y', angle: 90 }], start: () => ({}) },
  frame: { title: 'Add a border', needs: 'panel', actions: (s) => [{ type: 'millBorder', spec: s }, { type: 'borderPanels' }, { type: 'borderCut' }, { type: 'borderEnds' }, { type: 'borderSides' }], start: () => ({ species: 'walnut', width: 1.5, lineSpecies: 'maple', line: 0.125, block: 3 }) },
  // A second panel is the first two steps over again, once the slices are out of the way.
  panel: {
    title: 'Start another panel', needs: 'slices',
    // Three operations at most: mill the pieces (the slices go aside), glue faces onto any planks that take them, glue the panel.
    actions: (s) => {
      const faced = s.strips.some((st) => st.faces && st.faces.thickness > 0 && 2 * st.faces.thickness < s.thickness);
      return [
        { type: 'rip', strips: s.strips, thickness: s.thickness, extra: s.extra, repeat: s.repeat, length: s.length, second: true, loose: faced },
        ...(faced ? [{ type: 'glueFaces' } as const] : []),
        { type: 'glue' },
      ];
    },
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

/** What a step is called in the list and in the view: its type's name, except a rip with the blade tilted and the milling of a 3D board's boards. */
export const stepTitle = (step: Step): string => (
  step.type === 'rip' && step.tilt ? BEVEL_TITLE
    // An end-grain 3D board starts from three boards, not strips.
    : step.type === 'strips' && step.blocks && !step.blocks.flat ? BOARDS_TITLE
      : STEPS[step.type].title);

/** The primitive actions that carry out a step, in order, at the sizes the design's fit gives (as asked for, unless given). */
export function actionsOf(step: Step, sizing: Sizing = AS_ASKED): Action[] {
  return (STEPS[step.type] as StepDef<Step['type']>).actions(step, sizing).map((a) => rounded(a, sizing.grid));
}

/**
 * An action with every length in it rounded to `grid`, the design's rounding step, so that the
 * board is built from the sizes the instructions give and not from finer ones. Lengths smaller
 * than a step are kept (see `roundTo`). A trim is left alone: it is sawn to the size it leaves,
 * not by measuring what comes off. Angles and counts are not lengths.
 */
function rounded(a: Action, grid: number): Action {
  if (!(grid > 0)) return a;
  const r = (v: number) => roundTo(v, grid);
  /** A strip of a glue-up, with its faces. */
  const strip = <S extends StripSpec | PatternStrip>(st: S): S => ({ ...st, width: r(st.width), ...(st.faces ? { faces: { ...st.faces, thickness: r(st.faces.thickness) } } : {}) });
  /** One strip of an inserted stack, with the panel it is cut from when it has one. */
  const accent = <T extends AccentStrip>(t: T): T => ({
    ...t, thickness: r(t.thickness),
    ...(t.pattern ? { pattern: t.pattern.map(strip) } : {}),
    ...(t.offset !== undefined ? { offset: r(t.offset) } : {}),
  });
  switch (a.type) {
    case 'rip':
      return { ...a, strips: a.strips.map(strip), thickness: r(a.thickness), ...(a.length !== undefined ? { length: r(a.length) } : {}), ...(a.extra !== undefined ? { extra: r(a.extra) } : {}) };
    case 'crosscut': return { ...a, width: r(a.width), kerf: r(a.kerf), ...(a.blade !== undefined ? { blade: r(a.blade) } : {}) };
    case 'ripPanel': return { ...a, width: r(a.width), kerf: r(a.kerf) };
    case 'shift': return { ...a, amount: r(a.amount) };
    case 'flatten': return { ...a, top: r(a.top), bottom: r(a.bottom) };
    case 'millAccents': case 'addStrips':
      return { ...a, spec: { ...accent(a.spec), ...(a.spec.more ? { more: a.spec.more.map(accent) } : {}), ...(a.spec.stagger !== undefined ? { stagger: r(a.spec.stagger) } : {}) } };
    case 'millBorder': return { ...a, spec: { ...a.spec, width: r(a.spec.width), line: r(a.spec.line), block: r(a.spec.block) } };
    case 'roundCorners': case 'roundOver': return { ...a, radius: r(a.radius) };
    case 'chamfer': return { ...a, size: r(a.size) };
    case 'addFeet': return { ...a, diameter: r(a.diameter), height: r(a.height), inset: r(a.inset) };
    case 'groove': return { ...a, inset: r(a.inset), width: r(a.width), depth: r(a.depth), cornerRadius: r(a.cornerRadius) };
    case 'grooveTemplate':
      return { ...a, stripWidth: r(a.stripWidth), thickness: r(a.thickness), groove: { ...a.groove, inset: r(a.groove.inset), width: r(a.groove.width), depth: r(a.groove.depth), cornerRadius: r(a.groove.cornerRadius) } };
    default: return a;
  }
}

/**
 * Do a run of actions as one step and return a stage for each: one operation at the bench, one
 * picture, one instruction. A step that is a single action is one stage under the step's own
 * `title`; in a step of several, each stage is named for its action. If any action cannot be
 * done the step is not done at all: the one stage returned is the work as it was, with the error.
 * An action with nothing to do in this case (see `borderPanels`) adds no stage.
 */
export function performEach(prev: Stage, actions: Action[], title: string, names: Names): Stage[] {
  if (actions.length === 1) return [{ ...act(prev, actions[0], names), title }];
  const parts: Stage[] = [];
  let at = prev;
  for (const action of actions) {
    const next = act(at, action, names);
    // An action that hands back the very stage it was given had nothing to do: it adds no stage.
    if (next === at) continue;
    at = next;
    if (at.error) return [failed(prev, title, at.error)];
    parts.push(at);
  }
  return parts.length ? parts : [failed(prev, title, 'This step has nothing to do.')];
}

/**
 * The stages of one step as a single stage under `title`: the work as the last leaves it, with
 * every instruction in turn, all the stock, and any warnings. This is the step seen whole, which
 * is what a step's card in the list shows and what sizes are read from.
 */
function whole(parts: Stage[], title: string): Stage {
  if (parts.length === 1) return parts[0];
  const stock = parts.flatMap((p) => p.stock ?? []);
  const warning = parts.map((p) => p.warning).filter(Boolean).join(' ');
  return {
    ...parts[parts.length - 1], title,
    summary: parts.map((p) => p.summary).filter(Boolean).join(' '),
    stock: stock.length ? stock : undefined,
    warning: warning || undefined,
  };
}

/** Do a run of actions as one step and return the one stage that shows it whole: see `performEach` and `whole`. */
export function perform(prev: Stage, actions: Action[], title: string, names: Names): Stage {
  return whole(performEach(prev, actions, title, names), title);
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
export const FEET_TITLE = 'Add the feet';

/**
 * The stage that shows the board itself finished: the last one, or the one before the feet go
 * on, since feet are drawn under the board and are not part of its size or its wood.
 */
export const finishedBoard = (stages: Stage[]): Stage => [...stages].reverse().find((s) => s.finish !== 'feet') ?? stages[stages.length - 1];

/**
 * Do `actions` as the step called `title`, a stage for each (see `performEach`), if the work is in a state to take it: an earlier step
 * that left nothing on the bench has to be fixed first, and the work must be of the kind the
 * step `needs` (or ripped strips, with `orStrips`). A step that needs nothing is the first one.
 */
function follow(prev: Stage, title: string, needs: Stage['kind'] | 'nothing', orStrips: boolean, actions: Action[], names: Names): Stage[] {
  if (needs === 'nothing') {
    return prev === EMPTY ? performEach(prev, actions, title, names)
      : [failed(prev, title, 'The strips are ripped first. For another panel, use "Start another panel".')];
  }
  if (prev === EMPTY) return [failed(prev, title, 'There is nothing on the bench yet. The first step has to rip the strips.')];
  if (prev.error && !prev.slices.some((s) => s.pieces.length)) return [failed(prev, title, 'Fix the earlier step first.')];
  if (prev.kind !== needs &&!(orStrips && prev.kind === 'strips')) {
    return [failed(prev, title, needs === 'panel'
      ? 'This needs a glued panel. Add a "Glue up" step before it.'
      : 'This works on loose slices. Add a "Cross cut" step before it.')];
  }
  return performEach(prev, actions, title, names);
}

/**
 * Run one step on the previous stage and return its stages, one for each operation in it. Never
 * throws: a step that cannot run returns one stage with an error. Slices set aside are carried
 * through every stage untouched, until "Interleave the slices" uses them up, and what marks the
 * work as a 3D board's (`block`) is carried the same way until its pieces are glued into the
 * block. The step's note goes on its last instruction.
 */
export function stepStages(prev: Stage, step: Step, names: Names, sizing: Sizing = AS_ASKED): Stage[] {
  const def = STEPS[step.type];
  const parts = follow(prev, stepTitle(step), def.needs, !!def.orStrips, actionsOf(step, sizing), names);
  let before = prev;
  for (const out of parts) {
    if (before.aside && !out.aside && (step.type !== 'combine' || out.error)) out.aside = before.aside;
    // A 3D board's pieces stay marked as such until they are glued into its block.
    if (before.block && !('block' in out)) out.block = before.block;
    before = out;
  }
  const last = parts[parts.length - 1];
  if (step.note && !last.error) last.summary = `${last.summary} ${step.note}`.trim();
  return parts;
}

/** Run one step on the previous stage and return it whole, as one stage: see `stepStages`. */
export function applyStep(prev: Stage, step: Step, names: Names, sizing: Sizing = AS_ASKED): Stage {
  return whole(stepStages(prev, step, names, sizing), stepTitle(step));
}

/**
 * Run a design from a clear bench. `parts[i]` are the stages of steps[i], one for each
 * operation, and `steps[i]` is that step whole. When the recipe ends in a sound panel,
 * `finishing` has a stage for each finishing touch the design has turned on, in the order of
 * FINISH_STEPS, and one for sanding and oiling. Warnings are added to both views of a step.
 */
function build(design: Design, names: Names): { parts: Stage[][]; steps: Stage[]; finishing: Stage[] } {
  const parts: Stage[][] = [];
  const sizing = sizingOf(design);
  let at = EMPTY;
  for (const step of design.steps) {
    const made = stepStages(at, step, names, sizing);
    parts.push(made);
    at = made[made.length - 1];
  }
  // A design always has something to show, even one with no steps at all.
  if (!parts.length) parts.push([failed(EMPTY, STEPS.strips.title, 'This design has no steps. Start a new board.')]);
  const steps = parts.map((made, i) => whole(made, design.steps[i] ? stepTitle(design.steps[i]) : made[0].title));
  parts.forEach((made, i) => {
    for (const p of [...made, steps[i]]) p.step = i;
  });
  warnUnflattened(design, steps);
  // What that found about a step seen whole belongs on its last operation too.
  parts.forEach((made, i) => {
    const last = made[made.length - 1];
    if (last !== steps[i] && steps[i].warning && !last.warning) last.warning = steps[i].warning;
  });
  warnTooThin(design, [...new Set([...parts.flat(), ...steps])], names);
  const finishing: Stage[] = [];
  const last = steps[steps.length - 1];
  if (last.kind === 'panel' && !last.error) {
    const finish = finishOf(design);
    // The template is for the groove: without a groove there is nothing to make one for.
    const touches = FINISH_STEPS.filter((t) => finish[t.part].on && (t.part !== 'template' || finish.groove.on));
    for (const t of touches) finishing.push(perform(finishing[finishing.length - 1] ?? last, [rounded(t.action(finish), sizing.grid)], t.title, names));
    if (touches.length) finishing.push(perform(finishing[finishing.length - 1], [{ type: 'sand' }], SAND_TITLE, names));
    // Feet go on last of all, once the board is sanded and oiled, and with or without any other touch.
    if (finish.feet.on) {
      finishing.push(perform(finishing[finishing.length - 1] ?? last, [rounded({ type: 'addFeet', diameter: finish.feet.diameter, height: finish.feet.height, inset: finish.feet.inset }, sizing.grid)], FEET_TITLE, names));
    }
  }
  return { parts, steps, finishing };
}

/**
 * Every stage of a design, in order: one for each operation at the bench, which is what is
 * drawn, played and written out as instructions. Each says which step it belongs to (`step`).
 * A step that is one operation has one stage; "Start another panel" has several.
 */
export function run(design: Design, names: Names = (id) => id): Stage[] {
  const built = build(design, names);
  return [...built.parts.flat(), ...built.finishing];
}

/**
 * The stages of `run` gathered step by step, without running the design again: each step whole
 * (see `whole`), then the finishing stages as they are. The same as `runSteps` gives.
 */
export function wholeSteps(design: Design, stages: Stage[]): Stage[] {
  const out: Stage[] = [];
  for (let i = 0; i < stages.length;) {
    const step = stages[i].step;
    if (step === undefined) {
      out.push(stages[i++]);
      continue;
    }
    let j = i;
    while (j < stages.length && stages[j].step === step) j++;
    out.push(whole(stages.slice(i, j), design.steps[step] ? stepTitle(design.steps[step]) : stages[i].title));
    i = j;
  }
  return out;
}

/**
 * A design's stages with each step seen whole: stages[i] is the result of steps[i], with the
 * instructions and stock of every operation in it, and the finishing stages follow. This is the
 * view for a step's card in the list and for anything that asks what a step leaves.
 */
export function runSteps(design: Design, names: Names = (id) => id): Stage[] {
  const built = build(design, names);
  return [...built.steps, ...built.finishing];
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
    // The logs of a 3D board are cut into pieces as they are: there is no face to flatten on them.
    else if ((step.type === 'crosscut' || step.type === 'rip') && !flat && !stage.warning && !stage.block) {
      stage.warning = 'This panel is cut straight from the glue-up. Add a Flatten step before it and mill the strips thicker to allow for it.';
    }
    if (step.type === 'crosscut' || step.type === 'rip') flat = false;
  });
  const last = stages[stages.length - 1];
  if (!flat && !last.error && !last.warning && last.kind === 'panel') {
    last.warning = 'The finished board is never flattened. Add a Flatten step at the end and allow thickness for it.';
  }
}

/**
 * Add a warning to each step that mills a piece thinner than the design's minimum: the thinnest
 * the planer or sander can work. It reads the stock each stage asks for, so it covers the strips,
 * a second panel and inserted accent strips alike. Existing warnings are kept, and a step with an
 * error is left alone.
 */
function warnTooThin(design: Design, stages: Stage[], names: Names) {
  const min = dimensionsOf(design).minWidth;
  if (!(min > 0)) return;
  for (const stage of stages) {
    if (stage.error) continue;
    const thin = (stage.stock ?? []).filter((l) => Math.min(l.thickness, l.width) < min - 1e-9);
    if (!thin.length) continue;
    const what = [...new Set(thin.map((l) => `${names(l.species)} at ${inches(Math.min(l.thickness, l.width))}`))];
    const text = `Thinner than the ${inches(min)} minimum: ${what.join(', ')}. Make ${what.length > 1 ? 'them' : 'it'} at least that, or lower the minimum under Dimensions.`;
    stage.warning = stage.warning ? `${stage.warning} ${text}` : text;
  }
}

/** Number of separate pieces of wood in a stage. */
export function pieceCount(stage: Stage): number {
  return stage.slices.reduce((n, s) => n + s.pieces.length, 0);
}
