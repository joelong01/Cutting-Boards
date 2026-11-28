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

  it('a new thickness typed on an end-grain board changes the board: the slices are cut to it, rounding or not', () => {
    for (const rounding of [0, 1 / 16]) {
      const brick = fitted(preset('brick'), 16, 12, 2);
      const before = { ...brick, dimensions: { notation: 'fraction' as const, rounding, minWidth: 0.125 } };
      expect(finished(before).thick, String(rounding)).toBeCloseTo(2, 6);
      // 43 mm, which is on no sixteenth.
      const after = withAutoFit(before, { ...before, target: { ...before.target, thickness: 43 / 25.4 } });
      const size = finished(after);
      expect(Math.abs(size.thick - 43 / 25.4), String(rounding)).toBeLessThanOrEqual(rounding / 2 + 1e-6);
      expect(Math.abs(size.long - 16), String(rounding)).toBeLessThan(rounding ? 0.5 : 1e-6);
      // The wood is the length of a block here, and is not what gave way.
      expect(unfitted(after).steps[0], String(rounding)).toMatchObject({ thickness: layupOf(before).thickness });
    }
  });

  it('on an edge-grain board every flattening takes its allowance, one rounding step, and neither the wood nor the flattening gives way to the thickness wanted', () => {
    /** An edge-grain brick board rounding to `rounding`, from wood `start` thick, wanted `want` thick. */
    const board = (rounding: number, start: number, want: number) => {
      const edge = withGrain({ ...fitted(preset('brick'), 16, 12, 2), dimensions: { notation: 'fraction' as const, rounding, minWidth: 0.125 } }, 'edge')!;
      const wood = withAutoFit(edge, withLayup(edge, { thickness: start }));
      return withAutoFit(wood, { ...wood, target: { ...wood.target, thickness: want } });
    };
    /** What each flattening takes off the top and the bottom. */
    const passes = (d: Design) => d.steps.filter((s) => s.type === 'flatten').map((s) => { const f = s as { top: number; bottom: number }; return [f.top, f.bottom]; });
    /** The instructions of the flattenings, and of the step that mills the wood. */
    const said = (d: Design) => ({ flat: run(d).filter((s) => s.title === 'Flatten').map((s) => s.summary), rip: run(d)[0].summary });

    // Flat stock 2 thick, 1 1/2 wanted, eighths: two glue-ups, 1/8 off at each, and the board is 1 3/4.
    const over = board(1 / 8, 2, 1.5);
    expect(layupOf(over).thickness).toBe(2);
    expect(over.target.thickness).toBe(1.5);
    expect(passes(over)).toEqual([[0.0625, 0.0625], [0.0625, 0.0625]]);
    expect(finished(over).thick).toBeCloseTo(1.75, 9);
    expect(finished(over).long).toBeCloseTo(16, 0);
    expect(said(over).rip).toMatch(/It is flattened 2 times, allowing for up to 1\/8″ each time off the thickness, which leaves it 1 3\/4″ thick\.$/);
    expect(said(over).flat[0]).toMatch(/take off only what it needs to come flat, up to 1\/16″ off the top and 1\/16″ off the bottom, which leaves it 1 7\/8″ thick\.$/);
    expect(said(over).flat[1]).toMatch(/which leaves it 1 3\/4″ thick\. This is the last flattening\. With every flattening taken in full the board is 1\/4″ over the 1 1\/2″ wanted: keep going, the same off each face, until it is 1 1\/2″ thick\.$/);

    // Wood too thin for it: the same allowances, and it says how far under. Not an error.
    const under = board(1 / 8, 1.5, 1.5);
    expect(layupOf(under).thickness).toBe(1.5);
    expect(passes(under)).toEqual(passes(over));
    expect(finished(under).thick).toBeCloseTo(1.25, 9);
    expect(said(under).flat[1]).toMatch(/This is the last flattening\. With every flattening taken in full the board is 1\/4″ under the 1 1\/2″ wanted\. Wherever a glue-up came out flat and less was taken, it is that much thicker\.$/);

    // Wood that lands on it.
    const exact = board(1 / 8, 1.75, 1.5);
    expect(finished(exact).thick).toBeCloseTo(1.5, 9);
    expect(said(exact).flat[1]).toMatch(/which leaves it 1 1\/2″ thick\. This is the last flattening\. That is the thickness wanted\.$/);

    // The allowance is the rounding step: sixteenths take 1/16 at each flattening, and so does a board that rounds nothing.
    for (const rounding of [1 / 16, 0]) {
      const fine = board(rounding, 1.6875, 1.5);
      expect(passes(fine), String(rounding)).toEqual([[0.03125, 0.03125], [0.03125, 0.03125]]);
      expect(finished(fine).thick, String(rounding)).toBeCloseTo(1.5625, 9);
      expect(layupOf(fine).thickness, String(rounding)).toBe(1.6875);
    }
    // Changing the rounding changes the allowance, and nothing but the flattenings.
    const coarser = withAutoFit(exact, { ...exact, dimensions: { ...exact.dimensions!, rounding: 1 / 16 } });
    expect(passes(coarser)).toEqual([[0.03125, 0.03125], [0.03125, 0.03125]]);
    expect(layupOf(coarser).thickness).toBe(1.75);

    // A board stood on end is left to its cross cut: its flattenings are as they were and none is called the last.
    const end = fitted(preset('brick'), 16, 12, 2);
    const stood = withAutoFit(end, withLayup(end, { thickness: 1.6875 }));
    expect(stood.target.thickness).toBe(2);
    expect(finished(stood).thick).toBeCloseTo(2, 6);
    expect(passes(stood)).toEqual(passes(end));
    expect(said(end).flat.join(' ')).not.toMatch(/last flattening/);
  });

  it('a stock length too short to build from does not leave a held board broken: the fit finds the stock again', () => {
    for (const rounding of [0, 1 / 16]) {
      for (const grain of ['end', 'edge'] as const) {
        const brick = withGrain({ ...fitted(preset('brick'), 16, 12, 1.5), dimensions: { notation: 'fraction' as const, rounding, minWidth: 0.125 } }, grain)!;
        const good = layupOf(brick).length;
        // 1 1/2 typed into Stock length: shorter than one slice, so nothing can be cut from it.
        const typed = withAutoFit(brick, withLayup(brick, { length: 1.5 }));
        expect(layupOf(typed).length, `${grain} ${rounding}`).toBeCloseTo(good, 6);
        const size = finished(typed);
        expect(Math.abs(size.long - 16), `${grain} ${rounding}`).toBeLessThan(rounding ? 0.5 : 1e-6);
        expect(Math.abs(size.short - 12), `${grain} ${rounding}`).toBeLessThan(rounding ? 0.5 : 1e-6);
        // And a board already saved in that state recovers on the next edit or when it is opened.
        const stuck = withLayup(brick, { length: 1.5 });
        expect(run(stuck).some((s) => s.error), `${grain} ${rounding}`).toBe(true);
        expect(layupOf(fitToTarget(stuck)).length, `${grain} ${rounding}`).toBeCloseTo(good, 6);
        expect(layupOf(withAutoFit(stuck, { ...stuck, target: { ...stuck.target, length: 16.5 } })).length, `${grain} ${rounding}`).toBeGreaterThan(10);
      }
    }
  });

  it('turning a board to edge grain is not a change of wood: it stays on its target thickness with the flattenings it had', () => {
    const end = fitted(preset('maple-purpleheart'), 16, 12, 1.125);
    const edge = withGrain(end, 'edge')!;
    const kept = withAutoFit(end, edge);
    expect(kept.steps.filter((s) => s.type === 'flatten')).toEqual(edge.steps.filter((s) => s.type === 'flatten'));
    expect(finished(kept).thick).toBeCloseTo(1.125, 6);
  });

  it('a thickness wanted that is typed on a board cut at an angle leaves its cross cut alone', () => {
    // A chevron has a cross cut and no slices stood on end: its wood sets its thickness.
    const chevron = { ...preset('chevron'), dimensions: { notation: 'fraction' as const, rounding: 1 / 16, minWidth: 0.125 } };
    const cuts = (d: Design) => d.steps.filter((s) => s.type === 'crosscut').map((s) => (s as { width: number }).width);
    const nudged = withAutoFit(chevron, { ...chevron, target: { ...chevron.target, thickness: finished(chevron).thick + 0.02 } });
    expect(cuts(nudged)).toEqual(cuts(fitToTarget(chevron)));
    expect(layupOf(nudged).thickness).toBe(layupOf(chevron).thickness);
    const thick = finished(nudged).thick;
    expect(Math.abs(thick * 16 - Math.round(thick * 16))).toBeLessThan(1e-9);
  });

  it('with rounding on the board is never a whole block under its target: the stock is long enough for every slice at its rounded width', () => {
    // An edge-grain brick 16 1/4 long from blocks 1 3/8 wide: the exact fit cuts 12 slices a little
    // under 1 3/8, sixteenths round them up, and stock found for the exact slices held only 11.
    const brick = preset('brick');
    const end = withAutoFit(brick, withLayup({ ...brick, dimensions: { notation: 'fraction', rounding: 1 / 16, minWidth: 0.125 } }, { thickness: 1.5 }));
    const edge = withGrain(end, 'edge')!;
    const size = finished(edge);
    expect(Math.abs(size.long - 16.25)).toBeLessThan(0.5);
    expect(Math.abs(size.short - 13)).toBeLessThan(0.5);
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
