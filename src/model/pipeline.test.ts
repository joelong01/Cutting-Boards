import { describe, expect, it } from 'vitest';
import { DEFAULT_FINISH, NO_FINISH, alignGroove, finishOf, patternLines, subtractConvex } from './finish';
import { bbox, box, clip, dot, faceNormal, volume } from './geometry';
import { formatLength, parseLength } from './fractions';
import { fitThickness, fitToTarget, withAutoFit } from './fit';
import { changeStrip } from './link';
import { buildCutList, DEFAULT_ALLOWANCE } from './cutlist';
import { autoName, isAutoNamed, withAutoName, woodsOf } from './naming';
import { PRESETS } from './presets';
import { BUILTIN_SPECIES } from './species';
import { layupOf, unfitted, withLayup } from './design';
import { pieceCount } from './pipeline';
import { run } from './test-helpers';
import type { Design, Piece, Stage, Vec3 } from './types';

/** Total wood volume in a stage. */
const vol = (s: Stage) => s.slices.reduce((v, sl) => v + sl.pieces.reduce((a, p) => a + volume(p), 0), 0);
/** A fresh copy of a starter design by key, with the groove and chamfer off so the board is a plain block. */
const preset = (key: string): Design => ({ ...PRESETS.find((p) => p.key === key)!.make(), finish: NO_FINISH });
/** The nth stage with a given title, so tests do not depend on how many steps come before it. */
const titled = (stages: Stage[], title: string, nth = 0) => stages.filter((s) => s.title === title)[nth];

describe('geometry', () => {
  it('clips a box with an angled plane and conserves volume', () => {
    const b = box([0, 0, 0], [2, 1, 3], 'maple', [1, 0, 0], 0);
    const n: [number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2];
    const a = clip(b, n, 1.5)!;
    const c = clip(b, [-n[0], 0, -n[2]], -1.5)!;
    expect(volume(b)).toBeCloseTo(6, 9);
    expect(volume(a) + volume(c)).toBeCloseTo(6, 9);
    expect(volume(a)).toBeGreaterThan(0);
  });
  it('returns the same piece when nothing is cut and null when all is cut', () => {
    const b = box([0, 0, 0], [1, 1, 1], 'maple', [1, 0, 0], 0);
    expect(clip(b, [1, 0, 0], 1)).toBe(b);
    expect(clip(b, [1, 0, 0], 0)).toBeNull();
  });
});

describe('fractions', () => {
  it('parses and formats shop fractions', () => {
    expect(parseLength('1 1/2')).toBe(1.5);
    expect(parseLength('1-1/8"')).toBe(1.125);
    expect(parseLength('3/4')).toBe(0.75);
    expect(parseLength('abc')).toBeNull();
    expect(formatLength(1.125)).toBe('1 1/8');
    expect(formatLength(0.0625)).toBe('1/16');
    expect(formatLength(12)).toBe('12');
  });
});

describe('presets', () => {
  it.each(PRESETS.map((p) => p.key))('%s runs without errors', (key) => {
    const stages = run(preset(key));
    for (const s of stages) expect(s.error, `${s.title}: ${s.error}`).toBeUndefined();
    const last = stages[stages.length - 1];
    expect(last.kind).toBe('panel');
    expect(vol(last)).toBeGreaterThan(10);
  });

  it('maple and purpleheart grid has the expected size and block count', () => {
    const stages = run(preset('maple-purpleheart'));
    // 10 x (1 + 1/8) + 1 = 12 1/4 wide; 20 / 1 3/8 -> 14 slices.
    expect(stages[0].size[2]).toBeCloseTo(12.25, 9);
    expect(titled(stages, 'Cross cut').slices.length).toBe(14);
    const last = stages[stages.length - 1];
    expect(last.size[0]).toBeCloseTo(14 * 1 + 13 * 0.125, 9);
    expect(last.size[1]).toBeCloseTo(1.125, 9);
    expect(last.size[2]).toBeCloseTo(12.25, 9);
    expect(pieceCount(last)).toBe(14 * 21 + 13);
  });

  it('edge grain with a border finishes 16 × 12 × 1 1/8 with one purpleheart border, long grain all round', () => {
    const d = preset('edge-grain-border');
    const stages = run(d);
    const last = stages[stages.length - 1];
    expect(last.size[0]).toBeCloseTo(16, 9);
    expect(last.size[1]).toBeCloseTo(1.125, 9);
    expect(last.size[2]).toBeCloseTo(12, 9);
    // Four border pieces and no line: the panel's 17 strips plus 4.
    const border = titled(stages, 'Add a border');
    expect(pieceCount(border) - pieceCount(titled(stages, 'Flatten'))).toBe(4);
    const pieces = border.slices[0].pieces.filter((p) => p.species === 'purpleheart');
    // Long grain on the face: no piece has its fibres standing up.
    for (const p of pieces) expect(Math.abs(p.grain[1])).toBeLessThan(1e-9);
    expect(d.name).toBe('Hard maple and purpleheart stripes with a border');
  });

  it('fitting to the target picks the shortest quarter-inch stock, not one a quarter longer', () => {
    // 14 1/2 stock trims to 14, and the border makes it exactly 16. A coarse search used to land
    // a hair above 14 1/2 and round up to 14 3/4, finishing at 16 1/4.
    const fitted = fitToTarget({ ...preset('edge-grain-border'), autoFit: true });
    expect(layupOf(fitted).length).toBe(14.5);
    expect(run(fitted).at(-1)!.size[0]).toBeCloseTo(16, 9);
  });

  it('turning to end grain makes the fibres vertical', () => {
    const stages = run(preset('checkerboard'));
    const g = titled(stages, 'Turn to end grain').slices[0].pieces[0].grain;
    expect(Math.abs(g[1])).toBeCloseTo(1, 9);
  });

  it('checkerboard alternates species along a row', () => {
    const last = run(preset('checkerboard')).at(-1)!;
    const at = (x: number, z: number) => last.slices[0].pieces.find((p) => {
      const b = bbox([p]);
      return x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2];
    })!.species;
    expect(at(0.5, 0.5)).not.toBe(at(2, 0.5));
    expect(at(0.5, 0.5)).not.toBe(at(0.5, 2));
    expect(at(0.5, 0.5)).toBe(at(2, 2));
  });

  it('gluing conserves volume and trimming the brick board leaves a solid rectangle', () => {
    const stages = run(preset('brick'));
    expect(vol(titled(stages, 'Glue up'))).toBeCloseTo(vol(titled(stages, 'Offset')), 6);
    const trimmed = titled(stages, 'Trim', 1);
    expect(trimmed.size[2]).toBeCloseTo(13, 9);
    expect(vol(trimmed)).toBeCloseTo(trimmed.size[0] * trimmed.size[1] * trimmed.size[2], 6);
  });

  it('chevron trims to a solid rectangle', () => {
    const last = run(preset('chevron')).at(-1)!;
    expect(vol(last)).toBeCloseTo(last.size[0] * last.size[1] * last.size[2], 5);
  });

  it('basket weave is solid', () => {
    const last = run(preset('basket-weave')).at(-1)!;
    expect(vol(last)).toBeCloseTo(last.size[0] * last.size[1] * last.size[2], 5);
  });
});

