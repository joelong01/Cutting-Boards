// One test at least for each feature that pipeline.test.ts does not already cover: the individual
// steps, selectors, step errors, design files, the cut list's arithmetic, and the wizard's resizing.
import { describe, expect, it } from 'vitest';
import { buildCutList, THIN } from './cutlist';
import { NO_FINISH } from './finish';
import { fitThickness, fitToTarget } from './fit';
import { bbox, volume } from './geometry';
import { describeSelector, expandStrips, matches, run, stepNeeds } from './pipeline';
import { CHESS_SQUARES, PRESETS, chessBoard, insertStep, newStep } from './presets';
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
  const TYPES: StepType[] = ['crosscut', 'turn', 'flip', 'shift', 'insert', 'glue', 'trim', 'flatten', 'rotate'];

  it('every kind of step can be made, with its own id, and runs on the kind of stage it needs', () => {
    const made = TYPES.map((t) => newStep(t));
    expect(made.map((s) => s.type)).toEqual(TYPES);
    expect(new Set(made.map((s) => s.id)).size).toBe(TYPES.length);
    for (const step of made) {
      const before = stepNeeds(step.type) === 'panel' ? [] : [newStep('crosscut')];
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
