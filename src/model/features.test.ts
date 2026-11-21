// One test at least for each feature that pipeline.test.ts does not already cover: the individual
// steps, selectors, step errors, design files, the cut list's arithmetic, and the wizard's resizing.
import { describe, expect, it } from 'vitest';
import { accentStrips, withAccentStrips } from './accent';
import { buildCutList, THIN } from './cutlist';
import { changeStrip } from './link';
import { woodsOf } from './naming';
import { NO_FINISH } from './finish';
import { fitThickness, fitToTarget } from './fit';
import { bbox, volume } from './geometry';
import { describeSelector, expandStrips, matches, run, stepNeeds } from './pipeline';
import { CHESS_SQUARES, PRESETS, basketWeave, chessBoard, doubleBorder, doubleBorderCount, insertStep, newStep } from './presets';
import { allSpecies, speciesById } from './species';
import { fileSafe, validateDesign } from './storage';
import type { Design, Piece, Stage, Step, StepType } from './types';

/** Total wood volume in a stage. */
const vol = (s: Stage) => s.slices.reduce((v, sl) => v + sl.pieces.reduce((a, p) => a + volume(p), 0), 0);
/** A fresh copy of a starter design by key, with no finishing cuts so the board is a plain block. */
const preset = (key: string): Design => ({ ...PRESETS.find((p) => p.key === key)!.make(), finish: NO_FINISH });
/** A step without its id. Written out per member: Omit on the union itself would keep only the shared fields. */
type StepSpec = Step extends infer S ? (S extends Step ? Omit<S, 'id'> : never) : never;
/** A two-strip panel, maple then walnut across its width, with the given steps: small enough to reason about by hand. */
const twoStrip = (...steps: StepSpec[]): Design => ({
  version: 1,
  name: 'Two strip',
  target: { length: 6, width: 2, thickness: 1 },
  autoFit: false,
  finish: NO_FINISH,
  layup: {
    length: 6.375, thickness: 1, repeat: 1, closeWithFirst: false,
    strips: [{ id: 'a', species: 'maple', width: 1 }, { id: 'b', species: 'walnut', width: 1 }],
  },
  steps: steps.map((s, i) => ({ ...s, id: `s${i}` }) as Step),
  customSpecies: [],
});
/** The wood at the low-Z end of a slice. */
const firstWood = (pieces: Piece[]) => [...pieces].sort((p, q) => bbox([p]).min[2] - bbox([q]).min[2])[0].species;
const CUT = { type: 'crosscut', width: 1.5, kerf: 0.125, angle: 0 } as const;
const EVERY_OTHER = { mode: 'every', n: 2, offset: 1 } as const;

describe('selectors', () => {
  it('all, every nth and picked slices choose the right slices', () => {
    expect([0, 1, 2, 3].map((i) => matches({ mode: 'all' }, i))).toEqual([true, true, true, true]);
    expect([0, 1, 2, 3, 4].map((i) => matches(EVERY_OTHER, i))).toEqual([false, true, false, true, false]);
    expect([0, 1, 2, 3, 4, 5].map((i) => matches({ mode: 'every', n: 3, offset: 0 }, i))).toEqual([true, false, false, true, false, false]);
    expect([0, 1, 2, 3].map((i) => matches({ mode: 'pick', indices: [0, 3] }, i))).toEqual([true, false, false, true]);
  });

  it('are described in plain words, counting from 1', () => {
    expect(describeSelector({ mode: 'all' })).toBe('every slice');
    expect(describeSelector(EVERY_OTHER)).toBe('every 2nd slice, starting with slice 2');
    expect(describeSelector({ mode: 'pick', indices: [3, 0] })).toBe('slices 1, 4');
    expect(describeSelector({ mode: 'pick', indices: [] })).toBe('no slices');
  });
});

describe('the first glue-up', () => {
  it('repeats the strips, closes with the first one when asked, and drops zero-width strips', () => {
    const strips = [{ id: 'a', species: 'maple', width: 1 }, { id: 'b', species: 'walnut', width: 0.125 }];
    const layup = { length: 10, thickness: 1, strips, repeat: 3, closeWithFirst: true };
    expect(expandStrips(layup).map((s) => s.species)).toEqual(['maple', 'walnut', 'maple', 'walnut', 'maple', 'walnut', 'maple']);
    expect(expandStrips({ ...layup, closeWithFirst: false }).length).toBe(6);
    expect(expandStrips({ ...layup, strips: [strips[0], { ...strips[1], width: 0 }], closeWithFirst: false }).length).toBe(3);
  });

  it('is as wide as its strips and lists the stock for them', () => {
    const first = run(twoStrip())[0];
    expect(first.size).toEqual([6.375, 1, 2]);
    expect(first.stock!.map((l) => [l.species, l.count])).toEqual([['maple', 1], ['walnut', 1]]);
  });
});