describe('fit to target', () => {
  it.each(PRESETS.map((p) => p.key))('%s can be resized to 18 x 12 x 1 1/2', (key) => {
    const target = { length: 18, width: 12, thickness: 1.5 };
    const d = fitThickness(fitToTarget({ ...preset(key), target }));
    const stages = run(d);
    for (const s of stages) expect(s.error, `${s.title}: ${s.error}`).toBeUndefined();
    const last = stages.at(-1)!;
    expect(last.size[1]).toBeCloseTo(1.5, 6);
    expect(Math.max(last.size[0], last.size[2])).toBeGreaterThanOrEqual(18 - 1e-9);
    expect(Math.min(last.size[0], last.size[2])).toBeGreaterThanOrEqual(12 - 1e-9);
  });

  it('brings the grid board to at least the target size', () => {
    const d = preset('maple-purpleheart');
    d.target = { length: 18, width: 14, thickness: 1.125 };
    const fitted = fitToTarget(d);
    const last = run(fitted).at(-1)!;
    expect(last.size[0]).toBeGreaterThanOrEqual(18 - 1e-9);
    expect(last.size[0]).toBeLessThan(19.2);
    expect(last.size[2]).toBeGreaterThanOrEqual(14 - 1e-9);
    expect(last.size[2]).toBeLessThan(15.2);
  });
});

describe('changing the wood, not the board', () => {
  /** Finished length (long side) and width (short side) of a design. */
  const finished = (d: Design) => {
    const last = run(d).at(-1)!;
    return { long: Math.max(last.size[0], last.size[2]), short: Math.min(last.size[0], last.size[2]), thick: last.size[1], last };
  };
  /** The grid board held at 16 x 12, as the app opens it. */
  const held = () => fitToTarget({ ...preset('maple-purpleheart'), target: { length: 16, width: 12, thickness: 1.125 }, autoFit: true });
  /** The same design with its first strip (the maple) set to a new width. */
  const widen = (d: Design, width: number): Design =>
    (withLayup(d, { strips: layupOf(d).strips.map((s, i) => (i === 0 ? { ...s, width } : s)) }));

  it('a wider strip changes the strip count, not the board', () => {
    const before = held();
    const after = withAutoFit(before, widen(before, 1.5));
    const f = finished(after);
    // One maple-plus-accent pair is 1 5/8 wide, so the board may overshoot 12 by less than that.
    expect(f.short).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(f.short).toBeLessThan(12 + 1.625);
    expect(f.long).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(f.long).toBeLessThan(16 + 1.125);
    expect(layupOf(after).repeat).toBeLessThan(layupOf(before).repeat);
  });

  it('without the hold, the same change makes the board bigger', () => {
    const before = { ...held(), autoFit: false };
    const grown = finished(withAutoFit(before, widen(before, 1.5)));
    expect(grown.short).toBeGreaterThan(finished(before).short + 3);
  });

  it.each([0.5, 0.75, 1.25, 2, 2.5])('strip width %s keeps the board within one block of 16 x 12', (width) => {
    const before = held();
    const f = finished(withAutoFit(before, widen(before, width)));
    expect(f.short).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(f.short).toBeLessThan(12 + width + 0.125);
    expect(f.long).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(f.long).toBeLessThan(16 + 1.125);
  });

  it('thicker stock changes how many slices are cut, not the board length', () => {
    const before = held();
    const after = withAutoFit(before, withLayup(before, { thickness: 1.625 }));
    const f = finished(after);
    // Each slice now adds 1 1/2 plus a 1/8 accent strip to the length.
    expect(f.long).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(f.long).toBeLessThan(16 + 1.625);
    expect(f.short).toBeCloseTo(finished(before).short, 9);
    expect(titled(run(after), 'Cross cut').slices.length).toBeLessThan(titled(run(before), 'Cross cut').slices.length);
  });

  it('a wider cross cut makes a thicker board of the same length and width', () => {
    const before = held();
    const after = withAutoFit(before, { ...before, steps: before.steps.map((s) => (s.type === 'crosscut' ? { ...s, width: 2 } : s)) });
    const a = finished(after), b = finished(before);
    expect(a.long).toBeCloseTo(b.long, 9);
    expect(a.short).toBeCloseTo(b.short, 9);
    expect(a.thick).toBeCloseTo(b.thick + 0.75, 9);
    expect(layupOf(after).length).toBeGreaterThan(layupOf(before).length);
  });

  it('the picture is drawn from the same stage whose size is reported', () => {
    const before = held();
    const after = withAutoFit(before, widen(before, 1.5));
    const { last } = finished(after);
    const b = bbox(last.slices.flatMap((s) => s.pieces));
    expect(b.max[0] - b.min[0]).toBeCloseTo(last.size[0], 9);
    expect(b.max[1] - b.min[1]).toBeCloseTo(last.size[1], 9);
    expect(b.max[2] - b.min[2]).toBeCloseTo(last.size[2], 9);
    expect(vol(last)).toBeCloseTo(last.size[0] * last.size[1] * last.size[2], 6);
  });

  it('renaming a design does not refit it', () => {
    const before = held();
    const renamed = { ...before, name: 'Another name' };
    expect(withAutoFit(before, renamed)).toBe(renamed);
  });

  it('changing the target resizes the board', () => {
    const before = held();
    const f = finished(withAutoFit(before, { ...before, target: { ...before.target, length: 20, width: 14 } }));
    expect(f.long).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(f.short).toBeGreaterThanOrEqual(14 - 1e-9);
  });
});

