import { describe, expect, it } from 'vitest';
import { blockLayout, blockSide, boardWidth, isBlocks, reblock } from './blocks';
import { layupOf, withLayup } from './design';
import { fitThickness, fitToTarget } from './fit';
import { bbox, boxSize, faceNormal, volume } from './geometry';
import { convertGrain, grainOf, withGrain } from './grain';
import { run } from './pipeline';
import { PRESETS, designs } from './presets';
import type { Design, Piece, Stage } from './types';

/** The 3D board starter, as the lists of designs make it. */
const board = (): Design => PRESETS.find((p) => p.key === 'tumbling-blocks')!.make();

/** Area of a flat polygon in the X–Z plane. */
const area = (f: number[][]) => Math.abs(f.reduce((a, v, i) => a + v[0] * f[(i + 1) % f.length][2] - f[(i + 1) % f.length][0] * v[2], 0)) / 2;

/** The faces of a stage's pieces that lie in its top surface, with the wood each belongs to. */
function topFaces(stage: Stage): { species: string; face: number[][] }[] {
  const pieces: Piece[] = stage.slices.flatMap((s) => s.pieces);
  const top = Math.max(...pieces.flatMap((p) => p.faces.flat().map((v) => v[1])));
  return pieces.flatMap((p) => p.faces.filter((f) => f.every((v) => Math.abs(v[1] - top) < 1e-9)).map((face) => ({ species: p.species, face })));
}

/** A diamond's cross-section area times its length: what a strip ripped from a board that thick holds. */
const stripVolume = (thickness: number, length: number) => blockSide(thickness) * thickness * length;

