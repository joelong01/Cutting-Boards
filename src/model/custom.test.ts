import { describe, expect, it } from 'vitest';
import { layupOf, withLayup } from './design';
import { finishOf } from './finish';
import { fitToTarget } from './fit';
import { withGrain } from './grain';
import { newStep, run } from './pipeline';
import { catalog, customDesign, insertStep } from './presets';
import { inferBlocks, madeFrom, madeFromSteps } from './blocksFlat';
import type { Design, Step, StripSpec } from './types';

/**
 * What a card in the Design tab lets you set on a step of each type. Building a board from
 * Custom means adding a step and setting these, and nothing else. Every card also takes a note.
 */
const ON_THE_CARD: Record<Step['type'], string[]> = {
  strips: ['length', 'thickness', 'repeat', 'closeWithFirst', 'strips'],
  crosscut: ['width', 'kerf', 'angle', 'spacer'],
  rip: ['width', 'kerf', 'tilt'],
  turn: ['sel'],
  flip: ['sel', 'how'],
  shift: ['sel', 'amount'],
  insert: ['species', 'thickness', 'every', 'more', 'ends', 'pattern', 'offset', 'stagger'],
  glue: [],
  trim: ['auto', 'x0', 'x1', 'z0', 'z1'],
  flatten: ['top', 'bottom'],
  rotate: [],
  frame: ['species', 'width', 'lineSpecies', 'line', 'block'],
  panel: ['strips', 'thickness', 'extra', 'repeat', 'length'],
  combine: [],
};

/** What the first card lets you set on one strip. */
const ON_A_STRIP = ['species', 'width', 'spacer'];

/** The fields of `from` named in `names`, where it has them. */
const pick = (from: object, names: string[]) => Object.fromEntries(Object.entries(from).filter(([k]) => names.includes(k)));

/**
 * The sample rebuilt the way a person would: start from Custom at its size, set up its strips on
 * the first card, then add each of its steps in turn from the Add step menu and fill in its
 * card. Nothing says it is a 3D board: that is worked out from the steps as they go in. A custom board starts with a glue-up as its second step;
 * a sample that has something else there has it taken out, as its card's ✕ does.
 */
function rebuilt(sample: Design): Design {
  let d: Design = { ...customDesign(sample.target), autoFit: false, finish: sample.finish, dimensions: sample.dimensions };
  const first = layupOf(sample);
  d = withLayup(d, { ...pick(first, ON_THE_CARD.strips), strips: first.strips.map((s) => ({ id: s.id, ...pick(s, ON_A_STRIP) }) as StripSpec) });
  const keepsGlue = sample.steps[1]?.type === 'glue';
  if (!keepsGlue) d = { ...d, steps: d.steps.slice(0, 1) };
  for (let i = keepsGlue ? 2 : 1; i < sample.steps.length; i++) {
    const step = sample.steps[i];
    d = insertStep(d, i, { ...newStep(step.type), ...pick(step, [...ON_THE_CARD[step.type], 'note']) } as Step);
  }
  // Holding the size is a tick in the Dimensions tile, set last, as the sample has it.
  d = { ...d, autoFit: sample.autoFit };
  return sample.autoFit === false ? inferBlocks(d) : fitToTarget(d);
}

/** What a board comes to, for comparing two ways of making it: every stage's name, kind, size, pieces and instruction. */
const made = (d: Design) => run(d, (id) => id).map((s) => [s.title, s.kind, s.size.map((v) => +v.toFixed(6)), s.slices.reduce((n, sl) => n + sl.pieces.length, 0), s.summary, s.error ?? '', s.warning ?? '']);

