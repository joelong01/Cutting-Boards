import { describe, expect, it } from 'vitest';
import { NO_FINISH } from './finish';
import { fitThickness, fitToTarget } from './fit';
import { volume } from './geometry';
import { convertGrain, grainOf, withGrain, type Grain } from './grain';
import { PRESETS } from './presets';
import { run } from './pipeline';
import type { Design } from './types';

/** The other grain. */
const other = (g: Grain): Grain => (g === 'end' ? 'edge' : 'end');

/** Share of the finished top's pieces, by volume, whose fibres stand up: 1 for end grain, 0 for edge. */
function endShare(design: Design): number {
  const last = run({ ...design, finish: NO_FINISH }).at(-1)!;
  let up = 0, all = 0;
  for (const p of last.slices.flatMap((s) => s.pieces)) {
    const n = volume(p);
    all += n;
    if (Math.abs(p.grain[1]) > 0.9) up += n;
  }
  return up / all;
}

const SIZES = [
  { length: 12, width: 9, thickness: 0.75 },
  { length: 16, width: 12, thickness: 1.25 },
  { length: 18, width: 12, thickness: 1.5 },
  { length: 20, width: 16, thickness: 2 },
];

describe('the same pattern in the other grain', () => {
  it('knows which grain each starter design is', () => {
    for (const p of PRESETS) expect(grainOf(p.make()), p.key).toBe(p.type);
  });

  it('turns round every starter design but basket weave (several panels) and chevron (angled cuts)', () => {
    const turned = PRESETS.filter((p) => convertGrain(p.make(), other(p.type)) !== null).map((p) => p.key);
    expect(turned.sort()).toEqual(PRESETS.map((p) => p.key).filter((k) => k !== 'basket-weave' && k !== 'chevron').sort());
  });

  const cases = PRESETS.filter((p) => convertGrain(p.make(), other(p.type)))
    .flatMap((p) => SIZES.map((size) => [p.key, other(p.type), `${size.length} x ${size.width} x ${size.thickness}`, size] as const));

  it.each(cases)('%s as %s grain at %s builds, has that grain on top, and is the size asked for', (key, grain, _label, target) => {
    const base = PRESETS.find((p) => p.key === key)!.make();
    const d = fitThickness(fitToTarget({ ...convertGrain(base, grain)!, target }));
    expect(grainOf(d)).toBe(grain);
    const stages = run(d);
    for (const s of stages) expect(s.error, `${s.title}: ${s.error}`).toBeUndefined();
    const size = stages.at(-1)!.size;
    expect(Math.max(size[0], size[2])).toBeGreaterThanOrEqual(target.length - 1e-6);
    expect(Math.min(size[0], size[2])).toBeGreaterThanOrEqual(target.width - 1e-6);
    expect(Math.max(size[0], size[2])).toBeLessThan(target.length + 3);
    expect(Math.min(size[0], size[2])).toBeLessThan(target.width + 3.5);
    expect(size[1]).toBeCloseTo(target.thickness, 6);
    expect(endShare(d)).toBeCloseTo(grain === 'end' ? 1 : 0, 6);
  });

  it('an edge-grain grid keeps square blocks: the cross cut is as wide as the strips were thick', () => {
    const grid = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const d = convertGrain(grid, 'edge')!;
    expect(d.steps.some((s) => s.type === 'turn')).toBe(false);
    const cut = d.steps.find((s) => s.type === 'crosscut')!;
    // The end-grain grid's 1 1/8 stock less its 1/16 + 1/16 first flattening was the block's width.
    expect(cut.type === 'crosscut' && cut.width).toBeCloseTo(1, 9);
  });

  it('turning a design round and back gives the same recipe', () => {
    const grid = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    const back = convertGrain(convertGrain(grid, 'edge')!, 'end')!;
    expect(back.layup.thickness).toBeCloseTo(grid.layup.thickness, 9);
    expect(back.steps.map((s) => s.type)).toEqual(grid.steps.map((s) => s.type));
  });

  it('the grain switch turns an open board round and keeps it at its target size and thickness', () => {
    // The board on the phone: the purpleheart grid held at 18 × 12 × 1 1/2.
    const grid = fitThickness(fitToTarget({ ...PRESETS.find((p) => p.key === 'maple-purpleheart')!.make(), target: { length: 18, width: 12, thickness: 1.5 }, autoFit: true }));
    const edge = withGrain(grid, 'edge')!;
    expect(grainOf(edge)).toBe('edge');
    expect(edge.steps.some((s) => s.type === 'turn')).toBe(false);
    const size = run(edge).at(-1)!.size;
    expect(Math.max(size[0], size[2])).toBeGreaterThanOrEqual(18 - 1e-6);
    expect(Math.min(size[0], size[2])).toBeGreaterThanOrEqual(12 - 1e-6);
    expect(size[1]).toBeCloseTo(1.5, 6);
    expect(endShare(edge)).toBeCloseTo(0, 6);
    const back = withGrain(edge, 'end')!;
    expect(grainOf(back)).toBe('end');
    expect(run(back).at(-1)!.size[1]).toBeCloseTo(1.5, 6);
    expect(withGrain(grid, 'end')).toBe(grid);
    expect(withGrain(PRESETS.find((p) => p.key === 'chevron')!.make(), 'end')).toBeNull();
  });
});