describe('3D board (tumbling blocks)', () => {
  it('is offered once in the lists of designs, as "3D Board"', () => {
    expect(designs().filter((p) => p.label === '3D Board').map((p) => p.key)).toEqual(['tumbling-blocks']);
    expect(isBlocks(board())).toBe(true);
  });

  it('is these steps, in order, with no error or warning, and finishes at exactly its target size', () => {
    const stages = run(board());
    expect(stages.slice(0, 8).map((s) => `${s.title} (${s.kind})`)).toEqual([
      'Rip the strips (strips)', 'Bevel rip (strips)', 'Glue up (panel)', 'Cross cut (slices)', 'Turn to end grain (slices)', 'Glue up (panel)', 'Trim (panel)', 'Flatten (panel)',
    ]);
    expect(stages.filter((s) => s.error || s.warning).map((s) => `${s.title}: ${s.error ?? s.warning}`)).toEqual([]);
    const size = stages.at(-1)!.size;
    expect(size[0]).toBeCloseTo(16, 9);
    expect(size[1]).toBeCloseTo(1.5, 9);
    expect(size[2]).toBeCloseTo(12, 9);
  });

  it('starts with one square board of each wood, wide enough to rip its strips from', () => {
    const d = board();
    const boards = run(d, (id) => id)[0];
    const layup = layupOf(d);
    expect(layup.repeat).toBe(3);
    expect(layup.length).toBe(24.5);
    expect(boardWidth(blockSide(1.25), 3)).toBe(5.5);
    expect(boards.slices.map((s) => s.pieces[0].species)).toEqual(['maple', 'walnut', 'cherry']);
    for (const s of boards.slices) {
      const size = boxSize(bbox(s.pieces));
      expect(size[0]).toBeCloseTo(24.5, 9);
      expect(size[1]).toBeCloseTo(1.25, 9);
      expect(size[2]).toBeCloseTo(5.5, 9);
    }
    expect(boards.stock!.map((l) => [l.species, l.count, l.thickness, l.width, l.length])).toEqual([['maple', 1, 1.25, 5.5, 24.5], ['walnut', 1, 1.25, 5.5, 24.5], ['cherry', 1, 1.25, 5.5, 24.5]]);
    expect(boards.summary).toBe('Mill a board of each wood 1 1/4″ thick, 5 1/2″ wide and 24 1/2″ long: maple, walnut and cherry. '
      + 'Plane all three to the same thickness in one session: it sets the size of the diamonds.');
  });

  it('then rips each board with the blade tilted 30°, a step of its own, into diamond strips', () => {
    const d = board();
    const strips = run(d, (id) => id)[1];
    expect(d.steps[1]).toMatchObject({ type: 'rip', tilt: 30 });
    expect(strips.title).toBe('Bevel rip');
    expect(strips.slices.map((s) => s.pieces[0].species)).toEqual(['maple', 'maple', 'maple', 'walnut', 'walnut', 'walnut', 'cherry', 'cherry', 'cherry']);
    for (const s of strips.slices) {
      const [p] = s.pieces;
      const size = boxSize(bbox([p]));
      // As long as the boards, as thick as they were, and leaning over by half its width.
      expect(size[0]).toBeCloseTo(24.5, 9);
      expect(size[1]).toBeCloseTo(1.25, 9);
      expect(size[2]).toBeCloseTo(1.5 * blockSide(1.25), 9);
      expect(volume(p)).toBeCloseTo(stripVolume(1.25, 24.5), 6);
      expect(p.grain).toEqual([1, 0, 0]);
    }
    // The wood was counted when the boards were milled.
    expect(strips.stock).toBeUndefined();
    expect(strips.summary).toBe('Tilt the table saw blade 30° and rip 3 strips from each board, every one a diamond in cross-section: the two sawn faces slope at 60° and are as wide as the top and bottom, about 1 7/16″. '
      + 'Test the setup on scrap first: three strips must close into a hexagon with no gap.');
  });

  it('will not glue the boards into logs before they are ripped', () => {
    const d = board();
    const skipped = { ...d, autoFit: false, steps: d.steps.filter((_, i) => i !== 1) };
    expect(run(skipped)[1].error).toBe('The boards are ripped into strips first. Add "Rip the panel" with the blade tilted before this.');
  });

  it('glues three strips into each hexagonal log, then cuts the logs into the pieces of the block', () => {
    const d = board();
    const [, , logs, cut, stood] = run(d);
    // Three logs, each three diamonds as long as the strips, lying on a flat: twice the board's thickness tall.
    expect(logs.slices[0].pieces).toHaveLength(9);
    expect(logs.size[0]).toBeCloseTo(24.5, 9);
    expect(logs.size[1]).toBeCloseTo(2.5, 9);
    for (const p of logs.slices[0].pieces) expect(volume(p)).toBeCloseTo(stripVolume(1.25, 24.5), 6);
    expect(logs.summary).toMatch(/^Glue one strip of each wood into a hexagonal log, 3 logs,/);
    // 14 cuts of 1 5/8 through three logs: the 42 pieces the block needs.
    expect(cut.slices).toHaveLength(14);
    expect(cut.slices.every((s) => s.pieces.length === 9)).toBe(true);
    expect(cut.summary).toBe('Cross cut each log into 14 pieces 1 5/8″ long, 42 in all (kerf 1/8″). Use a stop block so they are all the same length.');
    // Stood on end they are as tall as they were cut long, with the fibres upright.
    expect(Math.max(...stood.slices.map((s) => boxSize(bbox(s.pieces))[1]))).toBeCloseTo(1.625, 9);
    for (const p of stood.slices[0].pieces) expect(Math.abs(p.grain[1])).toBeCloseTo(1, 9);
    expect(stood.summary).toBe('Stand every piece on end, so its hexagon of three woods is on top.');
  });

  it('glues the pieces into a block of sound diamonds, all standing on end', () => {
    const d = board();
    const block = run(d)[5];
    const pieces = block.slices[0].pieces;
    const { along, across } = layupOf(d).blocks!;
    expect(pieces).toHaveLength(3 * along * across);
    // Faces wound outward give every piece a positive volume: a diamond as tall as the pieces were cut.
    for (const p of pieces) expect(volume(p)).toBeCloseTo(stripVolume(1.25, 1.625), 6);
    for (const p of pieces) expect(p.grain).toEqual([0, 1, 0]);
    for (const p of pieces) for (const f of p.faces) expect(Math.hypot(...faceNormal(f))).toBeGreaterThan(1e-9);
    expect(block.block).toBeUndefined();
    expect(block.summary).toMatch(new RegExp(`^Glue the pieces standing on end into a block, ${across} rows of ${along}:`));
  });

  it('shows end grain, covers the whole top, and gives the three woods a third of it each', () => {
    const d = board();
    const stages = run({ ...d, finish: { corners: { on: false, radius: 0 }, chamfer: { on: false, size: 0 }, roundover: { on: false, radius: 0 }, groove: { on: false, inset: 1, width: 0.5, depth: 0.25, cornerRadius: 1, align: false } } });
    const tops = topFaces(stages.at(-1)!);
    const by = new Map<string, number>();
    for (const t of tops) by.set(t.species, (by.get(t.species) ?? 0) + area(t.face));
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(16 * 12, 6);
    expect([...by.keys()].sort()).toEqual(['cherry', 'maple', 'walnut']);
    for (const a of by.values()) expect(Math.abs(a / total - 1 / 3)).toBeLessThan(0.05);
    expect(grainOf(d)).toBe('end');
    expect(convertGrain(d, 'end')).toBe(d);
  });

  describe('with face grain on top: the same design made from strips', () => {
    /** The 3D board switched to edge grain, as the grain switch leaves it. */
    const flat = (): Design => withGrain(board(), 'edge')!;
    /** The stages of a design without its finishing. */
    const plain = (d: Design) => run({ ...d, finish: { corners: { on: false, radius: 0 }, chamfer: { on: false, size: 0 }, roundover: { on: false, radius: 0 }, groove: { on: false, inset: 1, width: 0.5, depth: 0.25, cornerRadius: 1, align: false } } });

    it('is reached by the grain switch, keeps its woods, size and diamonds, and switches back', () => {
      const d = flat();
      expect(grainOf(d)).toBe('edge');
      expect(d.style).toBe('3D blocks');
      expect(layupOf(d).blocks).toMatchObject({ flat: true });
      // Left face, top, right face, top: the faces as wide as the boards were thick, the top about half.
      expect(layupOf(d).strips.map((s) => s.species)).toEqual(['walnut', 'maple', 'cherry', 'maple']);
      expect(layupOf(d).strips[0].width).toBe(1.25);
      expect(layupOf(d).strips[2].width).toBe(1.25);
      expect(layupOf(d).strips[1].width).toBeCloseTo((blockSide(1.25) / 2 + 0.125) * (Math.sqrt(3) / 2), 9);
      expect(d.finish).toEqual(board().finish);
      const back = withGrain(d, 'end')!;
      expect(grainOf(back)).toBe('end');
      expect(layupOf(back).thickness).toBe(1.25);
      expect(layupOf(back).strips.map((s) => s.species)).toEqual(['maple', 'walnut', 'cherry']);
      expect(layupOf(back).blocks).toEqual(layupOf(board()).blocks);
      expect(back.steps.map((s) => s.type)).toEqual(board().steps.map((s) => s.type));
    });

    it('is ordinary steps on ordinary strips, one operation each, with no error or warning', () => {
      const stages = run(flat());
      expect(stages.slice(0, 14).map((s) => s.title)).toEqual([
        'Rip the strips', 'Glue up', 'Flatten', 'Cross cut', 'Flip', 'Offset', 'Glue up', 'Flatten', 'Trim', 'Rip the panel', 'Flip', 'Glue up', 'Trim', 'Flatten',
      ]);
      expect(stages.filter((s) => s.error || s.warning).map((s) => `${s.title}: ${s.error ?? s.warning}`)).toEqual([]);
      expect(stages.every((s) => !s.block)).toBe(true);
      expect(stages.every((s) => s.summary.length > 0)).toBe(true);
      // The cut that matters is described by what it runs along, not only by a measurement.
      expect(stages[9].summary).toContain('each one runs along the middle of a zigzag band of the top wood');
      expect(stages[3].summary).toContain('with the blade at 30° to square');
    });

    it('finishes at exactly its target size, flat grain up, a third of the top to each wood', () => {
      const d = flat();
      const last = plain(d).at(-1)!;
      expect(last.size[0]).toBeCloseTo(16, 9);
      expect(last.size[1]).toBeCloseTo(1.5, 9);
      expect(last.size[2]).toBeCloseTo(12, 9);
      const by = new Map<string, number>();
      for (const t of topFaces(last)) by.set(t.species, (by.get(t.species) ?? 0) + area(t.face));
      const total = [...by.values()].reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(16 * 12, 6);
      for (const a of by.values()) expect(Math.abs(a / total - 1 / 3)).toBeLessThan(0.05);
      for (const p of last.slices[0].pieces) expect(Math.abs(p.grain[1])).toBeLessThan(1e-9);
    });

    it('makes true diamonds of the top wood: each rip leaves half-diamonds that meet the next strip\'s as whole ones', () => {
      const d = flat();
      const stages = plain(d);
      const side = blockSide(1.25);
      // Before the last trim, the top wood is in right triangles, a quarter of a diamond each: one
      // from each of two slices makes a half-diamond, and the halves meet across the glue line.
      // Its sides are half the diamond's short diagonal, half its long one, and its side.
      const glued = stages[11];
      const tops = topFaces(glued).filter((t) => t.species === 'maple');
      const whole = tops.filter((t) => Math.abs(area(t.face) - (side * side * Math.sqrt(3)) / 8) < 1e-6);
      expect(whole.length).toBeGreaterThan(tops.length * 0.8);
      for (const t of whole) {
        const lengths = t.face.map((v, i) => Math.hypot(v[0] - t.face[(i + 1) % t.face.length][0], v[2] - t.face[(i + 1) % t.face.length][2])).sort((a, b) => a - b);
        expect(t.face).toHaveLength(3);
        expect(lengths[0]).toBeCloseTo(side / 2, 6);
        expect(lengths[1]).toBeCloseTo((side * Math.sqrt(3)) / 2, 6);
        expect(lengths[2]).toBeCloseTo(side, 6);
      }
      // And the face woods are whole diamond-sided parallelograms, never cut by the rip.
      const faces = topFaces(glued).filter((t) => t.species !== 'maple' && Math.abs(area(t.face) - side * side * (Math.sqrt(3) / 2)) < 1e-6);
      expect(faces.length).toBeGreaterThan(8 * 10 * 0.8);
    });

    it('uses only the full-length slices of the angled cut, and holds its size when the strips are wider', () => {
      const d = flat();
      const stages = run(d);
      const lengths = stages[3].slices.map((s) => boxSize(bbox(s.pieces))[2]);
      const full = lengths.filter((l) => Math.max(...lengths) - l < 1e-6).length;
      expect(full).toBeGreaterThanOrEqual(layupOf(d).blocks!.along);
      // The trim before the rip takes the short end slices off: what is left is the slices in use.
      expect(stages[8].size[0]).toBeCloseTo(layupOf(d).blocks!.along * 1.25, 9);
      const wider = fitToTarget(withLayup(d, { strips: layupOf(d).strips.map((s, i) => (i % 2 ? s : { ...s, width: 1.75 })) }));
      const size = run(wider).at(-1)!.size;
      expect([size[0], size[1], size[2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 1.5, 12]);
      expect(run(wider).filter((s) => s.error || s.warning)).toEqual([]);
    });

    it('is not rounded: its sizes follow from the 60° of the diamonds', () => {
      const d = fitToTarget({ ...flat(), dimensions: { notation: 'fraction', rounding: 1 / 8, minWidth: 1 / 8 } });
      const size = run(d).at(-1)!.size;
      expect([size[0], size[1], size[2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 1.5, 12]);
    });
  });

  it('is fitted to another size by counting the pieces and the strips again, not by changing a size', () => {
    const d = fitThickness(fitToTarget({ ...board(), target: { length: 20, width: 16, thickness: 2 } }));
    const stages = run(d);
    const size = stages.at(-1)!.size;
    expect(size[0]).toBeCloseTo(20, 9);
    expect(size[1]).toBeCloseTo(2, 9);
    expect(size[2]).toBeCloseTo(16, 9);
    expect(stages.filter((s) => s.error || s.warning)).toEqual([]);
    const lay = blockLayout(20, 16, 1.25);
    expect(layupOf(d).thickness).toBe(1.25);
    expect(layupOf(d).blocks).toEqual({ along: lay.along, across: lay.across });
    expect(layupOf(d).length).toBeLessThanOrEqual(30);
    // The cut is the board's thickness plus the flattening, and the logs give at least the pieces needed.
    const cut = d.steps.find((s) => s.type === 'crosscut')!;
    expect(cut.type === 'crosscut' && cut.width).toBeCloseTo(2.125, 9);
    expect(stages[3].slices.length * layupOf(d).repeat).toBeGreaterThanOrEqual(lay.along * lay.across);
  });

  it('keeps its size when the strips are ripped from thicker boards: bigger blocks, fewer pieces', () => {
    const before = board();
    const after = fitToTarget(withLayup(before, { thickness: 1.75 }));
    const size = run(after).at(-1)!.size;
    expect([size[0], size[2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 12]);
    const n = (d: Design) => layupOf(d).blocks!.along * layupOf(d).blocks!.across;
    expect(n(after)).toBeLessThan(n(before));
    expect(layupOf(after).strips.every((s) => Math.abs(s.width - blockSide(1.75)) < 1e-9)).toBe(true);
  });

  it('says so when the logs are too short to give the pieces the block needs', () => {
    const short = withLayup({ ...board(), autoFit: false }, { length: 12 });
    const glued = run(short)[5];
    expect(glued.error).toBe('The block needs 42 pieces and there are only 18. Make the strips longer or rip more of them.');
  });

  it('leaves a design that is not a 3D board alone, and refuses one with fewer than three woods', () => {
    const plain = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    expect(reblock(plain)).toBe(plain);
    const two = withLayup(board(), { strips: layupOf(board()).strips.slice(0, 2) });
    expect(run(two)[0].error).toBe('A 3D board needs three woods, one for each face of its blocks.');
  });
});