describe('accent strips follow the strip they match', () => {
  /** The inserted accent step of a design. */
  const insert = (d: Design) => d.steps.find((s) => s.type === 'insert') as Extract<Design['steps'][number], { type: 'insert' }>;
  /** Thicknesses of every purpleheart-like accent piece in the finished board, by direction. */
  const accentSizes = (d: Design, species: string) => {
    const last = run(d).at(-1)!;
    const along = new Set<number>(), across = new Set<number>();
    for (const p of last.slices[0].pieces) {
      if (p.species !== species) continue;
      const b = bbox([p]);
      const x = +(b.max[0] - b.min[0]).toFixed(6), z = +(b.max[2] - b.min[2]).toFixed(6);
      // An inserted strip runs the full width of the board; a first-glue-up strip is one block long.
      if (z > 5) along.add(x);
      else across.add(z);
    }
    return { inserted: [...along], strips: [...across] };
  };

  it('widening the accent strip widens the lines both ways', () => {
    const d = preset('maple-purpleheart');
    const { design, followed } = changeStrip(d, layupOf(d).strips[1].id, { width: 0.25 });
    expect(followed).toEqual({ species: false, width: true });
    expect(insert(design).thickness).toBe(0.25);
    expect(accentSizes(design, 'purpleheart')).toEqual({ inserted: [0.25], strips: [0.25] });
  });

  it('changing the accent wood changes the lines both ways', () => {
    const d = preset('maple-purpleheart');
    const { design, followed } = changeStrip(d, layupOf(d).strips[1].id, { species: 'walnut' });
    expect(followed).toEqual({ species: true, width: false });
    expect(accentSizes(design, 'purpleheart')).toEqual({ inserted: [], strips: [] });
    expect(accentSizes(design, 'walnut')).toEqual({ inserted: [0.125], strips: [0.125] });
  });

  it('changing the block strip leaves the accent strips alone', () => {
    const d = preset('maple-purpleheart');
    const { design, followed } = changeStrip(d, layupOf(d).strips[0].id, { width: 1.5 });
    expect(followed).toEqual({ species: false, width: false });
    expect(insert(design)).toEqual(insert(d));
  });

  it('an accent step set to another thickness on purpose is not overwritten', () => {
    const base = preset('maple-purpleheart');
    const d = { ...base, steps: base.steps.map((s) => (s.type === 'insert' ? { ...s, thickness: 0.5 } : s)) };
    const { design, followed } = changeStrip(d, layupOf(d).strips[1].id, { width: 0.25 });
    expect(followed.width).toBe(false);
    expect(insert(design).thickness).toBe(0.5);
  });

  it('the wood does not follow while another strip still uses the old wood', () => {
    const base = preset('maple-purpleheart');
    const d = withLayup(base, { strips: [...layupOf(base).strips, { id: 'extra', species: 'purpleheart', width: 0.5 }] });
    const { design, followed } = changeStrip(d, layupOf(d).strips[1].id, { species: 'walnut' });
    expect(followed.species).toBe(false);
    expect(insert(design).species).toBe('purpleheart');
  });
});

