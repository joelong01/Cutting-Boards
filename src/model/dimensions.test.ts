import { describe, expect, it } from 'vitest';
import { DEFAULT_DIMENSIONS, dimensionsOf, layupOf, milledStrips, sizingOf } from './design';
import { fitToTarget, withAutoFit } from './fit';
import { roundTo } from './fractions';
import { bbox, boxSize } from './geometry';
import { run } from './pipeline';
import { PRESETS, catalog, offerOf } from './presets';
import type { Design, Dimensions } from './types';
import { ROUNDINGS, inchText, showLength, showSize, showText, unitsOf, usualRounding } from './units';

/** A starter design by its key. */
const preset = (key: string): Design => PRESETS.find((p) => p.key === key)!.make();

/** A design with these dimension settings, fitted to its target the way an edit leaves it. */
const withDims = (d: Design, dims: Partial<Dimensions>): Design =>
  fitToTarget({ ...d, dimensions: { ...DEFAULT_DIMENSIONS, ...dims } });

/** Whether a length is a whole number of steps. */
const onGrid = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-6;

describe('dimensions: notation, rounding and the thinnest strip', () => {
  it('a design saved before there were any writes fractions, rounds nothing and has no minimum', () => {
    const d = preset('maple-purpleheart');
    expect(d.dimensions).toBeUndefined();
    expect(dimensionsOf(d)).toEqual({ notation: 'fraction', rounding: 0, minWidth: 0 });
    expect(unitsOf(d)).toEqual({ imperial: true, metric: false, decimal: false, step: undefined });
    expect(DEFAULT_DIMENSIONS).toEqual({ notation: 'fraction', rounding: 1 / 16, minWidth: 1 / 8, kerf: 1 / 8 });
  });

  it('rounds to the nearest step, keeps anything smaller than a step, and never rounds to nothing', () => {
    expect(roundTo(0.941, 1 / 16)).toBeCloseTo(15 / 16, 12);
    expect(roundTo(1.443, 1 / 8)).toBeCloseTo(1.5, 12);
    expect(roundTo(0.125, 0.25)).toBe(0.125);
    expect(roundTo(0.0625, 0.125)).toBe(0.0625);
    expect(roundTo(-0.3, 0.25)).toBeCloseTo(-0.25, 12);
    expect(roundTo(1.443, 0)).toBe(1.443);
    expect(roundTo(1.443, undefined)).toBe(1.443);
  });

  it('writes a length as a fraction, a decimal or millimetres, rounded to the step, like a caliper', () => {
    const fraction = unitsOf({ dimensions: { notation: 'fraction', rounding: 1 / 16, minWidth: 0 } });
    const decimal = unitsOf({ dimensions: { notation: 'decimal', rounding: 0.01, minWidth: 0 } });
    const metric = unitsOf({ dimensions: { notation: 'metric', rounding: 0.5 / 25.4, minWidth: 0 } });
    expect(showLength(1.443, fraction)).toBe('1 7/16″');
    expect(showLength(1.443, decimal)).toBe('1.44″');
    expect(showLength(1.5, decimal)).toBe('1.5″');
    expect(showLength(16, decimal)).toBe('16″');
    expect(showLength(1.443, metric)).toBe('36.5 mm');
    expect(showLength(16, unitsOf({ dimensions: { notation: 'metric', rounding: 1 / 25.4, minWidth: 0 } }))).toBe('406 mm');
    expect(inchText(1.4434, { imperial: true, metric: false, decimal: true })).toBe('1.443″');
    expect(showSize([1.25, 1.443, 28], fraction)).toBe('1 1/4″ × 1 7/16″ × 28″');
    expect(showSize([1.25, 1.443, 28], decimal)).toBe('1.25″ × 1.44″ × 28″');
  });

  it('rewrites the lengths in an instruction the same way, and leaves angles and counts alone', () => {
    const sentence = 'Rip 3 strips 1.443″ wide and 24 1/2″ long with the blade at 30°, 0.856″ off edge A.';
    expect(showText(sentence, unitsOf({ dimensions: { notation: 'fraction', rounding: 1 / 16, minWidth: 0 } })))
      .toBe('Rip 3 strips 1 7/16″ wide and 24 1/2″ long with the blade at 30°, 7/8″ off edge A.');
    expect(showText(sentence, unitsOf({ dimensions: { notation: 'decimal', rounding: 0.01, minWidth: 0 } })))
      .toBe('Rip 3 strips 1.44″ wide and 24.5″ long with the blade at 30°, 0.86″ off edge A.');
    expect(showText(sentence, unitsOf({ dimensions: { notation: 'metric', rounding: 0.5 / 25.4, minWidth: 0 } })))
      .toBe('Rip 3 strips 36.5 mm wide and 622.5 mm long with the blade at 30°, 21.5 mm off edge A.');
    // With nothing to change it is the sentence as written.
    expect(showText(sentence, unitsOf({}))).toBe(sentence);
  });

  it('offers steps that suit each notation and starts each at a usual one', () => {
    expect(ROUNDINGS.fraction.map((r) => r.label)).toEqual(['1/64″', '1/32″', '1/16″', '1/8″']);
    expect(ROUNDINGS.decimal.map((r) => r.label)).toEqual(['0.001″', '0.005″', '0.01″']);
    expect(ROUNDINGS.metric.map((r) => r.label)).toEqual(['0.1 mm', '0.5 mm', '1 mm']);
    expect(usualRounding('fraction')).toBe(1 / 16);
    expect(usualRounding('decimal')).toBe(0.01);
    expect(usualRounding('metric')).toBeCloseTo(0.5 / 25.4, 12);
  });

  it('builds the board from the rounded sizes: every strip, the stock and the finished board are on the step', () => {
    for (const step of [1 / 16, 1 / 8, 1 / 4]) {
      const d = withDims({ ...preset('maple-purpleheart'), target: { length: 16, width: 12, thickness: 1.125 } }, { rounding: step });
      const stages = run(d);
      expect(stages.filter((s) => s.error).map((s) => s.error)).toEqual([]);
      for (const line of stages.flatMap((s) => s.stock ?? [])) {
        // A strip thinner than one step is kept as it is: the 1/8 lines at a 1/4 step.
        for (const v of [line.thickness, line.width, line.length]) expect(v < step || onGrid(v, step)).toBe(true);
      }
      for (const s of stages[0].slices) expect(onGrid(boxSize(bbox(s.pieces))[2], Math.min(step, 1 / 8))).toBe(true);
      const size = stages.at(-1)!.size;
      expect(onGrid(size[0], Math.min(step, 1 / 8)) && onGrid(size[2], Math.min(step, 1 / 8))).toBe(true);
      expect(milledStrips(layupOf(d), sizingOf(d).grid).every((s) => s.width < step || onGrid(s.width, step))).toBe(true);
    }
  });

  it('with no rounding the same board is exactly its target, and rounding moves it off by what the sizes add up to', () => {
    const base = { ...preset('maple-purpleheart'), target: { length: 16, width: 12, thickness: 1.125 } };
    const exact = run(withDims(base, { rounding: 0 })).at(-1)!.size;
    expect([exact[0], exact[2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 12]);
    const rounded = run(withDims(base, { rounding: 1 / 16 })).at(-1)!.size;
    expect(Math.abs(rounded[0] - 16)).toBeGreaterThan(1e-3);
    expect(Math.abs(rounded[0] - 16)).toBeLessThan(1);
    expect(Math.abs(rounded[2] - 12)).toBeLessThan(1);
  });

  it('refits when the rounding changes, and not when only the notation or the minimum does', () => {
    const before = withDims(preset('maple-purpleheart'), { rounding: 0 });
    const coarser = withAutoFit(before, { ...before, dimensions: { ...dimensionsOf(before), rounding: 1 / 8 } });
    expect(run(coarser).at(-1)!.size).not.toEqual(run(before).at(-1)!.size);
    const metric = { ...before, dimensions: { ...dimensionsOf(before), notation: 'metric' as const, minWidth: 0.25 } };
    expect(withAutoFit(before, metric)).toBe(metric);
  });

  it('flags a strip thinner than the minimum on the step that mills it, and nothing when there is no minimum', () => {
    const d = withDims(preset('maple-purpleheart'), { rounding: 0, minWidth: 0.25 });
    const stages = run(d, (id) => id);
    expect(stages[0].warning).toBe('Thinner than the 1/4″ minimum: purpleheart at 1/8″. Make it at least that, or lower the minimum under Dimensions.');
    // The purpleheart put between the slices later is flagged on its own step.
    expect(stages.filter((s) => s.warning?.includes('Thinner than')).map((s) => s.title)).toEqual(['Rip the strips', 'Mill the accent strips']);
    expect(run(withDims(preset('maple-purpleheart'), { rounding: 0, minWidth: 0.125 })).some((s) => s.warning?.includes('Thinner than'))).toBe(false);
    expect(run(preset('maple-purpleheart')).some((s) => s.warning?.includes('Thinner than'))).toBe(false);
  });

  it('the 3D board still has all its pieces at every rounding, and lands on its target thickness', () => {
    for (const dims of [{ notation: 'decimal' as const, rounding: 0.01 }, { notation: 'metric' as const, rounding: 0.5 / 25.4 }, { notation: 'fraction' as const, rounding: 1 / 4 }, { notation: 'fraction' as const, rounding: 1 / 16 }]) {
      const stages = run(withDims(preset('tumbling-blocks'), dims));
      expect(stages.filter((s) => s.error).map((s) => `${dims.rounding}: ${s.error}`)).toEqual([]);
      const size = stages.at(-1)!.size;
      expect(size[0]).toBeCloseTo(16, 6);
      expect(size[2]).toBeCloseTo(12, 6);
      expect(Math.abs(size[1] - 1.5)).toBeLessThan(dims.rounding + 1e-9);
    }
  });

  it('a saw kerf under Dimensions is the kerf of every cut, and the stock is sized for it', () => {
    const base = { ...preset('maple-purpleheart'), target: { length: 16, width: 12, thickness: 1.125 } };
    const thin = withDims(base, { rounding: 0, kerf: 1 / 16 }), thick = withDims(base, { rounding: 0, kerf: 3 / 16 });
    for (const d of [thin, thick]) {
      const stages = run(d);
      expect(stages.filter((s) => s.error)).toEqual([]);
      expect(stages.find((s) => s.title === 'Cross cut')!.summary).toContain(`(kerf ${d.dimensions!.kerf === 1 / 16 ? '1/16″' : '3/16″'})`);
      // The board still comes out at its target: the wider kerf is paid for in stock, not in size.
      const size = stages.at(-1)!.size;
      expect([size[0], size[2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 12]);
    }
    expect(layupOf(thick).length).toBeGreaterThan(layupOf(thin).length);
    // Without the setting each cutting step keeps its own kerf.
    expect(run(withDims(base, { rounding: 0 })).find((s) => s.title === 'Cross cut')!.summary).toContain('(kerf 1/8″)');
    expect(run(preset('maple-purpleheart')).find((s) => s.title === 'Cross cut')!.summary).toContain('(kerf 1/8″)');
    // Changing it is a reason to fit again.
    expect(withAutoFit(thin, { ...thin, dimensions: { ...thin.dimensions!, kerf: 3 / 16 } })).not.toBe(thin);
  });

  it('the boards of a 3D board are milled wide enough for the kerf of every cut and the corner the bevel wastes', () => {
    const narrow = withDims(preset('tumbling-blocks'), { rounding: 0, kerf: 1 / 16 }), wide = withDims(preset('tumbling-blocks'), { rounding: 0, kerf: 1 / 4 });
    const width = (d: Design) => run(d)[0].stock![0].width;
    expect(width(wide)).toBeGreaterThan(width(narrow));
    // Three strips 1.443 on a side, the half-strip corner, and three kerfs as they lie across a 30° cut.
    const side = 1.25 / (Math.sqrt(3) / 2);
    expect(width(wide)).toBeGreaterThanOrEqual(side / 2 + 3 * (side + 0.25 / (Math.sqrt(3) / 2)) - 1e-9);
    for (const d of [narrow, wide]) expect(run(d).filter((s) => s.error)).toEqual([]);
  });

  it('lists every design once for the Target board tile and knows which one an open board is', () => {
    const offers = catalog({ length: 16, width: 12, thickness: 1.5 });
    expect(offers.map((o) => o.key)).toEqual(['single-end-grain', 'edge-grain-stripes', 'edge-grain-border', 'maple-purpleheart', 'checkerboard', 'brick', 'basket-weave', 'chevron', 'tumbling-blocks', 'chess', 'double']);
    for (const o of offers) expect(offerOf(o.make())).toBe(o.key);
    // The same single-wood board in the other grain is still that design.
    expect(offerOf(preset('single-edge-grain'))).toBe('single-end-grain');
    expect(offerOf({ style: 'something of my own' })).toBeNull();
    expect(offerOf({})).toBeNull();
    for (const o of offers.slice(0, 4)) {
      const size = run(o.make()).at(-1)!.size;
      expect([Math.max(size[0], size[2]), Math.min(size[0], size[2])].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 12]);
    }
  });
});