describe('each kind of step', () => {
  it('cross cut makes whole slices, loses a kerf between them, and reports the offcut', () => {
    // 6 3/8 long: four 1 1/2 slices and three 1/8 kerfs use 6 3/8 exactly.
    const cut = run(twoStrip(CUT))[1];
    expect(cut.kind).toBe('slices');
    expect(cut.slices.length).toBe(4);
    expect(vol(cut)).toBeCloseTo(4 * 1.5 * 1 * 2, 9);
    const short = run(twoStrip({ ...CUT, width: 1.75 }))[1];
    expect(short.slices.length).toBe(3);
    expect(short.summary).toContain('offcut');
  });

  it('flip end for end swaps the woods on the chosen slices only', () => {
    const flipped = run(twoStrip(CUT, { type: 'flip', sel: EVERY_OTHER, how: 'end' }))[2];
    expect(flipped.slices.map((s) => firstWood(s.pieces))).toEqual(['maple', 'walnut', 'maple', 'walnut']);
    expect(flipped.size).toEqual(run(twoStrip(CUT))[1].size);
  });

  it('flip face down keeps each wood on its own side', () => {
    const flipped = run(twoStrip(CUT, { type: 'flip', sel: { mode: 'all' }, how: 'face' }))[2];
    expect(flipped.slices.map((s) => firstWood(s.pieces))).toEqual(['maple', 'maple', 'maple', 'maple']);
    expect(vol(flipped)).toBeCloseTo(12, 9);
  });

  it('offset slides the chosen slices along their length', () => {
    const shifted = run(twoStrip(CUT, { type: 'shift', sel: EVERY_OTHER, amount: 0.5 }))[2];
    expect(shifted.slices.map((s) => bbox(s.pieces).min[2])).toEqual([0, 0.5, 0, 0.5]);
    expect(shifted.size[2]).toBeCloseTo(2.5, 9);
  });

  it('a selection that matches nothing warns', () => {
    const none = run(twoStrip(CUT, { type: 'shift', sel: { mode: 'pick', indices: [] }, amount: 0.5 }))[2];
    expect(none.warning).toMatch(/no slices/);
  });

  it('several accent strips go into each gap together, as one slice, and each is on the stock list', () => {
    const more = [{ species: 'maple', thickness: 0.25 }, { species: 'cherry', thickness: 0.125 }];
    const one = run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1 }))[2];
    const three = run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1, more }))[2];
    // Still one slice per gap, so later steps count slices the same way; it now holds three pieces.
    expect(three.slices.length).toBe(one.slices.length);
    expect(three.slices[1].pieces.map((p) => p.species)).toEqual(['cherry', 'maple', 'cherry']);
    expect(three.size[0]).toBeCloseTo(one.size[0] + 3 * 0.375, 9);
    // The two cherry strips are one line of stock, six of them for three gaps; the maple is another.
    expect(three.stock!.map((l) => [l.species, l.count, l.thickness])).toEqual([['cherry', 6, 0.125], ['maple', 3, 0.25]]);
    expect(three.summary).toMatch(/stack of 3 after every slice, in this order: cherry 1\/8″, maple 1\/4″, cherry 1\/8″/);
    // Glued up, the board is wider by the whole stack at each gap and loses no wood.
    const glued = run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1, more }, { type: 'glue' }))[3];
    expect(glued.error).toBeUndefined();
    expect(vol(glued)).toBeCloseTo(vol(three), 6);
    // A strip in the stack with no thickness is refused, not only the first.
    expect(run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1, more: [{ species: 'maple', thickness: 0 }] }))[2].error).toMatch(/greater than zero/);
  });

  it('the strips of an accent step read and write as one list, the first kept where old designs have it', () => {
    const step = { id: 's', type: 'insert' as const, species: 'walnut', thickness: 0.125, every: 1 };
    expect(accentStrips(step)).toEqual([{ species: 'walnut', thickness: 0.125 }]);
    const two = withAccentStrips(step, [{ species: 'maple', thickness: 0.25 }, { species: 'walnut', thickness: 0.125 }]);
    expect(two).toMatchObject({ species: 'maple', thickness: 0.25, more: [{ species: 'walnut', thickness: 0.125 }] });
    expect(accentStrips(two).map((a) => a.species)).toEqual(['maple', 'walnut']);
    // Back to one strip drops the list; an empty list changes nothing.
    expect('more' in withAccentStrips(two, [accentStrips(two)[1]])).toBe(false);
    expect(withAccentStrips(two, [])).toBe(two);
  });

  it('changing a first glue-up strip carries to every matching strip in an accent stack, and its woods are named', () => {
    const d = twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1, more: [{ species: 'walnut', thickness: 1 }, { species: 'walnut', thickness: 0.5 }] });
    const { design, followed } = changeStrip(d, 'b', { width: 0.75 });
    const step = design.steps[1] as Extract<Step, { type: 'insert' }>;
    // The walnut strip that was as thick as layup strip b followed it; the other walnut and the cherry did not.
    expect(followed.width).toBe(true);
    expect(accentStrips(step).map((a) => a.thickness)).toEqual([0.125, 0.75, 0.5]);
    expect(woodsOf(d)).toEqual(['maple', 'walnut', 'cherry']);
  });

  it('accent strips can also go on the outside of the first and last slice', () => {
    const inside = run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1 }))[2];
    const outside = run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1, ends: true }))[2];
    expect(outside.slices.length).toBe(inside.slices.length + 2);
    expect(outside.slices[0].pieces[0].species).toBe('cherry');
    expect(outside.slices.at(-1)!.pieces[0].species).toBe('cherry');
    expect(outside.stock![0].count).toBe(inside.stock![0].count + 2);
    expect(outside.size[0]).toBeCloseTo(inside.size[0] + 0.25, 9);
    expect(outside.summary).toMatch(/outside of the first and last slice/);
  });

  it('a patterned accent strip is a slice of another panel: its strips lie along the gap, offset and staggered', () => {
    // The slices are 2 long (the two 1-wide strips). The pattern is cherry 0.5, ash 0.5, starting 0.25 in.
    const pattern = [{ species: 'cherry', width: 0.5 }, { species: 'ash', width: 0.5 }];
    const st = run(twoStrip(CUT, { type: 'turn', sel: { mode: 'all' } }, { type: 'insert', species: 'cherry', thickness: 0.25, every: 1, pattern, offset: 0.25, stagger: 0.5 }))[3];
    expect(st.error).toBeUndefined();
    /** The woods along a gap's strip with where each piece starts and ends. */
    const along = (gap: number) => st.slices[gap].pieces.map((p) => { const b = bbox([p]); return [p.species, b.min[2], b.max[2]]; });
    // First gap: the tail of an ash strip fills the 0.25 before the pattern starts.
    expect(along(1)).toEqual([['ash', 0, 0.25], ['cherry', 0.25, 0.75], ['ash', 0.75, 1.25], ['cherry', 1.25, 1.75], ['ash', 1.75, 2]]);
    // Second gap: the same, slid 0.5 further along.
    expect(along(3)).toEqual([['cherry', 0, 0.25], ['ash', 0.25, 0.75], ['cherry', 0.75, 1.25], ['ash', 1.25, 1.75], ['cherry', 1.75, 2]]);
    // It stands the same way up as the slices beside it, and fills its gap with no holes.
    expect(st.slices[1].pieces.every((p) => p.grain.join() === st.slices[0].pieces[0].grain.join())).toBe(true);
    expect(st.slices[1].pieces.reduce((v, p) => v + volume(p), 0)).toBeCloseTo(0.25 * 1.5 * 2, 9);
    // The stock is that panel's strips: wide enough for the slices and the slide, long enough for a slice per gap.
    expect(st.stock!.map((l) => [l.species, l.count, l.thickness, l.width])).toEqual([['cherry', 3, 0.25, 0.5], ['ash', 3, 0.25, 0.5]]);
    expect(st.stock![0].length).toBeCloseTo(3 * (1.5 + 0.125) + 0.5, 9);
    expect(st.summary).toMatch(/cut from one more glue-up/);
    expect(st.summary).toMatch(/sliding every other one 1\/2″/);
  });

  it('a patterned strip keeps its pattern through the strip list, and its woods are named', () => {
    const pattern = [{ species: 'cherry', width: 0.5 }, { species: 'ash', width: 0.5 }];
    const step = { id: 's', type: 'insert' as const, species: 'cherry', thickness: 0.25, every: 1, pattern, offset: 0.25, more: [{ species: 'walnut', thickness: 0.125 }] };
    const [first, second] = accentStrips(step);
    expect(first).toEqual({ species: 'cherry', thickness: 0.25, pattern, offset: 0.25 });
    expect(second).toEqual({ species: 'walnut', thickness: 0.125 });
    // Swapped, the pattern moves with its strip and the step's own fields become the plain one.
    const swapped = withAccentStrips(step, [second, first]);
    expect(swapped.pattern).toBeUndefined();
    expect(swapped.more).toEqual([first]);
    expect(woodsOf(twoStrip(CUT, step))).toEqual(['maple', 'walnut', 'cherry', 'ash']);
    // A strip of the first glue-up does not drag a patterned strip of the same wood with it.
    const d = twoStrip(CUT, { ...step, species: 'walnut', thickness: 1 });
    expect(changeStrip(d, 'b', { width: 0.75 }).followed.width).toBe(false);
  });

  it('a strip of a patterned strip\'s panel can be a plank faced both sides with another wood', () => {
    // A 1/2 thick strip: ash 0.5 wide, then a 1.5 wide walnut plank with 1/8 cherry on each face.
    const pattern = [{ species: 'ash', width: 0.5 }, { species: 'walnut', width: 1.5, faces: { species: 'cherry', thickness: 0.125 } }];
    const st = run(twoStrip(CUT, { type: 'turn', sel: { mode: 'all' } }, { type: 'insert', species: 'walnut', thickness: 0.5, every: 1, pattern }))[3];
    expect(st.error).toBeUndefined();
    // Across the gap's thickness at the plank: cherry 1/8, walnut 1/4, cherry 1/8. At the ash strip: ash all the way.
    const layers = st.slices[1].pieces.map((p) => { const b = bbox([p]); return [p.species, +(b.max[0] - b.min[0]).toFixed(4), +(b.max[2] - b.min[2]).toFixed(4)]; });
    expect(layers).toEqual([['ash', 0.5, 0.5], ['cherry', 0.125, 1.5], ['walnut', 0.25, 1.5], ['cherry', 0.125, 1.5]]);
    // Stock: the plank at its own thickness, and two faces for it, glued on 1/16 thick to plane down.
    const line = (use: RegExp) => st.stock!.find((l) => use.test(l.use))!;
    expect(line(/the planks/)).toMatchObject({ species: 'walnut', count: 1, thickness: 0.25, width: 1.5 });
    expect(line(/a face on each side/)).toMatchObject({ species: 'cherry', count: 2, thickness: 0.1875, width: 1.5 });
    expect(st.summary).toMatch(/first make 1 walnut planks 1\/4″ × 1 1\/2″/);
    expect(st.summary).toMatch(/plane each face down to 1\/8″, which leaves the plank 1\/2″ thick/);
    // Faces as thick as the strip leave no plank: refused.
    const bad = [{ species: 'walnut', width: 1.5, faces: { species: 'cherry', thickness: 0.25 } }];
    expect(run(twoStrip(CUT, { type: 'insert', species: 'walnut', thickness: 0.5, every: 1, pattern: bad }))[2].error).toMatch(/thinner, together/);
  });

  it('a border goes round a face-grain panel as four strips with a line inside, the sides covering the ends', () => {
    const framed = run(twoStrip({ type: 'frame', species: 'cherry', width: 1, lineSpecies: 'ash', line: 0.125, block: 3 }))[1];
    expect(framed.error).toBeUndefined();
    // The panel is 6 3/8 × 2; a 1/8 line and a 1 border on every side.
    expect(framed.size.map((n) => +n.toFixed(4))).toEqual([6.375 + 2.25, 1, 2 + 2.25]);
    expect(vol(framed)).toBeCloseTo(8.625 * 1 * 4.25, 6);
    const cherry = framed.slices[0].pieces.filter((p) => p.species === 'cherry').map((p) => { const b = bbox([p]); return [+(b.max[0] - b.min[0]).toFixed(4), +(b.max[2] - b.min[2]).toFixed(4)]; });
    // Two ends as long as the panel is wide, two sides the whole new length.
    expect(cherry).toEqual([[1, 2], [1, 2], [8.625, 1], [8.625, 1]]);
    expect(framed.stock!.map((l) => [l.species, l.count, l.length])).toEqual([['cherry', 2, 2], ['cherry', 2, 8.625], ['ash', 2, 2], ['ash', 2, 8.625]]);
    expect(framed.summary).toMatch(/Mill four cherry border pieces/);
    // No line when its thickness is 0.
    const plain = run(twoStrip({ type: 'frame', species: 'cherry', width: 1, lineSpecies: 'ash', line: 0, block: 3 }))[1];
    expect(plain.slices[0].pieces.some((p) => p.species === 'ash')).toBe(false);
    expect(plain.size[0]).toBeCloseTo(8.375, 9);
    expect(run(twoStrip({ type: 'frame', species: 'cherry', width: 0, lineSpecies: 'ash', line: 0, block: 3 }))[1].error).toMatch(/width greater than zero/);
  });

  it('on an end-grain panel the border is end-grain blocks, and a board ending on a border wants flattening', () => {
    const steps = [CUT, { type: 'turn', sel: { mode: 'all' } }, { type: 'glue' }, { type: 'frame', species: 'cherry', width: 1, lineSpecies: 'ash', line: 0, block: 2 }] as const;
    const stages = run(twoStrip(...steps));
    const framed = stages[4];
    const blocks = framed.slices[0].pieces.filter((p) => p.species === 'cherry');
    expect(blocks.every((p) => Math.abs(p.grain[1]) > 0.99)).toBe(true);
    expect(blocks.length).toBeGreaterThan(4);
    expect(framed.summary).toMatch(/end grain like the board/);
    expect(framed.stock!.every((l) => /cut from/.test(l.use))).toBe(true);
    expect(framed.warning).toMatch(/never flattened/);
  });

  it('swapping a wood out of the first glue-up swaps it in the second panel, its plank faces and the border', () => {
    const d = { ...basketWeave(), finish: NO_FINISH };
    const walnut = d.layup.strips.find((st) => st.species === 'walnut')!;
    const { design, followed } = changeStrip(d, walnut.id, { species: 'wenge' });
    expect(followed.species).toBe(true);
    expect(JSON.stringify(design.steps)).not.toMatch(/walnut/);
    expect(run(design).some((st) => st.slices.some((sl) => sl.pieces.some((p) => p.species === 'walnut')))).toBe(false);
    // The cherry lines are in two strips; changing one leaves cherry in use, so nothing follows.
    const cherry = d.layup.strips.find((st) => st.species === 'cherry')!;
    expect(changeStrip(d, cherry.id, { species: 'padauk' }).followed.species).toBe(false);
  });

  it('start another panel sets the slices aside, and interleave brings them back with a new slice after each', () => {
    const strips = [{ id: 'p', species: 'cherry', width: 0.5 }, { id: 'q', species: 'ash', width: 0.75 }];
    const d = twoStrip(CUT, { type: 'panel', strips, thickness: 0.5, extra: 0 }, { type: 'crosscut', width: 1, kerf: 0.125, angle: 0 }, { type: 'combine' }, { type: 'glue' });
    const [, cut, panel, cut2, both, glued] = run(d);
    // Four slices 2 long and 1 tall are set aside. The panel is cherry, ash, cherry: wide enough at 1 3/4, then one more strip to reach 2.
    expect(panel.kind).toBe('panel');
    expect(panel.aside).toHaveLength(4);
    expect(panel.size.map((n) => +n.toFixed(4))).toEqual([3 * (1 + 0.125) + 0.5, 0.5, 2.5]);
    expect(panel.slices[0].pieces.map((p) => p.species)).toEqual(['cherry', 'ash', 'cherry', 'ash']);
    expect(panel.stock!.every((l) => l.use.startsWith('Second panel'))).toBe(true);
    // Steps on the new panel leave the set-aside slices alone.
    expect(cut2.aside).toEqual(panel.aside);
    expect(cut2.slices).toHaveLength(3);
    // Interleaved: old, new, old, new, old, new, old; nothing left aside; the board has all the wood of both.
    expect(both.aside).toBeUndefined();
    expect(both.slices.map((sl) => sl.pieces[0].species)).toEqual(['maple', 'cherry', 'maple', 'cherry', 'maple', 'cherry', 'maple']);
    expect(vol(both)).toBeCloseTo(vol(cut) + vol(cut2), 9);
    expect(glued.error).toBeUndefined();
    // Given a repeat and a length, the panel is made to them and not sized to the slices.
    const fixed = run(twoStrip(CUT, { type: 'panel', strips, thickness: 0.5, extra: 0, repeat: 3, length: 9 }))[2];
    expect(fixed.size.map((n) => +n.toFixed(4))).toEqual([9, 0.5, 3.75]);
  });

  it('interleaving says so when there is nothing set aside, too few new slices, or some left over', () => {
    const strips = [{ id: 'p', species: 'cherry', width: 2 }];
    expect(run(twoStrip(CUT, { type: 'combine' }))[2].error).toMatch(/No slices are set aside/);
    const short = run(twoStrip(CUT, { type: 'panel', strips, thickness: 0.5, extra: 0, length: 2.5 }, { type: 'crosscut', width: 1, kerf: 0.125, angle: 0 }, { type: 'combine' }));
    expect(short[4].error).toMatch(/4 slices set aside have 3 gaps between them, and there are only 2 new slices/);
    expect(short[4].aside).toHaveLength(4);
    const long = run(twoStrip(CUT, { type: 'panel', strips, thickness: 0.5, extra: 0, length: 6 }, { type: 'crosscut', width: 1, kerf: 0.125, angle: 0 }, { type: 'combine' }));
    expect(long[4].warning).toMatch(/2 of the new slices are left over/);
    // Only one set can be aside at a time.
    const twice = run(twoStrip(CUT, { type: 'panel', strips, thickness: 0.5, extra: 0 }, { type: 'crosscut', width: 1, kerf: 0.125, angle: 0 }, { type: 'panel', strips, thickness: 0.5, extra: 0 }));
    expect(twice[4].error).toMatch(/already slices set aside/);
  });

  it('a strip faced both sides is three layers through the panel\'s thickness, in the first glue-up too', () => {
    const d = twoStrip();
    const faced = run({ ...d, layup: { ...d.layup, strips: [{ id: 'a', species: 'walnut', width: 1, faces: { species: 'cherry', thickness: 0.25 } }, { id: 'b', species: 'maple', width: 1 }] } })[0];
    expect(faced.slices[0].pieces.map((p) => [p.species, +(bbox([p]).max[1] - bbox([p]).min[1]).toFixed(4)])).toEqual([['cherry', 0.25], ['walnut', 0.5], ['cherry', 0.25], ['maple', 1]]);
    expect(faced.stock!.map((l) => [l.species, l.count, l.thickness])).toEqual([['walnut', 1, 0.5], ['cherry', 2, 0.25], ['maple', 1, 1]]);
    expect(faced.summary).toMatch(/^First make 1 walnut plank 1\/2″ thick and 1″ wide, with a cherry face 1\/4″ thick glued to both sides/);
  });

  it('a slide towards edge A reads that way', () => {
    expect(run(twoStrip(CUT, { type: 'shift', sel: { mode: 'all' }, amount: -0.5 }))[2].summary).toMatch(/^Slide 1\/2″ along its length, towards edge A: every slice/);
  });

  it('accent strips after every second slice go in half as often', () => {
    const every1 = run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 1 }))[2];
    const every2 = run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0.125, every: 2 }))[2];
    expect(every1.slices.length).toBe(7);
    expect(every2.slices.length).toBe(5);
    expect(every2.stock![0]).toMatchObject({ species: 'cherry', count: 1, thickness: 0.125 });
    expect(every2.size[0]).toBeCloseTo(4 * 1.5 + 0.125, 9);
  });

  it('glue-up turns the slices into one panel of the same wood', () => {
    const stages = run(twoStrip(CUT, { type: 'glue' }));
    expect(stages[2].kind).toBe('panel');
    expect(stages[2].slices.length).toBe(1);
    expect(vol(stages[2])).toBeCloseTo(vol(stages[1]), 9);
  });

  it('trim takes the amounts asked for off edge A, edge B, end A and end B', () => {
    const trim = (t: Partial<Record<'x0' | 'x1' | 'z0' | 'z1', number>>) =>
      run(twoStrip({ type: 'trim', auto: false, x0: 0, x1: 0, z0: 0, z1: 0, ...t }))[1];
    expect(trim({ z0: 0.25 }).size).toEqual([6.375, 1, 1.75]);
    expect(trim({ x0: 0.125, x1: 0.25 }).size).toEqual([6, 1, 2]);
    // Edge A is the low-Z edge, where the maple is: taking the whole maple strip leaves only walnut.
    expect(new Set(trim({ z0: 1 }).slices[0].pieces.map((p) => p.species))).toEqual(new Set(['walnut']));
    expect(new Set(trim({ z1: 1 }).slices[0].pieces.map((p) => p.species))).toEqual(new Set(['maple']));
    expect(trim({ z1: 1 }).summary).toContain('1″ off long edge B');
  });

  it('an extra 1/8 off edge B of a brick board with accents takes the accent off that edge', () => {
    // The board this came from: oak bricks with 1/8 walnut between them both ways.
    const d = preset('brick');
    const base: Design = {
      ...d,
      autoFit: false,
      layup: { ...d.layup, strips: [{ id: 'o', species: 'white-oak', width: 2 }, { id: 'w', species: 'walnut', width: 0.125 }] },
      steps: insertStep(d, d.steps.findIndex((s) => s.type === 'glue'), { id: 'acc', type: 'insert', species: 'walnut', thickness: 0.125, every: 1 }).steps,
    };
    const extra: Design = { ...base, steps: base.steps.map((s) => (s.type === 'trim' && s.auto ? { ...s, z1: 0.125 } : s)) };
    /** Accent strips of the first glue-up that lie on edge B of the finished board. */
    const onEdgeB = (design: Design) => {
      const last = run(design).at(-1)!;
      return last.slices[0].pieces.filter((p) => {
        const b = bbox([p]);
        return p.species === 'walnut' && b.max[2] - b.min[2] < 0.13 && Math.abs(b.max[2] - last.size[2]) < 1e-6;
      }).length;
    };
    expect(onEdgeB(base)).toBeGreaterThan(0);
    expect(onEdgeB(extra)).toBe(0);
    const before = run(base).at(-1)!, after = run(extra).at(-1)!;
    expect(after.error).toBeUndefined();
    expect(after.size[2]).toBeCloseTo(before.size[2] - 0.125, 9);
    expect(after.size[0]).toBeCloseTo(before.size[0], 9);
  });

  it('flatten takes thickness off and nothing else', () => {
    const flat = run(twoStrip({ type: 'flatten', top: 0.0625, bottom: 0.125 }))[1];
    expect(flat.size).toEqual([6.375, 0.8125, 2]);
  });

  it('a quarter turn swaps length and width', () => {
    const turned = run(twoStrip({ type: 'rotate' }))[1];
    expect(turned.size[0]).toBeCloseTo(2, 9);
    expect(turned.size[2]).toBeCloseTo(6.375, 9);
    expect(vol(turned)).toBeCloseTo(12.75, 9);
  });
});