describe('room to flatten and mill', () => {
  it.each(PRESETS.map((p) => p.key))('%s flattens every glue-up before it is cut or finished', (key) => {
    for (const s of run(preset(key))) expect(s.warning, `${s.title}: ${s.warning}`).toBeUndefined();
  });

  it('the grid board mills strips 1 1/8 thick, flattens the panel to 1, and squares its ends', () => {
    const d = preset('maple-purpleheart');
    const stages = run(d);
    expect(stages[0].size[1]).toBeCloseTo(1.125, 9);
    expect(stages[0].stock![0].thickness).toBeCloseTo(1.125, 9);
    expect(titled(stages, 'Flatten').size[1]).toBeCloseTo(1, 9);
    expect(titled(stages, 'Trim').size[0]).toBeCloseTo(layupOf(d).length - 0.5, 9);
    // The last flattening takes the 1 1/4 slices down to the 1 1/8 board.
    expect(titled(stages, 'Flatten', 1).size[1]).toBeCloseTo(1.125, 9);
  });

  it('warns when a glue-up is cross cut with no flattening', () => {
    const base = preset('maple-purpleheart');
    const d = { ...base, steps: base.steps.filter((s, i) => !(s.type === 'flatten' && i === 2)) };
    expect(titled(run(d), 'Cross cut').warning).toMatch(/Flatten step/);
  });

  it('a warning on a step shows up in the order of operations', () => {
    const base = preset('maple-purpleheart');
    const d = { ...base, steps: base.steps.filter((s, i) => !(s.type === 'flatten' && i === 2)) };
    const cut = buildCutList(run(d), d).operations.find((o) => o.title === 'Cross cut')!;
    expect(cut.warning).toMatch(/Flatten step/);
    expect(buildCutList(run(base), base).operations.every((o) => !o.warning)).toBe(true);
  });

  it('warns when the finished board is never flattened', () => {
    const base = preset('checkerboard');
    const d = { ...base, steps: base.steps.slice(0, -1) };
    expect(run(d).at(-1)!.warning).toMatch(/never flattened/);
  });

  it('the cut list gives a rough size bigger than the glue-up size by the allowance', () => {
    const d = preset('maple-purpleheart');
    const list = buildCutList(run(d), d);
    for (const l of list.lines) {
      // A dimension too thin to mill is ripped to size and gets no allowance.
      expect(l.rough.thickness).toBeCloseTo(l.thickness + (l.thickness < 0.375 ? 0 : DEFAULT_ALLOWANCE.thickness), 9);
      expect(l.rough.width).toBeCloseTo(l.width + (l.width < 0.375 ? 0 : DEFAULT_ALLOWANCE.width), 9);
      expect(l.rough.length).toBeCloseTo(l.length + DEFAULT_ALLOWANCE.length, 9);
    }
    // The grid board needs its accent wood twice: lines one way in the first glue-up, the other way in the second.
    const accents = list.lines.filter((l) => l.species === 'purpleheart');
    expect(accents.map((l) => l.use)).toEqual(['First glue-up: runs the length of the panel', 'Second glue-up: between the cross-cut slices']);
    expect(accents.every((l) => l.ripped)).toBe(true);
    // Both read thickness x width x length with the thin dimension first, whichever way they lie in the glue-up.
    expect(accents.map((l) => [l.thickness, l.width])).toEqual([[0.125, 1.125], [0.125, 1.25]]);
    expect(accents.map((l) => l.rough.thickness)).toEqual([0.125, 0.125]);
    for (const l of list.lines) expect(l.thickness).toBeLessThanOrEqual(l.width);
    expect(list.lines.find((l) => l.species === 'maple')!.ripped).toBe(false);
    const bigger = buildCutList(run(d), { allowance: { thickness: 0.25, width: 0.25, length: 2 } });
    expect(bigger.totalBf).toBeGreaterThan(list.totalBf);
    expect(bigger.yield).toBeLessThan(list.yield);
    expect(list.yield).toBeLessThan(1);
  });
});

