import { describe, expect, it } from 'vitest';
import { NO_FINISH } from './finish';
import { run, runSteps, wholeSteps } from './pipeline';
import { PRESETS, catalog } from './presets';
import type { Design, Stage } from './types';

/** A starter design by its key, without its finishing touches. */
const plain = (key: string): Design => ({ ...PRESETS.find((p) => p.key === key)!.make(), finish: NO_FINISH });

/** The stages of one step of a design, by the step's type and which one of that type it is. */
function stagesOf(d: Design, type: string, nth = 0): Stage[] {
  const at = d.steps.map((s, i) => (s.type === type ? i : -1)).filter((i) => i >= 0)[nth];
  return run(d, (id) => id).filter((s) => s.step === at);
}

describe('one operation at the bench is one stage: a picture, an instruction', () => {
  it('every design steps through its operations in order, and each has an instruction', () => {
    for (const offer of catalog({ length: 16, width: 12, thickness: 1.5 })) {
      const d = offer.make();
      const stages = run(d, (id) => id);
      const whole = runSteps(d, (id) => id);
      expect(stages.filter((s) => s.error).map((s) => `${offer.label}: ${s.error}`)).toEqual([]);
      for (const s of stages) expect(s.summary.length, `${offer.label}: ${s.title}`).toBeGreaterThan(0);
      // The stages of the steps come first, in the steps' order, then the finishing.
      const steps = stages.map((s) => s.step).filter((n) => n !== undefined) as number[];
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      expect(new Set(steps).size).toBe(d.steps.length);
      // Seen step by step it is the same board: one stage a step, ending the same.
      expect(whole.filter((s) => s.step !== undefined)).toHaveLength(d.steps.length);
      expect(whole.at(-1)!.size).toEqual(stages.at(-1)!.size);
      // Gathering the stages already worked out gives the same as running it again step by step.
      expect(wholeSteps(d, stages).map((s) => [s.title, s.summary, s.size, s.warning])).toEqual(whole.map((s) => [s.title, s.summary, s.size, s.warning]));
      expect(stages.length).toBeGreaterThanOrEqual(whole.length);
    }
  });

  it('no instruction asks for milling and gluing, or milling and cutting, in one go', () => {
    for (const offer of catalog({ length: 16, width: 12, thickness: 1.5 })) {
      for (const s of run(offer.make(), (id) => id)) {
        const mills = /\bmill\b/i.test(s.summary);
        expect(mills && /\bglue\b/i.test(s.summary), `${offer.label}, ${s.title}: ${s.summary}`).toBe(false);
        expect(mills && /\bcross cut\b/i.test(s.summary), `${offer.label}, ${s.title}: ${s.summary}`).toBe(false);
      }
    }
  });

  it('accent strips are milled, then placed: the new strips lie beside the slices until they go in', () => {
    const d = plain('maple-purpleheart');
    const all = run(d, (id) => id);
    const at = all.findIndex((s) => s.step === d.steps.findIndex((st) => st.type === 'insert'));
    const [before, mill, place] = [all[at - 1], all[at], all[at + 1]];
    expect([mill.title, place.title]).toEqual(['Mill the accent strips', 'Insert accent strips']);
    expect(mill.slices).toHaveLength(before.slices.length);
    expect(mill.beside).toHaveLength(before.slices.length - 1);
    expect(mill.summary).toMatch(/^Mill \d+ purpleheart strips 1\/8″ × .* × .*\.$/);
    expect(mill.stock!.map((l) => [l.species, l.count])).toEqual([['purpleheart', before.slices.length - 1]]);
    expect(place.slices).toHaveLength(2 * before.slices.length - 1);
    expect(place.summary).toBe('Place one of the purpleheart strips after every slice.');
    expect(place.stock).toBeUndefined();
    expect(place.beside).toBeUndefined();
  });

  it('a border of single strips is milled, then its ends are glued on, then its sides', () => {
    const d = plain('edge-grain-border');
    const [mill, ends, sides] = stagesOf(d, 'frame');
    expect([mill.title, ends.title, sides.title]).toEqual(['Mill the border', 'Glue on the border ends', 'Glue on the border sides']);
    const [x, , z] = mill.size;
    // Milled, the board is as it was and the four pieces lie beside it.
    expect(mill.beside).toHaveLength(4);
    expect(mill.summary).toMatch(/^Mill four purpleheart border pieces .*: two .* long for the ends and two .* long for the sides\.$/);
    expect(mill.stock).toHaveLength(2);
    // The ends make it longer by two widths; the sides then make it wider, over the ends.
    expect(ends.size[0]).toBeCloseTo(x + 2, 9);
    expect(ends.size[2]).toBeCloseTo(z, 9);
    expect(sides.size[0]).toBeCloseTo(x + 2, 9);
    expect(sides.size[2]).toBeCloseTo(z + 2, 9);
    expect(ends.summary).toBe('Glue a border piece to each end of the board, flush with its long edges. Leave the border a hair proud of both faces.');
    expect(sides.summary).toBe('Glue a border piece along each long edge of the board, covering the ends of the two end pieces. Leave the border a hair proud of both faces.');
    expect(sides.frame).toBeUndefined();
    expect(sides.size).toEqual(runSteps(d)[d.steps.findIndex((s) => s.type === 'frame')].size);
  });

  it('an end-grain border is five operations: strips, two small panels, the pieces cut from them, ends, sides', () => {
    const d = plain('basket-weave');
    const stages = stagesOf(d, 'frame');
    expect(stages.map((s) => s.title)).toEqual(['Mill the border', 'Glue up the border panels', 'Cut the border pieces', 'Glue on the border ends', 'Glue on the border sides']);
    const [mill, panels, cut, ends] = stages;
    // The board waits untouched while the pieces are made beside it.
    expect(panels.size).toEqual(mill.size);
    expect(cut.size).toEqual(mill.size);
    expect(mill.beside!.length).toBeGreaterThan(2);
    expect(panels.beside).toHaveLength(2);
    expect(cut.beside).toHaveLength(4);
    expect(mill.summary).toMatch(/^The border is end grain like the board.* Mill walnut strips/);
    expect(panels.summary).toMatch(/^Glue the strips edge to edge into two panels/);
    expect(cut.summary).toMatch(/^Cross cut two slices .* from each panel .* stand them end grain up/);
    expect(ends.size[0]).toBeGreaterThan(mill.size[0]);
  });

  it('a second panel with faced planks is three: mill (the slices go aside), glue the faces on, glue up', () => {
    const d = plain('basket-weave');
    const stages = stagesOf(d, 'panel');
    expect(stages.map((s) => s.title)).toEqual(['Mill the second panel', 'Glue the faces on', 'Glue up']);
    expect(stages.every((s) => (s.aside?.length ?? 0) > 0)).toBe(true);
    expect(stages[0].summary).toMatch(/^Set the \d+ slices aside, in order\. Now a second panel: mill /);
    expect(stages[1].summary).toMatch(/^Glue a cherry face to both sides of each of the \d+ walnut planks\./);
    expect(stages[2].kind).toBe('panel');
  });

  it('a step that fails is one stage with the reason, however many operations it has', () => {
    const d = plain('edge-grain-border');
    const broken = { ...d, steps: d.steps.map((s) => (s.type === 'frame' ? { ...s, width: 0 } : s)) };
    const stages = stagesOf(broken, 'frame');
    expect(stages).toHaveLength(1);
    expect(stages[0].error).toBe('The border needs a width greater than zero.');
  });
});