describe('steps that cannot run say so', () => {
  it('a slice step on a glued panel, and a panel step on loose slices', () => {
    const onPanel = run(twoStrip({ type: 'turn', sel: { mode: 'all' } }))[1];
    expect(onPanel.error).toMatch(/loose slices/);
    const onSlices = run(twoStrip(CUT, { type: 'flatten', top: 0.0625, bottom: 0.0625 }))[2];
    expect(onSlices.error).toMatch(/glued panel/);
    // The wood is passed through, so the picture does not go blank.
    expect(vol(onSlices)).toBeCloseTo(12, 9);
  });

  it('a trim, a flatten or a cross cut that leaves nothing', () => {
    expect(run(twoStrip({ type: 'trim', auto: false, x0: 0, x1: 0, z0: 1, z1: 1 }))[1].error).toMatch(/whole panel/);
    expect(run(twoStrip({ type: 'flatten', top: 0.5, bottom: 0.5 }))[1].error).toMatch(/whole thickness/);
    expect(run(twoStrip({ ...CUT, width: 7 }))[1].error).toMatch(/shorter than one slice/);
  });

  it('an accent strip with no thickness', () => {
    expect(run(twoStrip(CUT, { type: 'insert', species: 'cherry', thickness: 0, every: 1 }))[2].error).toMatch(/greater than zero/);
  });

  it('every stage is still there after an error, so the step list stays in step', () => {
    const d = twoStrip({ type: 'glue' }, CUT, { type: 'glue' });
    expect(run(d).length).toBe(1 + d.steps.length);
  });
});

