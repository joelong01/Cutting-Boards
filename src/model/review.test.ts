import { describe, expect, it } from 'vitest';
import { DEFAULT_DIMENSIONS, layupOf } from './design';
import { fitToTarget } from './fit';
import { parseLength } from './fractions';
import { withGrain } from './grain';
import { run } from './pipeline';
import { PRESETS, catalog } from './presets';
import { validateDesign } from './storage';
import type { Design, Step } from './types';

/**
 * One test for each defect the review of pull request 2 found and that was fixed, built from the
 * case the reviewer used to show it. (Its third finding, that the edge-grain 3D board's
 * instructions round sizes its model keeps exact, was left as it is: the difference is too small
 * to see, and rounding can be set to Exact.)
 */

/** A starter design by its key. */
const preset = (key: string): Design => PRESETS.find((p) => p.key === key)!.make();

/** A design saved and opened again, as the app does it. */
const reopened = (d: Design): Design => validateDesign(JSON.parse(JSON.stringify(d)));

/** A length as an instruction writes it, in inches. */
const inchesOf = (text: string) => parseLength(text)!;

describe('defects found in review', () => {
  it('1: a 3D board\'s bevel rip is 30° or it is refused: no other tilt makes the diamonds the model draws', () => {
    const d = preset('tumbling-blocks');
    const tilted = (tilt: number): Design => ({ ...d, autoFit: false, steps: d.steps.map((s) => (s.type === 'rip' ? { ...s, tilt } : s)) });
    const at45 = run(tilted(45));
    expect(at45[1].error).toBe('A 3D board\'s strips are ripped with the blade tilted 30°: that is what makes diamonds, three of which close into a hexagon. At 45° they would not. Set the tilt to 30°.');
    // Nothing downstream pretends it worked.
    expect(at45[1].summary).toBe('');
    expect(at45.at(-1)!.error).toBeDefined();
    const at30 = run(tilted(30));
    expect(at30.filter((s) => s.error)).toEqual([]);
    expect(at30[1].summary).toMatch(/^Tilt the table saw blade 30°/);
  });

  it('2: with rounding on, an end-grain border\'s strips are milled a step over and trimmed, never short of the board', () => {
    const basket = fitToTarget({ ...catalog({ length: 16, width: 12, thickness: 1.5 }).find((o) => o.key === 'basket-weave')!.make(), dimensions: DEFAULT_DIMENSIONS });
    const at = basket.steps.findIndex((s) => s.type === 'frame');
    const stages = run(basket, (id) => id).filter((s) => s.step === at);
    const [mill, panels] = stages;
    const sides = stages.at(-1)!;
    const said = /(\d+) strips? ([\d /.]+)″ wide for the ends, and (\d+) strips? ([\d /.]+)″ wide for the sides/.exec(mill.summary)!;
    expect(said).not.toBeNull();
    const [endCount, endEach, sideCount, sideEach] = [+said[1], inchesOf(said[2]), +said[3], inchesOf(said[4])];
    // What the instruction says to mill, glued up, covers the end of the board and the length of the bordered board.
    expect(endCount * endEach).toBeGreaterThanOrEqual(mill.size[2] - 1e-9);
    expect(sideCount * sideEach).toBeGreaterThanOrEqual(sides.size[0] - 1e-9);
    // And each is a size that can be set: a whole number of sixteenths.
    for (const each of [endEach, sideEach]) expect(Math.abs(each * 16 - Math.round(each * 16))).toBeLessThan(1e-9);
    for (const line of mill.stock!.filter((l) => l.use.includes('panel'))) expect(Math.abs(line.width * 16 - Math.round(line.width * 16))).toBeLessThan(1e-9);
    expect(panels.summary).toMatch(/^Glue the strips edge to edge into two panels, which come out a little wide, and trim them to width:/);
    // With no rounding nothing is over and nothing is trimmed.
    const exact = run(fitToTarget({ ...basket, dimensions: { ...DEFAULT_DIMENSIONS, rounding: 0 } }), (id) => id).filter((s) => s.title === 'Glue up the border panels')[0];
    expect(exact.summary).toMatch(/^Glue the strips edge to edge into two panels: one /);
  });

  it('2: a border of single strips is cut a step over its length, to trim flush, when the board is off the step', () => {
    const d = fitToTarget({ ...preset('edge-grain-border'), target: { length: 16.3, width: 11.7, thickness: 1.5 }, dimensions: DEFAULT_DIMENSIONS });
    const at = d.steps.findIndex((s) => s.type === 'frame');
    const [mill, , sides] = run(d, (id) => id).filter((s) => s.step === at);
    const said = /two ([\d /.]+)″ long for the ends and two ([\d /.]+)″ long for the sides/.exec(mill.summary)!;
    expect(inchesOf(said[1])).toBeGreaterThanOrEqual(mill.size[2] - 1e-9);
    expect(inchesOf(said[2])).toBeGreaterThanOrEqual(sides.size[0] - 1e-9);
    for (const line of mill.stock!.filter((l) => /end pieces|side pieces/.test(l.use))) expect(Math.abs(line.length * 16 - Math.round(line.length * 16))).toBeLessThan(1e-9);
  });

  it('4: a second panel that sizes itself allows for the saw kerf in use: a 1/4 inch blade still gives a slice for every gap', () => {
    const basket = catalog({ length: 16, width: 12, thickness: 1.5 }).find((o) => o.key === 'basket-weave')!.make();
    for (const kerf of [1 / 16, 1 / 8, 1 / 4, 3 / 8]) {
      const d = fitToTarget({ ...basket, dimensions: { ...DEFAULT_DIMENSIONS, rounding: 0, kerf } });
      const stages = run(d);
      expect(stages.filter((s) => s.error).map((s) => `kerf ${kerf}: ${s.title}: ${s.error}`)).toEqual([]);
      expect(stages.some((s) => s.title === 'Interleave the slices')).toBe(true);
    }
    // The thicker blade takes longer stock for the second panel.
    const second = (kerf: number) => run(fitToTarget({ ...basket, dimensions: { ...DEFAULT_DIMENSIONS, rounding: 0, kerf } })).find((s) => s.title === 'Mill the second panel')!.size[0];
    expect(second(1 / 4)).toBeGreaterThan(second(1 / 8));
  });

  it('5: the edge-grain 3D board finishes at its target thickness whatever the rounding', () => {
    const flat = withGrain(preset('tumbling-blocks'), 'edge')!;
    for (const dims of [{ notation: 'decimal' as const, rounding: 0.01 }, { notation: 'fraction' as const, rounding: 1 / 16 }, { notation: 'metric' as const, rounding: 0.5 / 25.4 }, { notation: 'fraction' as const, rounding: 0 }]) {
      const d = fitToTarget({ ...flat, target: { length: 16, width: 12, thickness: 1.5 }, dimensions: { ...DEFAULT_DIMENSIONS, ...dims } });
      expect(run(d).at(-1)!.size[1], `rounding ${dims.rounding}`).toBeCloseTo(1.5, 9);
    }
  });

  it('6: a 3D board with steps of the user\'s own opens as it was saved: only the two old recipes are replaced', () => {
    const d = preset('tumbling-blocks');
    const extra: Step = { id: 'mine', type: 'flatten', top: 0.125, bottom: 0, note: 'Take the saw marks off the top.' };
    const edited: Design = { ...d, autoFit: false, steps: [...d.steps, extra] };
    const opened = reopened(edited);
    expect(opened.steps).toEqual(edited.steps);
    expect(run(opened).at(-1)!.size).toEqual(run(edited).at(-1)!.size);
    expect(run(opened).at(-1)!.size[1]).toBeCloseTo(1.375, 9);
    // A step taken out, or moved, is the user's too.
    const fewer: Design = { ...d, autoFit: false, steps: d.steps.filter((s) => s.type !== 'trim') };
    expect(reopened(fewer).steps).toEqual(fewer.steps);

    // The recipe as the first version saved it (no bevel rip) and as the second did (loose lengths of log) are brought up to date.
    const by = (types: string[]): Step[] => types.map((type, i) => {
      const like = d.steps.find((s) => s.type === type);
      return { ...(like ?? { type }), id: `old${i}` } as Step;
    });
    const first: Design = { ...d, steps: [d.steps[0], ...by(['glue', 'crosscut', 'turn', 'glue', 'trim', 'flatten'])] };
    const second: Design = { ...d, steps: [d.steps[0], ...by(['rip', 'glue', 'crosscut', 'turn', 'glue', 'trim', 'flatten'])] };
    for (const old of [first, second]) {
      const brought = reopened(old);
      expect(brought.steps.map((s) => s.type)).toEqual(d.steps.map((s) => s.type));
      expect(layupOf(brought).strips.map((s) => s.species)).toEqual(layupOf(d).strips.map((s) => s.species));
      expect(run(brought).filter((s) => s.error)).toEqual([]);
      expect(run(brought).at(-1)!.size.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 1.5, 12]);
    }
  });
});
