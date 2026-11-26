import { describe, expect, it } from 'vitest';
import { isLocked, layupOf, milledStrips, sizingOf, unfitted, withLayup } from './design';
import { fitThickness, fitToTarget, withAutoFit } from './fit';
import { NO_FINISH } from './finish';
import { withGrain } from './grain';
import { run } from './pipeline';
import { PRESETS } from './presets';
import type { Design } from './types';

/** A fresh starter design by key, with no finishing cuts. */
const preset = (key: string): Design => ({ ...PRESETS.find((p) => p.key === key)!.make(), finish: NO_FINISH });
/** The finished board's longer side, shorter side and thickness. */
const finished = (d: Design) => {
  const stages = run(d);
  expect(stages.filter((s) => s.error).map((s) => s.error)).toEqual([]);
  const [x, y, z] = stages.at(-1)!.size;
  return { long: Math.max(x, z), short: Math.min(x, z), thick: y };
};
/** Fit a design to a board size the way the wizard and the editor do. */
const fitted = (d: Design, length: number, width: number, thickness: number) =>
  fitThickness(fitToTarget({ ...d, target: { length, width, thickness } }));

const SIZES: [number, number, number][] = [[12, 9, 0.75], [16, 12, 1.25], [18, 12, 1.5], [20, 16, 2], [14.5, 10.25, 1.125], [17.3, 11.1, 1.3]];
/** The starters whose sizes can give way: every one but the two-panel basket weave and the angled chevron. */
const EXACT = ['single-end-grain', 'single-edge-grain', 'edge-grain-stripes', 'edge-grain-border', 'maple-purpleheart', 'checkerboard', 'brick'];

describe('the board finishes at the size asked for', () => {
  for (const key of EXACT) {
    for (const [length, width, thickness] of SIZES) {
      it(`${key} at ${length} x ${width} x ${thickness} is that size exactly`, () => {
        const size = finished(fitted(preset(key), length, width, thickness));
        expect(size.long).toBeCloseTo(length, 8);
        expect(size.short).toBeCloseTo(width, 8);
        expect(size.thick).toBeCloseTo(thickness, 8);
      });
    }
  }

  it('it is still exact in the other grain: the strips\' width and thickness give way, the board does not', () => {
    for (const key of ['maple-purpleheart', 'checkerboard', 'brick', 'edge-grain-stripes', 'edge-grain-border']) {
      const d = fitted(preset(key), 16, 12, 1.25);
      const other = withGrain(d, key.startsWith('edge') ? 'end' : 'edge')!;
      expect(other, key).not.toBeNull();
      const size = finished(other);
      expect(size.long, key).toBeCloseTo(16, 8);
      expect(size.short, key).toBeCloseTo(12, 8);
      expect(size.thick, key).toBeCloseTo(1.25, 8);
    }
  });

  it('the sizes asked for are kept; what the fit changes is stored beside them', () => {
    const base = preset('maple-purpleheart');
    const d = fitted(base, 16, 12, 1.125);
    // The strips still say 1 and 1/8: the maple is milled narrower, the purpleheart line is not.
    expect(layupOf(d).strips.map((s) => s.width)).toEqual([1, 0.125]);
    expect(layupOf(d).strips.map(isLocked)).toEqual([false, true]);
    const [maple, line] = milledStrips(layupOf(d));
    expect(line.width).toBe(0.125);
    expect(maple.width).toBeLessThan(1);
    expect(maple.width).toBeGreaterThan(0.9);
    // 11 maple strips and 10 lines make exactly 12.
    expect(11 * maple.width + 10 * 0.125).toBeCloseTo(12, 9);
    // Along the board the slices stand on end, so it is the strips' thickness that gives way.
    expect(sizingOf(d).alongOn).toBe('thickness');
    expect(layupOf(d).along).toBeLessThan(0);
    // Without the fit's adjustments the board is the old "at least" size: a little over both ways.
    const loose = finished(unfitted(d));
    expect(loose.long).toBeGreaterThan(16);
    expect(loose.short).toBeGreaterThan(12);
  });

  it('a strip marked locked keeps its width, and one marked unlocked gives way even if thin', () => {
    const base = preset('edge-grain-stripes');
    const strips = layupOf(base).strips.map((s, i) => (i === 0 ? { ...s, locked: true } : s.width < 0.375 ? { ...s, locked: false } : s));
    const d = fitted(withLayup(base, { strips }), 16, 11.5, 1.125);
    const milled = milledStrips(layupOf(d));
    expect(milled[0].width).toBe(strips[0].width);
    expect(milled[1].width).not.toBe(strips[1].width);
    expect(finished(d).short).toBeCloseTo(11.5, 8);
  });

  it('fitting again changes nothing, and going to another size and back gives the same board', () => {
    const d = fitted(preset('brick'), 16, 12, 1.25);
    const again = fitThickness(fitToTarget(d));
    expect(layupOf(again)).toEqual(layupOf(d));
    const there = fitted(d, 22, 15, 1.75);
    const back = fitted(there, 16, 12, 1.25);
    expect(layupOf(back)).toEqual(layupOf(d));
    expect(back.steps.slice(1)).toEqual(d.steps.slice(1));
  });

  it('a brick board keeps its half-block slide when the blocks are narrowed', () => {
    const d = fitted(preset('brick'), 16, 12, 1.5);
    const stages = run(d);
    const slid = stages.find((s) => s.title === 'Offset')!;
    const block = milledStrips(layupOf(d))[0].width;
    expect(block).toBeLessThan(2);
    // Slices 2, 4, 6... sit half a block along from their neighbours.
    const starts = slid.slices.map((sl) => Math.min(...sl.pieces.flatMap((p) => p.faces.flatMap((f) => f.map((v) => v[2])))));
    expect(starts[1] - starts[0]).toBeCloseTo(block / 2, 9);
  });

  it('an edit while the size is held leaves the board at its target', () => {
    const before = fitted(preset('checkerboard'), 18, 12, 1.5);
    const strips = layupOf(before).strips.map((s) => ({ ...s, width: 1.75 }));
    const after = withAutoFit(before, withLayup(before, { strips }));
    // The widths typed are kept as asked for, and the board is still 18 x 12.
    expect(layupOf(after).strips.map((s) => s.width)).toEqual([1.75, 1.75]);
    const size = finished(after);
    expect(size.long).toBeCloseTo(18, 8);
    expect(size.short).toBeCloseTo(12, 8);
  });

  it('patterns whose pieces must match each other are left a little over, not broken', () => {
    for (const key of ['basket-weave', 'chevron']) {
      const p = preset(key);
      const d = fitToTarget({ ...p, target: { ...p.target, length: p.target.length + 0.6, width: p.target.width + 0.4 } });
      expect(layupOf(d).scale, key).toBeUndefined();
      expect(layupOf(d).along, key).toBeUndefined();
      const size = finished(d);
      expect(size.long, key).toBeGreaterThanOrEqual(d.target.length - 1e-9);
      expect(size.short, key).toBeGreaterThanOrEqual(d.target.width - 1e-9);
    }
  });
});