describe('adding steps', () => {
  const TYPES: StepType[] = ['crosscut', 'turn', 'flip', 'shift', 'insert', 'glue', 'trim', 'flatten', 'rotate', 'frame', 'panel', 'combine'];

  it('every kind of step can be made, with its own id, and runs on the kind of stage it needs', () => {
    const made = TYPES.map((t) => newStep(t));
    expect(made.map((s) => s.type)).toEqual(TYPES);
    expect(new Set(made.map((s) => s.id)).size).toBe(TYPES.length);
    for (const step of made) {
      // Interleaving needs slices set aside and enough new ones cut: a second panel, long enough, cross cut.
      const before = step.type === 'combine' ? [newStep('crosscut'), { ...newStep('panel'), length: 12 } as Step, newStep('crosscut')]
        : stepNeeds(step.type) === 'panel' ? [] : [newStep('crosscut')];
      const stages = run({ ...twoStrip(), steps: [...before, step] });
      expect(stages.at(-1)!.error, step.type).toBeUndefined();
    }
  });

  it('a new step goes straight after the selected stage, or last when the Finish stage is selected', () => {
    const d = twoStrip(CUT, { type: 'glue' });
    const flip = newStep('flip');
    expect(insertStep(d, 1, flip).steps.map((s) => s.type)).toEqual(['crosscut', 'flip', 'glue']);
    expect(insertStep(d, 0, flip).steps.map((s) => s.type)).toEqual(['flip', 'crosscut', 'glue']);
    expect(insertStep(d, 99, flip).steps.map((s) => s.type)).toEqual(['crosscut', 'glue', 'flip']);
    expect(d.steps.length).toBe(2);
  });
});

