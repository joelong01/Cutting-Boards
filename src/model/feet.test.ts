import { describe, expect, it } from 'vitest';
import { buildCutList } from './cutlist';
import { DEFAULT_DIMENSIONS } from './design';
import { DEFAULT_FINISH, NO_FINISH, finishOf } from './finish';
import { bbox } from './geometry';
import { finishedBoard, run } from './pipeline';
import { PRESETS } from './presets';
import { validateDesign } from './storage';
import type { Design, Finish } from './types';

/** The brick starter with these feet settings added to its finish. */
const withFeet = (feet: Partial<NonNullable<Finish['feet']>>, base: Finish = DEFAULT_FINISH): Design => {
  const d = PRESETS.find((p) => p.key === 'brick')!.make();
  return { ...d, finish: { ...base, feet: { ...DEFAULT_FINISH.feet, on: true, ...feet } } };
};

describe('feet: an optional last step', () => {
  it('are off unless asked for, and start at the size of the common screw-on feet', () => {
    const d = PRESETS.find((p) => p.key === 'brick')!.make();
    expect(finishOf(d).feet).toEqual({ on: false, diameter: 0.82, height: 0.35, inset: 1 });
    expect(run(d).some((s) => s.finish === 'feet')).toBe(false);
    expect(NO_FINISH.feet!.on).toBe(false);
    // A design saved before there were feet has none.
    expect(finishOf(validateDesign(JSON.parse(JSON.stringify({ ...d, finish: { ...d.finish, feet: undefined } })))).feet.on).toBe(false);
  });

  it('go on last, after the sanding: one under each corner, with an instruction of their own', () => {
    const stages = run(withFeet({}));
    expect(stages.at(-1)!.title).toBe('Add the feet');
    expect(stages.at(-2)!.title).toBe('Sand and oil');
    const last = stages.at(-1)!;
    const feet = last.slices[0].pieces.filter((p) => p.species === 'feet');
    expect(feet).toHaveLength(4);
    const [x, , z] = last.size;
    const centres = feet.map((p) => { const b = bbox([p]); return [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2].map((v) => +v.toFixed(6)); });
    expect(centres).toEqual([[1, 1], [+(x - 1).toFixed(6), 1], [1, +(z - 1).toFixed(6)], [+(x - 1).toFixed(6), +(z - 1).toFixed(6)]]);
    for (const p of feet) {
      const b = bbox([p]);
      // Under the board, as tall and as wide as asked.
      expect(b.max[1]).toBeCloseTo(0, 9);
      expect(b.min[1]).toBeCloseTo(-0.35, 9);
      expect(b.max[0] - b.min[0]).toBeCloseTo(0.82, 6);
    }
    expect(last.summary).toBe('Turn the board over and screw a foot inside each of the four corners, its centre 1″ in from both edges. '
      + 'The feet are 0.82″ across and 0.35″ tall. Drill a pilot hole for each screw, and check the screws are shorter than the board is thick.');
    expect(last.error ?? last.warning).toBeUndefined();
  });

  it('do not change the board: its size, its wood and its yield are those of the board without them', () => {
    const plain = PRESETS.find((p) => p.key === 'brick')!.make();
    const footed = withFeet({});
    const a = run(plain), b = run(footed);
    expect(b.at(-1)!.size).toEqual(a.at(-1)!.size);
    expect(finishedBoard(b).title).toBe('Sand and oil');
    expect(finishedBoard(a).title).toBe('Sand and oil');
    const [listA, listB] = [buildCutList(a, plain), buildCutList(b, footed)];
    expect(listB.finished).toEqual(listA.finished);
    expect(listB.yield).toBeCloseTo(listA.yield, 12);
    expect(listB.lines).toEqual(listA.lines);
    // The instructions do get the extra line.
    expect(listB.operations.at(-1)!.title).toBe('Add the feet');
    expect(listB.operations).toHaveLength(listA.operations.length + 1);
  });

  it('follow the sizes typed, and go on a board with no other finishing at all', () => {
    const stages = run(withFeet({ diameter: 1.5, height: 0.5, inset: 2 }, NO_FINISH));
    expect(stages.map((s) => s.finish).filter(Boolean)).toEqual(['feet']);
    const feet = stages.at(-1)!.slices[0].pieces.filter((p) => p.species === 'feet');
    const b = bbox([feet[0]]);
    expect([b.max[0] - b.min[0], -b.min[1], (b.min[0] + b.max[0]) / 2].map((v) => +v.toFixed(6))).toEqual([1.5, 0.5, 2]);
    expect(stages.at(-1)!.summary).toContain('its centre 2″ in from both edges. The feet are 1 1/2″ across and 1/2″ tall.');
  });

  it('are left off, with the reason, when they would stick out past the edges or meet in the middle', () => {
    const out = run(withFeet({ diameter: 2, inset: 0.5 })).at(-1)!;
    expect(out.warning).toBe('No feet: set 1/2″ in from the edges, feet 2″ across would stick out past them. Set them at least 1″ in.');
    expect(out.slices[0].pieces.some((p) => p.species === 'feet')).toBe(false);
    const meet = run(withFeet({ diameter: 1, inset: 20 })).at(-1)!;
    expect(meet.warning).toMatch(/^No feet: set 20″ in from the edges, they would meet in the middle of a board .*″ wide\.$/);
    expect(run(withFeet({ height: 0 })).at(-1)!.warning).toMatch(/need a diameter and a height/);
  });

  it('are built at the rounded sizes when the design rounds: 13/16 across and 3/8 tall at a sixteenth', () => {
    const d = { ...withFeet({}), dimensions: DEFAULT_DIMENSIONS };
    const b = bbox([run(d).at(-1)!.slices[0].pieces.find((p) => p.species === 'feet')!]);
    expect(b.max[0] - b.min[0]).toBeCloseTo(13 / 16, 6);
    expect(-b.min[1]).toBeCloseTo(3 / 8, 9);
  });
});