describe('a custom board: start from the first two tiles and add the rest', () => {
  it('starts as strips and their glue-up and nothing more: no finishing, no feet, no pattern', () => {
    const d = customDesign({ length: 16, width: 12, thickness: 1.25 });
    expect(d.steps.map((s) => s.type)).toEqual(['strips', 'glue']);
    expect(d.target).toEqual({ length: 16, width: 12, thickness: 1.25 });
    expect(d.name).toBe('Custom board');
    expect(d.style).toBeUndefined();
    expect(madeFrom(d)).toBe('strips');
    const finish = finishOf(d);
    expect(Object.values(finish).every((f) => f.on === false)).toBe(true);
    const stages = run(d);
    expect(stages.map((s) => s.title)).toEqual(['Rip the strips', 'Glue up']);
    expect(stages.some((s) => s.error)).toBe(false);
  });

  const offers = catalog({ length: 16, width: 12, thickness: 1.5 });
  // Every design on offer, and the 3D board in its other grain as well, which is a recipe of its own.
  const samples: [string, Design][] = [
    ...offers.map((o) => [o.label, o.make()] as [string, Design]),
    ['3D Board, edge grain', withGrain(offers.find((o) => o.key === 'tumbling-blocks')!.make(), 'edge')!],
  ];

  it.each(samples)('%s can be built from Custom by adding its steps and filling in their cards', (_label, sample) => {
    const built = rebuilt(sample);
    expect(built.steps.map((s) => s.type)).toEqual(sample.steps.map((s) => s.type));
    expect(run(built).filter((s) => s.error).map((s) => s.error)).toEqual([]);
    expect(made(built)).toEqual(made(sample));
  });

  it('every sample uses only what its cards can set, apart from the numbers the fit works out', () => {
    const beyond: string[] = [];
    for (const [label, sample] of samples) {
      sample.steps.forEach((step, i) => {
        // `scale` and `along` are worked out by the fit, and `blocks` from the steps: none is typed.
        const known = [...ON_THE_CARD[step.type], 'id', 'type', 'note', 'scale', 'along', 'blocks'];
        for (const key of Object.keys(step)) if (!known.includes(key) && (step as Record<string, unknown>)[key] !== undefined) beyond.push(`${label}, step ${i + 1} (${step.type}): ${key}`);
        if (step.type === 'strips') {
          for (const s of step.strips) for (const key of Object.keys(s)) if (![...ON_A_STRIP, 'id'].includes(key)) beyond.push(`${label}, a strip: ${key}`);
        }
      });
    }
    expect(beyond).toEqual([]);
  });

  it('what the first step makes is worked out from the steps: a tilted rip straight after it means three boards', () => {
    const d = customDesign({ length: 16, width: 12, thickness: 1.5 });
    expect(madeFromSteps(d)).toBe('strips');
    // A square rip there is not one: the strips stay strips.
    const square = insertStep(d, 1, { ...newStep('rip') } as Step);
    expect(madeFromSteps(square)).toBe('strips');
    const tilted = inferBlocks(insertStep(d, 1, { ...newStep('rip'), tilt: 30 } as Step));
    expect(madeFrom(tilted)).toBe('boards');
    // It had one wood; a 3D board needs three, so they are made up.
    expect(layupOf(tilted).strips.map((s) => s.species)).toEqual(['maple', 'walnut', 'cherry']);
    expect(run(tilted)[0].title).toBe('Mill the boards');
    expect(run(tilted)[1].title).toBe('Bevel rip');
    // Take the tilt off again and it is strips once more.
    const back = inferBlocks({ ...tilted, steps: tilted.steps.map((s) => (s.type === 'rip' ? { ...s, tilt: undefined } : s)) });
    expect(madeFrom(back)).toBe('strips');
    expect(layupOf(back).blocks).toBeUndefined();
    expect(inferBlocks(d)).toBe(d);
  });

  it('every design on offer is recognised for what it is, so none needs to be told', () => {
    for (const [label, sample] of samples) {
      expect(madeFromSteps(sample), label).toBe(madeFrom(sample));
      expect(inferBlocks(sample), label).toBe(sample);
    }
    expect(samples.map(([, s]) => madeFrom(s)).filter((m) => m !== 'strips')).toEqual(['boards', 'flat']);
  });
});