describe('design files', () => {
  it('every starter design survives being saved and opened', () => {
    for (const p of PRESETS) {
      const d = p.make();
      const back = validateDesign(JSON.parse(JSON.stringify(d)));
      expect(back.layup, p.key).toEqual(d.layup);
      expect(back.steps, p.key).toEqual(d.steps);
      expect(back.name).toBe(d.name);
      expect(run(back).at(-1)!.size).toEqual(run(d).at(-1)!.size);
    }
  });

  it('a file that is not a design is refused with a reason', () => {
    expect(() => validateDesign(null)).toThrow(/Not a design/);
    expect(() => validateDesign({ version: 2, layup: { strips: [] }, steps: [] })).toThrow(/version/);
    expect(() => validateDesign({ version: 1, steps: [] })).toThrow(/layup or steps/);
  });

  it('an old or sparse file gets the defaults: a name, a target, held size, no custom woods', () => {
    const d = validateDesign({ version: 1, layup: { strips: [] }, steps: [] });
    expect(d.name).toBe('Untitled board');
    expect(d.target).toEqual({ length: 16, width: 12, thickness: 1.25 });
    expect(d.autoFit).toBe(true);
    expect(d.customSpecies).toEqual([]);
    expect(validateDesign({ version: 1, layup: { strips: [] }, steps: [], autoFit: false }).autoFit).toBe(false);
  });

  it('file names are made from the design name with nothing unsafe in them', () => {
    expect(fileSafe('Hard maple and black walnut grid')).toBe('Hard-maple-and-black-walnut-grid');
    expect(fileSafe('  ../Pat\'s: board?  ')).toBe('..-Pat-s-board');
    expect(fileSafe('???')).toBe('board');
  });
});

describe('woods', () => {
  it('custom woods join the built-in ones, and a missing wood still draws', () => {
    const d: Design = { ...twoStrip(), customSpecies: [{ id: 'osage', name: 'Osage orange', color: '#d9a21b', custom: true }] };
    expect(speciesById(allSpecies(d), 'osage').name).toBe('Osage orange');
    expect(speciesById(allSpecies(d), 'maple').name).toBe('Hard maple');
    expect(speciesById(allSpecies(d), 'gone')).toEqual({ id: 'gone', name: 'gone', color: '#999999' });
  });
});

