import { describe, expect, it } from 'vitest';
import { ACTIONS, EMPTY, act, type Action } from './actions';
import { bbox, volume } from './geometry';
import { grainOf } from './grain';
import { buildCutList } from './cutlist';
import { layupOf, withLayup } from './design';
import { fitToTarget } from './fit';
import { parseLength } from './fractions';
import { actionsOf, applyStep, perform, run } from './pipeline';
import { PRESETS, newStep } from './presets';
import type { Design, Stage, Step } from './types';

const names = (id: string) => id;
/** Total volume of the wood on the bench. */
const vol = (s: Stage) => s.slices.reduce((v, sl) => v + sl.pieces.reduce((a, p) => a + volume(p), 0), 0);
/** A panel of two strips, 12 long and 1 thick, cross cut into slices 1.5 wide. */
const sliced = (): Stage => {
  const strips = act(EMPTY, { type: 'rip', strips: [{ id: 'a', species: 'maple', width: 2 }, { id: 'b', species: 'walnut', width: 2 }], thickness: 1, length: 12, repeat: 2 }, names);
  return act(act(strips, { type: 'glue' }, names), { type: 'crosscut', width: 1.5, kerf: 0.125, angle: 0 }, names);
};
const ALL = { mode: 'all' } as const;

describe('primitive actions', () => {
  it('a design is its steps\' actions, done in order from a clear bench: rip the strips, glue them up, and on', () => {
    const design = PRESETS.find((p) => p.key === 'checkerboard')!.make();
    expect(design.steps.slice(0, 2).map((s) => s.type)).toEqual(['strips', 'glue']);
    const actions: Action[] = design.steps.flatMap((s) => actionsOf(s));
    expect(actions.slice(0, 2).map((a) => a.type)).toEqual(['rip', 'glue']);
    const end = actions.reduce((stage, action) => act(stage, action, names), EMPTY);
    // The stage of the last step; the Finish stage, if there is one, comes after it.
    const last = run(design, names)[design.steps.length - 1];
    expect(end.size).toEqual(last.size);
    expect(vol(end)).toBeCloseTo(vol(last), 9);
    expect(end.slices[0].pieces.map((p) => p.species)).toEqual(last.slices[0].pieces.map((p) => p.species));
  });

  it('every step is made of actions the engine knows', () => {
    const types = ['strips', 'rip', 'crosscut', 'turn', 'flip', 'shift', 'insert', 'glue', 'trim', 'flatten', 'rotate', 'frame', 'panel', 'combine'] as const;
    for (const type of types) {
      const actions = actionsOf(newStep(type));
      expect(actions.length, type).toBeGreaterThan(0);
      for (const a of actions) expect(ACTIONS[a.type], `${type}: ${a.type}`).toBeTypeOf('function');
    }
  });

  it('turning to end grain, flipping and the quarter turn are all the one rotate action', () => {
    expect(actionsOf({ id: 't', type: 'turn', sel: ALL })).toEqual([{ type: 'rotate', axis: 'z', angle: 90, sel: ALL }]);
    expect(actionsOf({ id: 'f', type: 'flip', sel: ALL, how: 'end' })).toEqual([{ type: 'rotate', axis: 'y', angle: 180, sel: ALL }]);
    expect(actionsOf({ id: 'f', type: 'flip', sel: ALL, how: 'face' })).toEqual([{ type: 'rotate', axis: 'z', angle: 180, sel: ALL }]);
    expect(actionsOf({ id: 'r', type: 'rotate' })).toEqual([{ type: 'rotate', axis: 'y', angle: 90 }]);
  });

  it('rotate 90 about a slice\'s length stands it up: its fibres point up and its width and height swap', () => {
    const before = sliced();
    const after = act(before, { type: 'rotate', axis: 'z', angle: 90, sel: ALL }, names);
    expect(before.slices[0].pieces[0].grain.map((n) => Math.abs(Math.round(n)))).toEqual([1, 0, 0]);
    expect(after.slices[0].pieces[0].grain.map((n) => Math.abs(Math.round(n)))).toEqual([0, 1, 0]);
    const a = bbox(before.slices[0].pieces), b = bbox(after.slices[0].pieces);
    expect(+(b.max[1] - b.min[1]).toFixed(6)).toBe(+(a.max[0] - a.min[0]).toFixed(6));
    expect(+(b.max[0] - b.min[0]).toFixed(6)).toBe(+(a.max[1] - a.min[1]).toFixed(6));
    expect(after.summary).toMatch(/^Roll onto its side, end grain up: every slice/);
  });

  it('rotate takes any angle: 45 leans the slices over, keeps all the wood and says the angle', () => {
    const before = sliced();
    const after = act(before, { type: 'rotate', axis: 'z', angle: 45, sel: ALL }, names);
    expect(after.error).toBeUndefined();
    expect(vol(after)).toBeCloseTo(vol(before), 9);
    const g = after.slices[0].pieces[0].grain;
    expect(Math.abs(g[0])).toBeCloseTo(Math.SQRT1_2, 9);
    expect(Math.abs(g[1])).toBeCloseTo(Math.SQRT1_2, 9);
    expect(after.summary).toMatch(/^Turn 45° about its length: every slice/);
    // The same through a step of a design.
    const step: Step = { id: 't', type: 'turn', sel: ALL, angle: 45 };
    expect(applyStep(before, step, names).slices[0].pieces[0].grain).toEqual(g);
  });

  it('a board is end grain or edge grain only by whether its steps stand the slices up', () => {
    const design = PRESETS.find((p) => p.key === 'checkerboard')!.make();
    expect(grainOf(design)).toBe('end');
    const flat = { ...design, steps: design.steps.filter((s) => s.type !== 'turn') };
    expect(grainOf(flat)).toBe('edge');
    /** Whether the wood of the last panel before finishing has its fibres pointing up. */
    const up = (d: Design) => Math.abs(run(d)[d.steps.length - 1].slices[0].pieces[0].grain[1]) > 0.9;
    expect(up(design)).toBe(true);
    expect(up(flat)).toBe(false);
  });

  it('a second panel is setting the slices aside, then ripping strips and gluing them up again', () => {
    const before = sliced();
    const step = { ...newStep('panel'), thickness: 0.75 } as Extract<Step, { type: 'panel' }>;
    expect(actionsOf(step).map((a) => a.type)).toEqual(['setAside', 'rip', 'glue']);
    const aside = act(before, { type: 'setAside' }, names);
    expect(aside.slices).toHaveLength(0);
    expect(aside.aside).toHaveLength(before.slices.length);
    const strips = act(aside, { type: 'rip', strips: step.strips, thickness: 0.75, extra: 0 }, names);
    // The slices set aside wait through both actions.
    expect(strips.aside).toHaveLength(before.slices.length);
    const panel = act(strips, { type: 'glue' }, names);
    const viaStep = applyStep(before, step, names);
    expect(panel.size).toEqual(viaStep.size);
    // The step's instruction is its three actions' sentences, one after another.
    expect(viaStep.summary).toBe(`${aside.summary} ${strips.summary} ${panel.summary}`);
    expect(viaStep.stock).toEqual(strips.stock);
    expect(viaStep.aside).toHaveLength(before.slices.length);
  });

  it('a step whose second action cannot be done leaves the work as it was', () => {
    const before = sliced();
    const out = perform(before, [{ type: 'setAside' }, { type: 'rip', strips: [], thickness: 1 }, { type: 'glue' }], 'Start another panel', names);
    expect(out.error).toBe('The panel needs at least one strip.');
    expect(out.slices).toHaveLength(before.slices.length);
    expect(out.aside).toBeUndefined();
  });

  it('the first step rips the strips and the second glues them: the blanks, then the panel', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const [strips, glued, flattened] = run(design, names);
    expect([strips.title, glued.title, flattened.title]).toEqual(['Rip the strips', 'Glue up', 'Flatten']);
    // 10 repeats of maple and purpleheart and a closing maple strip: 21 loose strips, in order across the width.
    expect(strips.kind).toBe('strips');
    expect(strips.slices).toHaveLength(21);
    expect(strips.slices.map((s) => s.pieces[0].species).slice(0, 3)).toEqual(['maple', 'purpleheart', 'maple']);
    const starts = strips.slices.map((s) => bbox(s.pieces).min[2]);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // The stock is what the ripping needs; the glue-up needs none of its own.
    expect(strips.stock!.map((l) => [l.species, l.count, l.width])).toEqual([['maple', 11, 1], ['purpleheart', 10, 0.125]]);
    expect(glued.stock).toBeUndefined();
    // Each instruction says only what its own action does.
    // Each size to be milled is counted out: how many of which wood, at which width.
    expect(strips.summary).toBe('Mill 21 strips in 2 sizes, all 1 1/8″ thick and 20 1/2″ long: 11 maple strips 1″ wide and 10 purpleheart strips 1/8″ wide.');
    // A board of one wood at one width is a single size, said in one plain sentence.
    const plain = run(PRESETS.find((p) => p.key === 'single-end-grain')!.make(), names)[0];
    expect(plain.summary).toMatch(/^Mill \d+ \S.* strips [^,]+ wide, [^,]+ thick and [^,]+ long\.$/);
    expect(glued.summary).toBe('Glue them edge to edge in order into a panel 12 1/4″ wide.');
    // Gluing changes nothing but that the strips are now one panel.
    expect(glued.kind).toBe('panel');
    expect(glued.slices).toHaveLength(1);
    expect(glued.size).toEqual(strips.size);
    expect(vol(glued)).toBeCloseTo(vol(strips), 9);
  });

  it('the order of operations has a line for each step, the ripping and the first glue-up among them', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const list = buildCutList(run(design, names), design);
    expect(list.operations.slice(0, 3).map((o) => o.title)).toEqual(['Rip the strips', 'Glue up', 'Flatten']);
    // The design's steps, four finishing touches and the sanding.
    expect(list.operations).toHaveLength(design.steps.length + 5);
  });

  it('with no strips the ripping says so and the glue-up waits for it', () => {
    const design = PRESETS.find((p) => p.key === 'brick')!.make();
    const [strips, glued] = run(withLayup(design, { strips: [] }), names);
    expect(strips.error).toBe('The layup has no strips.');
    expect(glued.error).toBe('Fix the earlier step first.');
  });

  it('each finishing touch is a step of its own, with its own instruction and its own cut', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const stages = run(design, names);
    const first = design.steps.length;
    const touches = stages.slice(first);
    expect(touches.map((s) => s.title)).toEqual(['Round the corners', 'Chamfer the bottom edges', 'Round over the top edges', 'Juice groove', 'Sand and oil']);
    expect(touches.map((s) => s.finish)).toEqual(['corners', 'chamfer', 'roundover', 'groove', 'sand']);
    expect(touches[0].summary).toMatch(/^Round the four corners to a 1\/2″ radius/);
    expect(touches[1].summary).toMatch(/^Chamfer the bottom edges 1\/4″ at 45°/);
    expect(touches[2].summary).toMatch(/^Round over the top edges all the way round with a 1\/8″ roundover bit\.$/);
    expect(touches[3].summary).toMatch(/^Rout a juice groove in the top/);
    expect(touches[4].summary).toBe('Sand through the grits and oil.');
    // No instruction mentions another touch.
    expect(touches[1].summary).not.toMatch(/corner|groove|Round over/);
    // Each cut takes wood off; sanding takes none.
    const volumes = [stages[first - 1], ...touches].map(vol);
    for (let i = 1; i <= 4; i++) expect(volumes[i], touches[i - 1].title).toBeLessThan(volumes[i - 1] - 1e-6);
    expect(volumes[5]).toBe(volumes[4]);
    // The board keeps its overall size through all of them.
    for (const t of touches) expect(t.size).toEqual(stages[first - 1].size);
  });

  it('turning a finishing touch off takes out its step and nothing else', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const finish = { ...design.finish!, ...{ chamfer: { on: false, size: 0.25 } } };
    const all = run(design, names), without = run({ ...design, finish: { groove: all ? { on: true, inset: 0.75, width: 0.5, depth: 0.25, cornerRadius: 0, align: true } : finish.groove, chamfer: { on: false, size: 0.25 }, corners: { on: true, radius: 0.5 }, roundover: { on: true, radius: 0.125 } } }, names);
    expect(without.map((s) => s.title).slice(-4)).toEqual(['Round the corners', 'Round over the top edges', 'Juice groove', 'Sand and oil']);
    expect(without).toHaveLength(all.length - 1);
    // The corners are cut first either way, so that stage is the same board.
    const at = design.steps.length;
    expect(vol(without[at])).toBeCloseTo(vol(all[at]), 9);
    // With every touch off there are no finishing steps at all, not even the sanding.
    const none = run({ ...design, finish: { groove: { on: false, inset: 0.75, width: 0.5, depth: 0.25, cornerRadius: 0, align: true }, chamfer: { on: false, size: 0.25 }, corners: { on: false, radius: 0.5 }, roundover: { on: false, radius: 0.125 } } }, names);
    expect(none).toHaveLength(at);
  });

  it('a finishing touch that does not fit says so on its own step and leaves the board alone', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const stages = run({ ...design, finish: { groove: { on: true, inset: 0.75, width: 0.5, depth: 0.25, cornerRadius: 0, align: true }, chamfer: { on: true, size: 0.25 }, corners: { on: true, radius: 20 }, roundover: { on: true, radius: 0.125 } } }, names);
    const at = design.steps.length;
    expect(stages[at].title).toBe('Round the corners');
    expect(stages[at].warning).toMatch(/^Corners of 20″ radius do not fit/);
    expect(stages[at].summary).toBe('');
    expect(vol(stages[at])).toBeCloseTo(vol(stages[at - 1]), 9);
    // The touches after it are done as usual and carry no warning of their own.
    expect(stages[at + 1].warning).toBeUndefined();
    expect(vol(stages[at + 1])).toBeLessThan(vol(stages[at]) - 1e-6);
  });

  it('a roundover too big for the board says what is in the way and the largest bit that fits', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const finish = { groove: { on: false, inset: 0.75, width: 0.5, depth: 0.25, cornerRadius: 0, align: true }, chamfer: { on: true, size: 0.25 }, corners: { on: false, radius: 0.5 }, roundover: { on: true, radius: 1 } };
    const over = (f: typeof finish) => run({ ...design, finish: f }, names).find((s) => s.title === 'Round over the top edges')!;
    // 1 1/8 thick less the 1/4 chamfer and a 1/16 land leaves 13/16 for the bit.
    expect(over(finish).warning).toBe('Not cut: a 1″ roundover does not fit a board 1 1/8″ thick with a 1/4″ chamfer underneath. The largest that fits is 13/16″.');
    expect(over({ ...finish, roundover: { on: true, radius: 0.8125 } }).warning).toBeUndefined();
    // With no chamfer the whole thickness less the land is there: 1 1/16, so 1 fits.
    expect(over({ ...finish, chamfer: { on: false, size: 0.25 } }).warning).toBeUndefined();
    expect(over({ ...finish, chamfer: { on: false, size: 0.25 }, roundover: { on: true, radius: 2 } }).warning).toBe('Not cut: a 2″ roundover does not fit a board 1 1/8″ thick. The largest that fits is 1 1/16″.');
  });

  it('a groove lined up with the pattern is set in eighths from the edge, never an odd decimal', () => {
    // Fitted to its size, this board's blocks are 0.941 wide, so the middle of a row is no round number.
    for (const key of ['maple-purpleheart', 'checkerboard', 'brick', 'edge-grain-stripes']) {
      const design = fitToTarget(PRESETS.find((p) => p.key === key)!.make());
      const groove = run(design, names).find((s) => s.title === 'Juice groove')!;
      expect(groove.warning, key).toBeUndefined();
      const said = /its outer edge (.*?)\. /.exec(groove.summary)![1];
      const lengths = [...said.matchAll(/(\d+ \d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)″/g)].map((m) => parseLength(m[1])!);
      expect(lengths.length, key).toBeGreaterThan(0);
      for (const v of lengths) expect(Math.abs(v * 8 - Math.round(v * 8)), `${key}: ${said}`).toBeLessThan(1e-9);
      // Each stays within 1/16 of the 3/4 asked for plus the nudge to the pattern, and off the edge.
      for (const v of lengths) expect(v, key).toBeGreaterThanOrEqual(0.375);
      expect(groove.summary, key).toMatch(/evenly on the pattern, to the nearest 1\/8″/);
    }
  });

  it('the juice groove template is a step before the groove: a frame on top of the board, its outside edge on the groove\'s inner edge', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const finish = { groove: { on: true, inset: 0.75, width: 0.5, depth: 0.25, cornerRadius: 0, align: false }, chamfer: { on: true, size: 0.25 }, corners: { on: true, radius: 0.5 }, roundover: { on: true, radius: 0.125 }, template: { on: true, stripWidth: 2, thickness: 0.5 } };
    const stages = run({ ...design, finish }, names);
    const titles = stages.slice(design.steps.length).map((s) => s.title);
    expect(titles).toEqual(['Round the corners', 'Chamfer the bottom edges', 'Round over the top edges', 'Juice groove template', 'Juice groove', 'Sand and oil']);
    const at = stages.findIndex((s) => s.title === 'Juice groove template');
    const [X, T, Z] = stages[at].size;
    const frame = stages[at].slices[0].pieces.filter((p) => p.species === 'template');
    expect(frame).toHaveLength(4);
    // It lies on the top, 1/2 thick, and its outside is 3/4 + 1/2 in from every edge: the groove's inner edge.
    const b = bbox(frame);
    expect(b.min.map((v) => +v.toFixed(6))).toEqual([1.25, T, 1.25]);
    expect(b.max.map((v) => +v.toFixed(6))).toEqual([X - 1.25, T + 0.5, Z - 1.25]);
    expect(frame.reduce((v, p) => v + volume(p), 0)).toBeCloseTo(0.5 * ((X - 2.5) * (Z - 2.5) - (X - 6.5) * (Z - 6.5)), 6);
    // Nothing is cut: the board under it is the board the roundover left.
    const board = stages[at].slices[0].pieces.filter((p) => p.species !== 'template');
    expect(board.reduce((v, p) => v + volume(p), 0)).toBeCloseTo(vol(stages[at - 1]), 9);
    expect(stages[at].summary).toMatch(/^Make a template for the router to rest on and run round: a frame .* of strips 2″ wide and 1\/2″ thick, two .* long and two .* long between them, its outside corners left square\. Stick it to the top of the board with double-sided tape, its outside edge 1 1\/4″ in from the two ends and 1 1\/4″ in from the two long sides\./);
    // The template is gone from the groove step, which is cut round it: the bearing rolls round the square corners.
    expect(stages[at + 1].slices[0].pieces.some((p) => p.species === 'template')).toBe(false);
    expect(stages[at + 1].summary).toMatch(/Keep the router flat on the template/);
    expect(stages[at + 1].summary).toMatch(/outside corners rounded to a 1\/2″ radius and the inside corners sharp/);
    // Rolling round the corners takes a little less wood than a path that turns them square.
    const square = run({ ...design, finish: { ...finish, template: { ...finish.template, on: false } } }, names);
    expect(square.map((s) => s.title)).not.toContain('Juice groove template');
    expect(vol(stages.at(-1)!)).toBeGreaterThan(vol(square.at(-1)!) + 1e-6);
    // With no groove there is nothing to make a template for.
    const none = run({ ...design, finish: { ...finish, groove: { ...finish.groove, on: false } } }, names);
    expect(none.map((s) => s.title)).not.toContain('Juice groove template');
    // Strips too wide to leave a hole make one solid board; a groove that does not fit makes no template.
    const solid = run({ ...design, finish: { ...finish, template: { ...finish.template, stripWidth: 6 } } }, names)[at];
    expect(solid.slices[0].pieces.filter((p) => p.species === 'template')).toHaveLength(1);
    expect(solid.summary).toMatch(/: a board .* and 1\/2″ thick/);
    const deep = run({ ...design, finish: { ...finish, groove: { ...finish.groove, depth: 1 } } }, names)[at];
    expect(deep.warning).toMatch(/^No template: the groove it guides does not fit\./);
    expect(deep.slices[0].pieces.some((p) => p.species === 'template')).toBe(false);
  });

  it('finishing comes last: nothing else can be done to a board once a touch is cut, and a touch needs a glued panel', () => {
    const design = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const finished = run(design, names).at(-1)!;
    expect(act(finished, { type: 'crosscut', width: 1, kerf: 0.125, angle: 0 }, names).error).toMatch(/^Finishing comes last/);
    expect(act(sliced(), { type: 'chamfer', size: 0.25 }, names).error).toBe('Finishing needs a glued panel.');
    // Another touch is fine, and is cut together with the ones already made.
    const again = act(finished, { type: 'roundCorners', radius: 1 }, names);
    expect(again.error).toBeUndefined();
    expect(vol(again)).toBeLessThan(vol(finished) - 1e-6);
  });

  it('ripping a glued panel saws it lengthways into strips that are then worked as slices', () => {
    const strips = act(EMPTY, { type: 'rip', strips: [{ id: 'a', species: 'maple', width: 2 }, { id: 'b', species: 'walnut', width: 2 }], thickness: 1, length: 12, repeat: 2 }, names);
    const panel = act(strips, { type: 'glue' }, names);
    // 8 wide: five strips of 1 1/2 with four 1/8 kerfs use all of it.
    const ripped = act(panel, { type: 'ripPanel', width: 1.5, kerf: 0.125 }, names);
    expect(ripped.error).toBeUndefined();
    expect(ripped.kind).toBe('slices');
    expect(ripped.slices).toHaveLength(5);
    expect(ripped.summary).toMatch(/^Rip the panel lengthways into 5 strips, each 1 1\/2″ wide \(kerf 1\/8″\)\. Turn them a quarter turn/);
    // Each strip is the panel's full length, now lying across the bench, with its fibres along it.
    const b = bbox(ripped.slices[0].pieces);
    expect(+(b.max[2] - b.min[2]).toFixed(6)).toBe(12);
    expect(+(b.max[0] - b.min[0]).toFixed(6)).toBe(1.5);
    expect(ripped.slices[0].pieces[0].grain.map((n) => Math.abs(Math.round(n)))).toEqual([0, 0, 1]);
    // Only the kerfs are lost.
    expect(vol(ripped)).toBeCloseTo(vol(panel) - 4 * 0.125 * 12 * 1, 9);
    // A narrower strip leaves an offcut, and the step is the same action.
    const step: Step = { id: 'r', type: 'rip', width: 3, kerf: 0.125 };
    expect(actionsOf(step)).toEqual([{ type: 'ripPanel', width: 3, kerf: 0.125 }]);
    const two = applyStep(panel, step, names);
    expect(two.title).toBe('Rip the panel');
    expect(two.slices).toHaveLength(2);
    // 8 wide less two strips of 3 and the kerf after each leaves 1 3/4.
    expect(two.summary).toMatch(/The last 1 3\/4″ is an offcut\./);
    // It needs a panel, and the strips can be glued back like any slices.
    expect(applyStep(sliced(), step, names).error).toMatch(/needs a glued panel/);
    expect(act(ripped, { type: 'glue' }, names).kind).toBe('panel');
  });

  it('a new step of each type starts from the values in the step table', () => {
    expect(newStep('crosscut')).toMatchObject({ type: 'crosscut', width: 1.25, kerf: 0.125, angle: 0 });
    expect(newStep('rip')).toMatchObject({ type: 'rip', width: 1.25, kerf: 0.125 });
    expect(newStep('flip')).toMatchObject({ type: 'flip', how: 'end', sel: { mode: 'every', n: 2, offset: 1 } });
    expect(newStep('glue').id).not.toBe(newStep('glue').id);
    const panel = newStep('panel') as Extract<Step, { type: 'panel' }>;
    expect(panel.strips.map((s) => s.species)).toEqual(['walnut', 'maple']);
  });

  it('the strips are a step like any other, and must come first', () => {
    const design = PRESETS.find((p) => p.key === 'brick')!.make();
    expect(design.version).toBe(2);
    expect(design).not.toHaveProperty('layup');
    expect(design.steps[0]).toMatchObject({ type: 'strips', thickness: 1.375, repeat: 7 });
    expect(layupOf(design).strips.map((s) => s.species)).toEqual(['teak']);
    // Changing the strips changes that step and nothing else.
    const wider = withLayup(design, { repeat: 9 });
    expect(wider.steps[0]).toMatchObject({ type: 'strips', repeat: 9 });
    expect(wider.steps.slice(1)).toEqual(design.steps.slice(1));
    // A second strips step later in the list is refused, and so is a design that starts with something else.
    const twice = run({ ...design, steps: [...design.steps, design.steps[0]] }, names);
    expect(twice[design.steps.length].error).toMatch(/^The strips are ripped first/);
    expect(run({ ...design, steps: design.steps.slice(1) }, names)[0].error).toBeDefined();
    expect(run({ ...design, steps: [] }, names)[0].error).toMatch(/no steps/);
  });

  it('no starter design carries an end or edge label; each is offered once', () => {
    for (const p of PRESETS) expect(Object.keys(p)).not.toContain('type');
    expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
  });
});