describe('finish: groove, chamfer, rounded corners and top edge', () => {
  /** Whether a point is inside a convex piece. */
  const inside = (p: Piece, pt: Vec3) => p.faces.every((f) => {
    const n = faceNormal(f);
    return dot(n, [pt[0] - f[0][0], pt[1] - f[0][1], pt[2] - f[0][2]]) <= 1e-9;
  });
  /** Whether there is wood at a point of a stage. */
  const wood = (s: Stage, pt: Vec3) => s.slices[0].pieces.some((p) => inside(p, pt));
  /** A starter design with the default finish: groove and chamfer both on. */
  const finished = (key: string): Design => ({ ...preset(key), finish: undefined });

  /** A starter design with only the named finishing options on, at their default sizes, the groove exactly where asked. */
  const only = (key: string, ...on: (keyof typeof NO_FINISH)[]): Design => {
    const finish = { ...NO_FINISH };
    for (const k of on) (finish as Record<string, unknown>)[k] = { ...DEFAULT_FINISH[k], on: true, ...(k === 'groove' ? { align: false } : {}) };
    return { ...preset(key), finish };
  };

  it('all four are on by default', () => {
    expect(finishOf({}).groove.on).toBe(true);
    expect(finishOf({}).chamfer.on).toBe(true);
    expect(finishOf({}).corners.on).toBe(true);
    expect(finishOf({}).roundover.on).toBe(true);
    expect(finishOf({ finish: undefined })).toEqual(DEFAULT_FINISH);
  });

  it.each(PRESETS.map((p) => p.key))('%s gets a Finish stage the same size, with a little less wood', (key) => {
    const stages = run(finished(key));
    const last = stages.at(-1)!, before = stages.at(-2)!;
    expect(last.title).toBe('Finish');
    expect(last.warning).toBeUndefined();
    expect(last.size).toEqual(before.size);
    expect(vol(last)).toBeLessThan(vol(before));
    expect(vol(last)).toBeGreaterThan(vol(before) * 0.85);
    for (const p of last.slices[0].pieces) expect(volume(p)).toBeGreaterThan(0);
  });

  it('the groove is cut where it should be and nowhere else', () => {
    const last = run(only('checkerboard', 'groove', 'chamfer', 'corners', 'roundover')).at(-1)!;
    const [X, T, Z] = last.size;
    const { inset, width, depth } = DEFAULT_FINISH.groove;
    const centre = inset + width / 2;
    // In the groove on all four sides, half way down it: air.
    expect(wood(last, [X / 2, T - depth / 2, centre])).toBe(false);
    expect(wood(last, [X / 2, T - depth / 2, Z - centre])).toBe(false);
    expect(wood(last, [centre, T - depth / 2, Z / 2])).toBe(false);
    expect(wood(last, [X - centre, T - depth / 2, Z / 2])).toBe(false);
    expect(wood(last, [centre, T - depth / 2, centre])).toBe(false);
    // Under the groove, between groove and edge, and in the middle of the board: wood.
    expect(wood(last, [X / 2, T - depth - 0.05, centre])).toBe(true);
    expect(wood(last, [X / 2, T - 0.01, inset / 2])).toBe(true);
    expect(wood(last, [X / 2, T - 0.01, Z / 2])).toBe(true);
    // The bottom is rounded: the corners of a square channel are still wood.
    expect(wood(last, [X / 2, T - depth + 0.01, inset + 0.02])).toBe(true);
  });

  it('a rail-guided groove has rounded outside corners and sharp inside ones', () => {
    const last = run(only('checkerboard', 'groove')).at(-1)!;
    const [, T] = last.size;
    const { inset, width } = DEFAULT_FINISH.groove;
    const a = width / 2, centre = inset + a, y = T - 0.01;
    // Where a square-cornered channel would reach but a round bit does not: wood.
    expect(wood(last, [centre - 0.9 * a, y, centre - 0.9 * a])).toBe(true);
    // Inside the bit's circle about the corner of its path: cut away.
    expect(wood(last, [centre - 0.6 * a, y, centre - 0.6 * a])).toBe(false);
    // The inside corner is sharp: cut right up to it, wood just past it.
    expect(wood(last, [centre + 0.9 * a, y, centre + 0.9 * a])).toBe(false);
    expect(wood(last, [centre + a + 0.02, y, centre + a + 0.02])).toBe(true);
  });

  it('a groove path with a corner radius sweeps round the corner', () => {
    const d = only('checkerboard', 'groove');
    const last = run({ ...d, finish: { ...d.finish!, groove: { ...d.finish!.groove, cornerRadius: 1 } } }).at(-1)!;
    const [, T] = last.size;
    const { inset, width, depth } = DEFAULT_FINISH.groove;
    const centre = inset + width / 2;
    const cx = centre + 1, cz = centre + 1;
    // On the path, half way round the corner: air. Where the square path's corner was: wood.
    expect(wood(last, [cx - Math.SQRT1_2, T - depth / 2, cz - Math.SQRT1_2])).toBe(false);
    expect(wood(last, [centre, T - 0.01, centre])).toBe(true);
    // The straight runs still meet the curve: just past each tangent point is air.
    expect(wood(last, [cx + 0.05, T - depth / 2, centre])).toBe(false);
    expect(wood(last, [centre, T - depth / 2, cz + 0.05])).toBe(false);
  });

  it('the groove removes the volume of its profile swept along its path', () => {
    const stages = run(only('checkerboard', 'groove'));
    const last = stages.at(-1)!, before = stages.at(-2)!;
    const [X, , Z] = last.size;
    const { inset, width, depth } = DEFAULT_FINISH.groove;
    const a = width / 2;
    // The five-facet profile has area sqrt(2) * a * depth, and the path is a rectangle. At each
    // corner the two runs overlap on the inside by a little more than the rounded outside adds,
    // so the total is just under profile times path, by less than a corner's worth each.
    const area = Math.SQRT2 * a * depth;
    const path = 2 * (X - 2 * inset - width) + 2 * (Z - 2 * inset - width);
    const removed = vol(before) - vol(last);
    expect(removed).toBeLessThan(area * path);
    expect(removed).toBeGreaterThan(area * path - 4 * a * a * depth);
  });

  it('the chamfer takes the bottom edges and leaves the top ones', () => {
    const last = run(finished('checkerboard')).at(-1)!;
    const [X, T, Z] = last.size;
    const c = DEFAULT_FINISH.chamfer.size;
    expect(wood(last, [c / 4, c / 4, Z / 2])).toBe(false);
    expect(wood(last, [X - c / 4, c / 4, Z / 2])).toBe(false);
    expect(wood(last, [X / 2, c / 4, c / 4])).toBe(false);
    expect(wood(last, [X / 2, c / 4, Z - c / 4])).toBe(false);
    expect(wood(last, [c, c, Z / 2])).toBe(true);
    expect(wood(last, [0.01, T / 2, Z / 2])).toBe(true);
  });

  it('a chamfer alone removes exactly four triangular strips, less their overlap at the corners', () => {
    const stages = run(only('checkerboard', 'chamfer'));
    const last = stages.at(-1)!, before = stages.at(-2)!;
    const [X, , Z] = last.size;
    const c = 0.25;
    // Two prisms along X, two along Z; each corner's overlap is a square pyramid of volume c^3 / 3.
    const removed = (c * c / 2) * (2 * X + 2 * Z) - 4 * (c ** 3 / 3);
    expect(vol(before) - vol(last)).toBeCloseTo(removed, 6);
  });

  it('turning everything off leaves no Finish stage', () => {
    expect(run(preset('checkerboard')).at(-1)!.title).not.toBe('Finish');
  });

  it('a groove that does not fit is skipped with a warning, and the chamfer still happens', () => {
    const d = { ...finished('checkerboard'), target: { length: 6, width: 3, thickness: 1.5 } };
    const last = run(fitToTarget(d)).at(-1)!;
    expect(last.title).toBe('Finish');
    expect(last.warning).toMatch(/juice groove/i);
    expect(wood(last, [last.size[0] / 2, last.size[1] - 0.05, 1])).toBe(true);
    expect(wood(last, [0.05, 0.05, last.size[2] / 2])).toBe(false);
  });

  it('rounded corners take the corner and nothing else', () => {
    const stages = run(only('checkerboard', 'corners'));
    const last = stages.at(-1)!, before = stages.at(-2)!;
    const [X, T, Z] = last.size;
    const r = DEFAULT_FINISH.corners.radius;
    for (const [x, z] of [[0, 0], [X, 0], [0, Z], [X, Z]]) {
      const inward = (v: number, far: number, by: number) => (v === 0 ? by : far - by);
      // Just inside the square corner: gone. On the diagonal near the arc's inner side: still wood.
      expect(wood(last, [inward(x, X, 0.1 * r), T / 2, inward(z, Z, 0.1 * r)])).toBe(false);
      expect(wood(last, [inward(x, X, 0.35 * r), T / 2, inward(z, Z, 0.35 * r)])).toBe(true);
    }
    expect(wood(last, [0.01, T / 2, Z / 2])).toBe(true);
    // Each corner loses its square less its quarter circle; flat facets sit a hair outside the curve.
    const exact = 4 * (r * r - (Math.PI * r * r) / 4) * T;
    const removed = vol(before) - vol(last);
    expect(removed).toBeLessThan(exact);
    expect(removed).toBeGreaterThan(exact * 0.95);
    expect(last.size).toEqual(before.size);
  });

  it('the roundover rounds the top edges and leaves the bottom square', () => {
    const stages = run(only('checkerboard', 'roundover'));
    const last = stages.at(-1)!, before = stages.at(-2)!;
    const [X, T, Z] = last.size;
    const ro = DEFAULT_FINISH.roundover.radius;
    expect(wood(last, [X / 2, T - 0.01, 0.01])).toBe(false);
    expect(wood(last, [0.01, T - 0.01, Z / 2])).toBe(false);
    expect(wood(last, [X / 2, T - 0.3 * ro, 0.3 * ro])).toBe(true);
    expect(wood(last, [X / 2, T - 0.001, ro + 0.01])).toBe(true);
    expect(wood(last, [X / 2, 0.01, 0.01])).toBe(true);
    // Each edge loses the square less the quarter circle, along its length.
    const exact = (ro * ro - (Math.PI * ro * ro) / 4) * (2 * X + 2 * Z);
    const removed = vol(before) - vol(last);
    expect(removed).toBeGreaterThan(exact * 0.8);
    expect(removed).toBeLessThan(exact * 1.05);
  });

  it('with rounded corners the chamfer and roundover follow the curve', () => {
    const last = run(only('checkerboard', 'corners', 'chamfer', 'roundover')).at(-1)!;
    const [, T] = last.size;
    const r = DEFAULT_FINISH.corners.radius;
    // A point on the corner diagonal, just inside the rounded side wall half way up.
    const edge = r - (r - 0.02) * Math.SQRT1_2;
    expect(wood(last, [edge, T / 2, edge])).toBe(true);
    // The same spot at the very top and the very bottom has been cut away by the edge work.
    expect(wood(last, [edge, T - 0.01, edge])).toBe(false);
    expect(wood(last, [edge, 0.01, edge])).toBe(false);
  });

  it('every finished piece is a sound solid and knows the block it came from', () => {
    for (const p of PRESETS) {
      const last = run({ ...p.make(), finish: undefined }).at(-1)!;
      for (const piece of last.slices[0].pieces) {
        expect(volume(piece)).toBeGreaterThan(0);
        expect(piece.origin!.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('subtracting a region conserves volume and returns an untouched piece as itself', () => {
    const b = box([0, 0, 0], [4, 1, 4], 'maple', [1, 0, 0], 0);
    // A 1 x 1 x 1 notch out of the middle of the top.
    const notch = [
      { n: [-1, 0, 0] as Vec3, d: -1.5 }, { n: [1, 0, 0] as Vec3, d: 2.5 },
      { n: [0, 0, -1] as Vec3, d: -1.5 }, { n: [0, 0, 1] as Vec3, d: 2.5 },
      { n: [0, -1, 0] as Vec3, d: 0 },
    ];
    const parts = subtractConvex(b, notch);
    expect(parts.reduce((v, p) => v + volume(p), 0)).toBeCloseTo(16 - 1, 9);
    for (const p of parts) expect(p.origin).toHaveLength(6);
    const far = box([10, 0, 10], [11, 1, 11], 'maple', [1, 0, 0], 0);
    expect(subtractConvex(far, notch)).toEqual([far]);
    expect(subtractConvex(far, notch)[0]).toBe(far);
  });

  it('end-grain flattening warns about the planer and long-grain flattening does not', () => {
    const stages = run(preset('checkerboard'));
    expect(titled(stages, 'Flatten', 0).summary).not.toMatch(/sacrificial/);
    expect(titled(stages, 'Flatten', 1).summary).toMatch(/sacrificial long-grain strip/);
  });
});

describe('lining the groove up with the pattern', () => {
  /** Whether a point is inside a convex piece. */
  const inside = (p: Piece, pt: Vec3) => p.faces.every((f) => {
    const n = faceNormal(f);
    return dot(n, [pt[0] - f[0][0], pt[1] - f[0][1], pt[2] - f[0][2]]) <= 1e-9;
  });
  /** Whether there is wood at a point of a stage. */
  const wood = (s: Stage, pt: Vec3) => s.slices[0].pieces.some((p) => inside(p, pt));
  /** A starter design finished with the groove only, aligning on. */
  const grooved = (d: Design): Design => ({ ...d, finish: { ...NO_FINISH, groove: { ...DEFAULT_FINISH.groove } } });
  /** Positions across the board (along Z, at mid length) where the groove has cut the top. */
  const cutAcross = (s: Stage) => {
    const [X, T, Z] = s.size;
    const cut: number[] = [];
    for (let z = 0.0125; z < Z; z += 0.025) if (!wood(s, [X / 2, T - 0.02, z])) cut.push(z);
    return cut;
  };

  it('finds the lines of a grid and none across a brick pattern', () => {
    const grid = run(preset('maple-purpleheart')).at(-1)!;
    const zs = patternLines(grid.slices[0].pieces, 2, grid.size[2], grid.size[0]);
    // Maple 1, purpleheart 1/8, repeating: lines at 0, 1, 1 1/8, 2 1/8, ...
    expect(zs.slice(0, 4)).toEqual([0, 1, 1.125, 2.125]);
    const brick = run(preset('brick')).at(-1)!;
    // Slices run straight across; the joints within each slice are staggered.
    expect(patternLines(brick.slices[0].pieces, 0, brick.size[0], brick.size[2]).length).toBeGreaterThan(4);
    expect(patternLines(brick.slices[0].pieces, 2, brick.size[2], brick.size[0])).toEqual([0, brick.size[2]]);
  });

  it('picks the middle of the nearest row or accent line that leaves a wall', () => {
    const lines = [0, 1.5, 1.625, 3.125, 3.25, 4.75];
    // Aiming at 1: the first row's middle, 3/4, is nearest and leaves a 1/2 wall.
    expect(alignGroove(lines, 1, 0.5, 0.375, true)).toBe(0.75);
    // Aiming at 1 1/2: the accent line's middle.
    expect(alignGroove(lines, 1.5, 0.5, 0.375, true)).toBe(1.5625);
    // A 1-inch outer row would leave only a 1/4 wall, so the accent line next to it is used.
    expect(alignGroove([0, 1, 1.125, 2.125, 3], 1, 0.5, 0.375, true)).toBe(1.0625);
    // Measured from the far edge.
    expect(alignGroove(lines, 3.75, 0.5, 0.375, false)).toBe(4);
    // Nothing to line up with nearby: stay where asked, do not jump to the middle of the board.
    expect(alignGroove([0, 12], 1, 0.5, 0.375, true)).toBe(1);
  });

  it('on 1 1/2 blocks the groove sits in the middle of the outer row, the same on both sides', () => {
    const base = preset('maple-purpleheart');
    // The right number of blocks for the board, at exactly the 1 1/2 asked for: the fit's narrowing
    // of them to land on the target is left off, since the numbers below are for 1 1/2 blocks.
    const d = unfitted(fitToTarget(changeStrip(base, layupOf(base).strips[0].id, { width: 1.5 }).design));
    const last = run(grooved(d)).at(-1)!;
    const cut = cutAcross(last);
    const Z = last.size[2];
    const low = cut.filter((z) => z < Z / 2), high = cut.filter((z) => z > Z / 2);
    // Centred on 3/4: cut from 1/2 to 1, with 1/2 of block left on each side of it.
    expect(Math.min(...low)).toBeCloseTo(0.5125, 2);
    expect(Math.max(...low)).toBeCloseTo(0.9875, 2);
    expect(Z - Math.max(...high)).toBeCloseTo(Math.min(...low), 6);
    expect(Z - Math.min(...high)).toBeCloseTo(Math.max(...low), 6);
  });

  it('with aligning off the groove goes exactly where asked', () => {
    const base = preset('maple-purpleheart');
    const d = fitToTarget(changeStrip(base, layupOf(base).strips[0].id, { width: 1.5 }).design);
    const g = grooved(d);
    const last = run({ ...g, finish: { ...g.finish!, groove: { ...g.finish!.groove, align: false } } }).at(-1)!;
    const low = cutAcross(last).filter((z) => z < last.size[2] / 2);
    expect(Math.min(...low)).toBeCloseTo(0.7625, 2);
    expect(Math.max(...low)).toBeCloseTo(1.2375, 2);
  });

  it('the instruction gives the distances the groove actually ended up at', () => {
    const last = run(grooved(preset('checkerboard'))).at(-1)!;
    // 1 1/2 blocks both ways: centred at 3/4, so the outer edge is 1/2 in all round.
    expect(last.summary).toMatch(/its outer edge 1\/2″ in from the edge of the board all round/);
  });

  it.each(PRESETS.map((p) => p.key))('%s still gets a groove with no warning when aligning', (key) => {
    const last = run(grooved(preset(key))).at(-1)!;
    expect(last.title).toBe('Finish');
    expect(last.warning).toBeUndefined();
    expect(vol(last)).toBeLessThan(vol(run(preset(key)).at(-1)!));
  });
});

describe('designs name themselves from their woods', () => {
  it('each starter design is named for its woods and pattern', () => {
    const names = Object.fromEntries(PRESETS.map((p) => [p.key, p.make().name]));
    expect(names).toEqual({
      'single-end-grain': 'Hard maple end grain',
      'single-edge-grain': 'Black walnut edge grain',
      'edge-grain-stripes': 'Hard maple, cherry and black walnut stripes',
      'edge-grain-border': 'Hard maple and purpleheart stripes with a border',
      'maple-purpleheart': 'Hard maple and purpleheart grid',
      checkerboard: 'Black walnut and hard maple checkerboard',
      brick: 'Hard maple brick',
      'basket-weave': 'Black walnut, hard maple and cherry basket weave',
      chevron: 'Four-wood chevron',
      'tumbling-blocks': 'Hard maple, black walnut and cherry 3D blocks',
    });
  });

  it('changing the accent wood renames the board', () => {
    const d = preset('maple-purpleheart');
    const changed = changeStrip(d, layupOf(d).strips[1].id, { species: 'walnut' }).design;
    expect(withAutoName(changed, BUILTIN_SPECIES).name).toBe('Hard maple and black walnut grid');
  });

  it('a board left over from before, still under its old starter name, is renamed too', () => {
    const d: Design = { ...preset('maple-purpleheart'), name: 'Maple blocks, purpleheart grid', style: undefined, autoName: undefined };
    expect(isAutoNamed(d)).toBe(true);
    const changed = changeStrip(d, layupOf(d).strips[1].id, { species: 'walnut' }).design;
    const renamed = withAutoName(changed, BUILTIN_SPECIES);
    expect(renamed.name).toBe('Hard maple and black walnut grid');
    expect(renamed.style).toBe('grid');
    expect(renamed.autoName).toBe(true);
  });

  it('a name the user typed is never changed', () => {
    const d: Design = { ...preset('maple-purpleheart'), name: "Pat's birthday board", autoName: false };
    const changed = changeStrip(d, layupOf(d).strips[1].id, { species: 'walnut' }).design;
    expect(withAutoName(changed, BUILTIN_SPECIES)).toBe(changed);
    const old: Design = { ...d, autoName: undefined, style: undefined };
    expect(isAutoNamed(old)).toBe(false);
  });

  it('lists woods most used first, with an insert-only accent wood last', () => {
    const d = preset('maple-purpleheart');
    const walnutInserts = { ...d, steps: d.steps.map((s) => (s.type === 'insert' ? { ...s, species: 'walnut' } : s)) };
    expect(woodsOf(walnutInserts)).toEqual(['maple', 'purpleheart', 'walnut']);
    expect(autoName(walnutInserts, BUILTIN_SPECIES)).toBe('Hard maple, purpleheart and black walnut grid');
  });

  it('nothing changes when the name is already right', () => {
    const d = PRESETS[0].make();
    expect(withAutoName(d, BUILTIN_SPECIES)).toBe(d);
  });
});

describe('adding a step in the middle of a recipe', () => {
  it('accent strips can go between the offset and the glue-up of a brick board', () => {
    const d = preset('brick');
    const at = d.steps.map((s) => s.type).lastIndexOf('glue');
    const withStrips: Design = {
      ...d,
      steps: [...d.steps.slice(0, at), { id: 'accent', type: 'insert', species: 'walnut', thickness: 0.125, every: 1 }, ...d.steps.slice(at)],
    };
    const stages = run(withStrips);
    for (const s of stages) expect(s.error, `${s.title}: ${s.error}`).toBeUndefined();
    const before = titled(run(d), 'Offset'), inserted = titled(stages, 'Insert accent strips');
    // One strip between each pair of slices, each as long as the staggered slices reach.
    expect(inserted.slices.length).toBe(2 * before.slices.length - 1);
    expect(inserted.stock![0].count).toBe(before.slices.length - 1);
    expect(inserted.stock![0].length).toBeCloseTo(before.size[2], 9);
    // The finished board is still a solid rectangle, longer by the strips, with walnut right across it.
    const last = stages.at(-1)!, plain = run(d).at(-1)!;
    expect(vol(last)).toBeCloseTo(last.size[0] * last.size[1] * last.size[2], 6);
    expect(last.size[0]).toBeCloseTo(plain.size[0] + (before.slices.length - 1) * 0.125, 9);
    expect(last.size[2]).toBeCloseTo(plain.size[2], 9);
    const walnut = last.slices[0].pieces.filter((p) => p.species === 'walnut');
    expect(walnut.length).toBe(before.slices.length - 1);
    for (const p of walnut) expect(bbox([p]).max[2] - bbox([p]).min[2]).toBeCloseTo(last.size[2], 9);
  });
});