describe('cut list', () => {
  it.each(PRESETS.map((p) => p.key))('%s: every line reads thickness, width, length with thickness the smaller', (key) => {
    const list = buildCutList(run(preset(key)));
    expect(list.lines.length).toBeGreaterThan(0);
    for (const l of list.lines) {
      expect(l.thickness).toBeLessThanOrEqual(l.width);
      expect(l.count).toBeGreaterThan(0);
      expect(l.rough.length).toBeGreaterThan(l.length);
    }
  });

  it('a thin strip is ripped to size: no allowance on its thin dimension', () => {
    const list = buildCutList(run(preset('maple-purpleheart')));
    const thin = list.lines.filter((l) => l.thickness < THIN);
    expect(thin.length).toBeGreaterThan(0);
    for (const l of thin) {
      expect(l.ripped).toBe(true);
      expect(l.rough.thickness).toBe(l.thickness);
    }
    expect(list.lines.some((l) => !l.ripped && l.rough.thickness > l.thickness)).toBe(true);
  });

  it('board feet add up from the rough sizes, and the yield is the finished board over that', () => {
    const stages = run(preset('maple-purpleheart'));
    const list = buildCutList(stages);
    const cubic = list.lines.reduce((v, l) => v + l.count * l.rough.thickness * l.rough.width * l.rough.length, 0);
    expect(list.totalBf).toBeCloseTo(cubic / 144, 9);
    expect(list.boardFeet.reduce((v, b) => v + b.bf, 0)).toBeCloseTo(list.totalBf, 9);
    expect(list.yield).toBeCloseTo(vol(stages.at(-1)!) / cubic, 9);
    expect(list.yield).toBeGreaterThan(0.3);
    expect(list.yield).toBeLessThan(1);
    expect(list.finished).toEqual(stages.at(-1)!.size);
  });

  it('the design\'s own milling allowance is used when it has one', () => {
    const d: Design = { ...preset('single-edge-grain'), allowance: { thickness: 0.25, width: 0.5, length: 2 } };
    const l = buildCutList(run(d), d).lines[0];
    expect(l.rough).toEqual({ thickness: l.thickness + 0.25, width: l.width + 0.5, length: l.length + 2 });
  });

  it('the order of operations has an entry for every stage that says something', () => {
    const stages = run(PRESETS.find((p) => p.key === 'brick')!.make());
    const ops = buildCutList(stages).operations;
    expect(ops.map((o) => o.title)).toEqual(stages.map((s) => s.title));
    expect(ops.at(-1)!.title).toBe('Finish');
    for (const o of ops) expect(o.text.length).toBeGreaterThan(10);
  });
});

describe('board wizard: every starter design resized to every common size', () => {
  // The sizes the wizard offers, in BoardWizard.tsx.
  const SIZES = [
    { length: 12, width: 9, thickness: 0.75 },
    { length: 16, width: 12, thickness: 1.25 },
    { length: 18, width: 12, thickness: 1.5 },
    { length: 20, width: 16, thickness: 2 },
  ];
  const cases = PRESETS.flatMap((p) => SIZES.map((size) => [p.key, `${size.length} x ${size.width} x ${size.thickness}`, size] as const));

  it.each(cases)('%s at %s builds, is not under the size asked for, is the thickness asked for, and is not turned round', (key, _label, target) => {
    const base = PRESETS.find((p) => p.key === key)!.make();
    const stages = run(fitThickness(fitToTarget({ ...base, target })));
    for (const s of stages) expect(s.error, `${s.title}: ${s.error}`).toBeUndefined();
    const size = stages.at(-1)!.size;
    expect(size[0]).toBeGreaterThanOrEqual(target.length - 1e-6);
    expect(size[2]).toBeGreaterThanOrEqual(target.width - 1e-6);
    // No more than a block or so over: the fit is the smallest board that reaches the target.
    expect(size[0]).toBeLessThan(target.length + 3);
    expect(size[2]).toBeLessThan(target.width + 3.5);
    expect(size[1]).toBeCloseTo(target.thickness, 6);
  });
});

describe('chess board', () => {
  const cases = (['end', 'face'] as const).flatMap((grain) => [1.5, 2, 2.25].map((square) => [grain, square] as const));

  it.each(cases)('%s grain with %s inch squares is 8 x 8 squares of two woods, alternating both ways', (grain, square) => {
    const d = chessBoard({ square, dark: 'walnut', light: 'maple', thickness: 1.25, grain });
    const stages = run({ ...d, finish: NO_FINISH });
    for (const s of stages) {
      expect(s.error, `${s.title}: ${s.error}`).toBeUndefined();
      expect(s.warning, `${s.title}: ${s.warning}`).toBeUndefined();
    }
    const last = stages.at(-1)!;
    expect(last.size[0]).toBeCloseTo(8 * square, 9);
    expect(last.size[2]).toBeCloseTo(8 * square, 9);
    expect(last.size[1]).toBeCloseTo(1.25, 9);
    const pieces = last.slices[0].pieces;
    expect(pieces.length).toBe(CHESS_SQUARES * CHESS_SQUARES);
    const seen = new Set<string>();
    for (const p of pieces) {
      const b = bbox([p]);
      // Every piece is one whole square, sitting on the grid.
      expect(b.max[0] - b.min[0]).toBeCloseTo(square, 9);
      expect(b.max[2] - b.min[2]).toBeCloseTo(square, 9);
      const col = Math.round(b.min[0] / square), row = Math.round(b.min[2] / square);
      expect(b.min[0]).toBeCloseTo(col * square, 9);
      expect(b.min[2]).toBeCloseTo(row * square, 9);
      seen.add(`${col},${row}`);
      expect(p.species).toBe((col + row) % 2 === 0 ? 'walnut' : 'maple');
      // End grain has the fibres pointing up; face grain has them lying flat.
      expect(Math.abs(p.grain[1])).toBeCloseTo(grain === 'end' ? 1 : 0, 9);
    }
    expect(seen.size).toBe(64);
  });

  it('is named for its woods, has no juice groove, and does not refit itself to a target', () => {
    const d = chessBoard({ square: 2, dark: 'walnut', light: 'maple', thickness: 1.5, grain: 'end' });
    expect(d.name).toBe('Black walnut and hard maple chess board');
    expect(d.finish!.groove.on).toBe(false);
    expect(d.autoFit).toBe(false);
    expect(d.target).toEqual({ length: 16, width: 16, thickness: 1.5 });
    expect(run(d).at(-1)!.title).toBe('Finish');
  });

  it('the cross cut uses the whole panel: eight slices and no offcut', () => {
    for (const grain of ['end', 'face'] as const) {
      const cut = run(chessBoard({ square: 2, dark: 'walnut', light: 'maple', thickness: 1.25, grain })).find((s) => s.title === 'Cross cut')!;
      expect(cut.slices.length).toBe(8);
      expect(cut.summary).not.toContain('offcut');
    }
  });

  it('other woods can be chosen', () => {
    const d = chessBoard({ square: 2, dark: 'wenge', light: 'ash', thickness: 1, grain: 'face' });
    expect(new Set(run(d).at(-1)!.slices[0].pieces.map((p) => p.species))).toEqual(new Set(['wenge', 'ash']));
    expect(d.name).toBe('Wenge and ash chess board');
  });
});

describe('double border board', () => {
  const OPTIONS = { block: 1.5, line: 0.125, field: 'maple', inner: 'walnut', outer: 'white-oak', across: 3, along: 4, thickness: 1.25 };
  /** The finished board with no finishing cuts, so the pattern can be read off it. */
  const built = (grain: 'end' | 'face') => {
    const stages = run({ ...doubleBorder({ ...OPTIONS, grain }), finish: NO_FINISH });
    return { stages, last: stages[stages.length - 1] };
  };
  /** The wood at a point on the board, looking down. */
  const woodAt = (s: Stage, x: number, z: number) => s.slices[0].pieces.find((p) => {
    const b = bbox([p]);
    return x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2];
  })?.species;

  it.each(['end', 'face'] as const)('%s grain: every block is ringed by the inner wood inside an unbroken grid of the outer wood', (grain) => {
    const { stages, last } = built(grain);
    expect(stages.filter((s) => s.error || s.warning)).toEqual([]);
    // 3 blocks of 1 3/4 (block and its ring) and 4 outer strips one way, 4 and 5 the other.
    expect(last.size[0]).toBeCloseTo(3 * 1.75 + 4 * 0.125, 9);
    expect(last.size[2]).toBeCloseTo(4 * 1.75 + 5 * 0.125, 9);
    expect(last.size[1]).toBeCloseTo(1.25, 9);
    // Walk the whole top in 1/8 squares. Measured from the edge in strip widths, with a period of
    // 15 (outer, inner, 12 of block, inner): outer wins wherever either direction is on an outer
    // line, then inner wherever either is on a ring, and the rest is block.
    const kind = (d: number) => { const k = Math.round((d - 1 / 16) / 0.125) % 15; return k === 0 ? 'outer' : k === 1 || k === 14 ? 'inner' : 'block'; };
    let wrong = 0, cells = 0;
    for (let x = 1 / 16; x < last.size[0]; x += 0.125) {
      for (let z = 1 / 16; z < last.size[2]; z += 0.125) {
        const a = kind(x), b = kind(z);
        const want = a === 'outer' || b === 'outer' ? 'white-oak' : a === 'inner' || b === 'inner' ? 'walnut' : 'maple';
        cells++;
        if (woodAt(last, x, z) !== want) wrong++;
      }
    }
    expect(cells).toBe(46 * 61);
    expect(wrong).toBe(0);
  });

  it('is three glue-ups, the last cross cut taking a kerf exactly as wide as the border strip', () => {
    const d = doubleBorder({ ...OPTIONS, grain: 'end' });
    expect(d.steps.filter((s) => s.type === 'glue').length).toBe(2);
    const cuts = d.steps.filter((s) => s.type === 'crosscut') as Extract<Step, { type: 'crosscut' }>[];
    expect(cuts[1]).toMatchObject({ width: 1.75, kerf: 0.125 });
    expect(d.name).toBe('Hard maple, black walnut and white oak double border');
    expect(d.autoFit).toBe(false);
  });

  it('the strip the last cross cut saws out is a cheap spacer: on the cut list, not in the board or its name', () => {
    const d = doubleBorder({ ...OPTIONS, grain: 'end' });
    expect(d.layup.strips.map((s) => [s.species, s.spacer === true])).toEqual([['walnut', false], ['maple', false], ['walnut', false], ['poplar', true]]);
    const stages = run({ ...d, finish: NO_FINISH });
    // Poplar is milled for the first glue-up, one strip for each block across...
    expect(stages[0].stock!.find((l) => l.species === 'poplar')).toMatchObject({ count: 3, width: 0.125 });
    // ...and every bit of it is gone by the end.
    expect(stages[stages.length - 1].slices[0].pieces.some((p) => p.species === 'poplar')).toBe(false);
    expect(woodsOf(d)).toEqual(['maple', 'walnut', 'white-oak']);
    // Another wood can stand in for it.
    expect(doubleBorder({ ...OPTIONS, grain: 'end', spacer: 'ash' }).layup.strips[3]).toMatchObject({ species: 'ash', spacer: true });
  });

  it('fits the nearest whole number of blocks to a size', () => {
    // A 1 1/2 block with 1/8 strips repeats every 1 7/8, plus one closing strip.
    expect(doubleBorderCount(16, 1.5, 0.125)).toBe(8);
    expect(doubleBorderCount(12, 1.5, 0.125)).toBe(6);
    expect(doubleBorderCount(0.5, 1.5, 0.125)).toBe(1);
  });
});

describe('basket weave board', () => {
  // Bars 1 1/2 wide, 1/8 lines: half a square is 3/8, a bar spacing is 2 1/2, a bar is 3 1/4 long.
  // Without its border, so that positions can be read straight off the weave.
  const stages = run({ ...basketWeave({ across: 4, along: 4, border: false }), finish: NO_FINISH });
  const last = stages[stages.length - 1];
  /** The wood at a point on a board, looking down: x along the board, z across it. */
  const woodAt = (x: number, z: number, board = last) => board.slices[0].pieces.find((p) => {
    const b = bbox([p]);
    return x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2];
  })?.species;

  it('runs clean, is solid end grain, and is a whole number of bar spacings each way', () => {
    expect(stages.filter((s) => s.error || s.warning)).toEqual([]);
    expect(last.size.map((n) => +n.toFixed(6))).toEqual([10, 1.25, 10]);
    expect(vol(last)).toBeCloseTo(10 * 1.25 * 10, 5);
    expect(last.slices[0].pieces.every((p) => Math.abs(p.grain[1]) > 0.99)).toBe(true);
  });

  it('weaves: a bar lies across, the next along, and the row after is the other way round', () => {
    // First row of bars, centred 1 1/4 along the board.
    expect(woodAt(1.25, 1.25)).toBe('walnut'); // the bar lying across, 3 1/4 long...
    expect(woodAt(1.25, 0.05)).toBe('walnut');
    expect(woodAt(1.25, 2.8)).toBe('walnut');
    expect(woodAt(1.25, 2.94)).toBe('cherry'); // ...then a line...
    expect(woodAt(1.25, 3.75)).toBe('walnut'); // ...and the bar lying along the board.
    expect(woodAt(1.25, 4.56)).toBe('cherry');
    // The along bar runs on through the line and into the row of squares at each end; the across bar does not.
    expect([0.1, 0.44, 2.06, 2.4].map((x) => woodAt(x, 3.75))).toEqual(['walnut', 'walnut', 'walnut', 'walnut']);
    expect([0.44, 2.06].map((x) => woodAt(x, 1.25))).toEqual(['cherry', 'cherry']);
    // Second row of bars, centred 3 3/4 along: the first position now holds the along bar.
    expect([2.94, 3.75, 4.56].map((x) => woodAt(x, 1.25))).toEqual(['walnut', 'walnut', 'walnut']);
    expect([3.75, 3.75, 3.75].map((x, i) => woodAt(x, [2.06, 2.5, 3.75][i]))).toEqual(['cherry', 'walnut', 'walnut']);
  });

  it('has a maple square with a cherry line round it wherever four bars meet', () => {
    // Squares are 3/4, centred on every multiple of 2 1/2 both ways; the edge of the board halves the outer ones.
    for (const [x, z] of [[2.5, 2.5], [2.5, 5], [5, 2.5], [7.5, 7.5]]) {
      expect(woodAt(x, z)).toBe('maple');
      expect([[x - 0.3, z - 0.3], [x + 0.3, z + 0.3]].map(([a, b]) => woodAt(a, b))).toEqual(['maple', 'maple']);
      expect([[x - 0.44, z], [x + 0.44, z], [x, z - 0.44], [x, z + 0.44]].map(([a, b]) => woodAt(a, b))).toEqual(['cherry', 'cherry', 'cherry', 'cherry']);
    }
    expect(woodAt(0.1, 0.1)).toBe('maple');
  });

  it('a bar lying across is one piece, and a bar lying along is three end to end', () => {
    /** The pieces of walnut a line down the board passes through between two points, by where each starts. */
    const walnutAlong = (z: number, from: number, to: number) => {
      const starts = new Set<number>();
      for (let x = from; x < to; x += 0.01) {
        const p = last.slices[0].pieces.find((q) => { const b = bbox([q]); return x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2]; });
        if (p?.species === 'walnut') starts.add(+bbox([p]).min[0].toFixed(3));
      }
      return starts.size;
    };
    // The along bar at z 3.75 runs from 0 (trimmed) to 2.5 through square row, bar row, square row.
    expect(walnutAlong(3.75, 0.01, 2.49)).toBe(3);
    // The across bar centred at (1.25, 1.25) is one piece 3 1/4 long but for the 3/8 the trim took: 2 7/8.
    const bar = last.slices[0].pieces.find((p) => { const b = bbox([p]); return 1.25 > b.min[0] && 1.25 < b.max[0] && 1.25 > b.min[2] && 1.25 < b.max[2]; })!;
    const size = bbox([bar]);
    expect([size.max[0] - size.min[0], size.max[2] - size.min[2]].map((n) => +n.toFixed(4))).toEqual([1.5, 2.875]);
  });

  it('is built by ordinary steps: the second panel repeats the first one\'s, then the two are interleaved', () => {
    expect(stages.map((st) => st.title)).toEqual([
      'First glue-up', 'Flatten', 'Trim', 'Cross cut', 'Turn to end grain',
      'Start another panel', 'Flatten', 'Trim', 'Cross cut', 'Turn to end grain',
      'Interleave the slices', 'Offset', 'Glue up', 'Flatten', 'Trim',
    ]);
    // No instruction is a wall of text: the longest is the second panel's milling list.
    expect(Math.max(...stages.map((st) => st.summary.length))).toBeLessThan(520);
    // The five square-row slices wait, untouched, through every step of the second panel.
    expect(stages.map((st) => st.aside?.length ?? 0)).toEqual([0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0]);
    expect(stages[9].aside!.map((sl) => sl.pieces.length)).toEqual(stages[4].slices.map((sl) => sl.pieces.length));
    // The second panel cut exactly the four slices the gaps need, and they went in alternately.
    expect(stages[9].slices).toHaveLength(4);
    expect(stages[10].slices).toHaveLength(9);
    expect(stages[10].warning).toBeUndefined();
    expect(stages[11].summary).toMatch(/Slide 2 1\/2″ along its length, towards edge A: every 4th slice, starting with slice 4 \(2 of 9\)/);
  });

  it('the second panel sizes itself, and its across bars are planks faced with the line wood', () => {
    const panel = stages[5];
    // Wide enough for the 10 3/4 slices and a 2 1/2 slide: three planks and two bar groups is 13 1/4.
    expect(+panel.size[2].toFixed(4)).toBe(13.25);
    // Long enough for four slices 1 3/8 wide with a kerf each and 1/4 off each end.
    expect(+panel.size[0].toFixed(4)).toBe(4 * (1.375 + 0.125) + 0.5);
    expect(panel.stock!.map((l) => [l.species, l.count, l.thickness, l.width])).toEqual([
      ['walnut', 3, 1.5, 3.25], ['cherry', 6, 0.1875, 3.25], ['cherry', 4, 1.875, 0.125], ['walnut', 2, 1.875, 1.5],
    ]);
    expect(panel.summary).toMatch(/^Set the 5 slices aside, in order\. Now a second panel: first make 3 walnut planks 1 1\/2″ thick and 3 1\/4″ wide, with a cherry face 3\/16″ thick glued to both sides/);
    // Flattening takes the 3/16 faces down to the 1/8 line.
    const face = stages[6].slices[0].pieces.find((p) => p.species === 'cherry' && bbox([p]).max[2] - bbox([p]).min[2] > 3)!;
    expect(+(bbox([face]).max[1] - bbox([face]).min[1]).toFixed(4)).toBe(0.125);
  });

  it('by default has a walnut border with a cherry line inside it, end grain like the rest', () => {
    const bordered = run({ ...basketWeave({ across: 4, along: 4 }), finish: NO_FINISH });
    const board = bordered[bordered.length - 1];
    expect(bordered.filter((s) => s.error || s.warning)).toEqual([]);
    // 1 1/2 of walnut and a 1/8 line on every side of the 10 × 10 weave.
    expect(board.size.map((n) => +n.toFixed(6))).toEqual([13.25, 1.25, 13.25]);
    expect(board.slices[0].pieces.every((p) => p.species === 'cherry' || Math.abs(p.grain[1]) > 0.99)).toBe(true);
    expect([woodAt(0.75, 6, board), woodAt(1.56, 6, board), woodAt(6, 0.75, board), woodAt(6, 1.56, board), woodAt(0.5, 0.5, board)]).toEqual(['walnut', 'cherry', 'walnut', 'cherry', 'walnut']);
    // The weave sits inside it unchanged: the first across bar, moved in by the border.
    expect(woodAt(1.625 + 1.25, 1.625 + 1.25, board)).toBe('walnut');
    expect(woodAt(1.625 + 2.5, 1.625 + 2.5, board)).toBe('maple');
    expect(bordered.find((s) => s.title === 'Add a border')!.summary).toMatch(/Glue up two walnut panels 1 1\/2″ thick/);
  });
});
