import { describe, expect, it } from 'vitest';
import { blockLayout, blockSide, boardWidth, isBlocks, reblock } from './blocks';
import { layupOf, withLayup } from './design';
import { fitThickness, fitToTarget } from './fit';
import { bbox, boxSize, faceNormal, volume } from './geometry';
import { convertGrain, grainOf, withGrain } from './grain';
import { run } from './pipeline';
import { PRESETS, designs } from './presets';
import { validateDesign } from './storage';
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

  it('is these steps, in order, one operation each, with no error or warning, and finishes at exactly its target size', () => {
    const stages = run(board());
    expect(stages.slice(0, 10).map((s) => `${s.title} (${s.kind})`)).toEqual([
      'Mill the boards (strips)', 'Bevel rip (strips)', 'Glue up (strips)', 'Glue up (panel)', 'Cross cut (slices)',
      'Turn to end grain (slices)', 'Offset (slices)', 'Glue up (panel)', 'Trim (panel)', 'Flatten (panel)',
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
    // Six logs across a 12 inch board, eight rows along its 16: six strips from each board, 14 inches long.
    expect(layup.blocks).toEqual({ along: 6, across: 8 });
    expect(layup.repeat).toBe(6);
    expect(layup.length).toBe(14);
    expect(boardWidth(blockSide(1.25), 6)).toBe(10.25);
    expect(boards.slices.map((s) => s.pieces[0].species)).toEqual(['maple', 'walnut', 'cherry']);
    for (const s of boards.slices) {
      const size = boxSize(bbox(s.pieces));
      expect(size[0]).toBeCloseTo(14, 9);
      expect(size[1]).toBeCloseTo(1.25, 9);
      expect(size[2]).toBeCloseTo(10.25, 9);
    }
    expect(boards.stock!.map((l) => [l.species, l.count, l.thickness, l.width, l.length])).toEqual([['maple', 1, 1.25, 10.25, 14], ['walnut', 1, 1.25, 10.25, 14], ['cherry', 1, 1.25, 10.25, 14]]);
    // The instruction is only this operation: nothing about the cuts to come.
    expect(boards.summary).toBe('Mill a board of each wood 1 1/4″ thick, 10 1/4″ wide and 14″ long: maple, walnut and cherry. '
      + 'Plane all three to the same thickness in one session.');
    expect(boards.summary).not.toMatch(/30°|diamond|strip/);
    expect(boards.title).toBe('Mill the boards');
  });

  it('then rips each board with the blade tilted 30°, a step of its own, into diamond strips', () => {
    const d = board();
    const strips = run(d, (id) => id)[1];
    expect(d.steps[1]).toMatchObject({ type: 'rip', tilt: 30 });
    expect(strips.title).toBe('Bevel rip');
    expect(strips.slices.map((s) => s.pieces[0].species)).toEqual([...Array(6).fill('maple'), ...Array(6).fill('walnut'), ...Array(6).fill('cherry')]);
    for (const s of strips.slices) {
      const [p] = s.pieces;
      const size = boxSize(bbox([p]));
      // As long as the boards, as thick as they were, and leaning over by half its width.
      expect(size[0]).toBeCloseTo(14, 9);
      expect(size[1]).toBeCloseTo(1.25, 9);
      expect(size[2]).toBeCloseTo(1.5 * blockSide(1.25), 9);
      expect(volume(p)).toBeCloseTo(stripVolume(1.25, 14), 6);
      expect(p.grain).toEqual([1, 0, 0]);
    }
    // The wood was counted when the boards were milled.
    expect(strips.stock).toBeUndefined();
    expect(strips.summary).toBe('Tilt the table saw blade 30° and rip 6 strips from each board, every one a diamond in cross-section: the two sawn faces slope at 60° and are as wide as the top and bottom, about 1 7/16″. '
      + 'Test the setup on scrap first: three strips must close into a hexagon with no gap.');
  });

  it('a 3D board saved before the bevel rip was a step of its own gets one when it is opened', () => {
    const d = board();
    // As the earlier version saved it: strips, then straight to gluing the logs.
    const old = JSON.parse(JSON.stringify({ ...d, steps: d.steps.filter((_, i) => i !== 1) }));
    expect(run(old)[1].error).toMatch(/ripped into strips first/);
    const opened = validateDesign(old);
    expect(opened.steps.map((s) => s.type)).toEqual(d.steps.map((s) => s.type));
    expect(opened.steps[1]).toMatchObject({ type: 'rip', tilt: 30 });
    expect(run(opened).filter((s) => s.error || s.warning)).toEqual([]);
    expect(run(opened).at(-1)!.size.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 1.5, 12]);
    // One that is current is left exactly as it is.
    expect(validateDesign(JSON.parse(JSON.stringify(d))).steps).toEqual(d.steps);
  });

  it('a face-grain 3D board saved as loose tiles is rebuilt from strips when it is opened', () => {
    const d = board();
    const old = JSON.parse(JSON.stringify({
      ...d,
      steps: [
        { ...d.steps[0], thickness: 1.625, blocks: { along: 7, across: 6, flat: true }, strips: layupOf(d).strips.map((s) => ({ ...s, width: 1.25 })) },
        { id: 'c', type: 'crosscut', width: 1.443, kerf: 0.125, angle: 30 }, { id: 'g', type: 'glue' },
        { id: 't', type: 'trim', auto: false, x0: 0, x1: 0, z0: 0, z1: 0 }, { id: 'f', type: 'flatten', top: 0.0625, bottom: 0.0625 },
      ],
    }));
    const opened = validateDesign(old);
    expect(layupOf(opened).strips.map((s) => s.species)).toEqual(['walnut', 'maple', 'cherry', 'maple']);
    expect(grainOf(opened)).toBe('edge');
    expect(run(opened).filter((s) => s.error || s.warning)).toEqual([]);
    expect(run(opened).at(-1)!.size.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 1.5, 12]);
  });

  it('will not glue the boards into logs before they are ripped', () => {
    const d = board();
    const skipped = { ...d, autoFit: false, steps: d.steps.filter((_, i) => i !== 1) };
    expect(run(skipped)[1].error).toBe('The boards are ripped into strips first. Add "Rip the panel" with the blade tilted before this.');
  });

  it('glues three strips into each log and the logs into one row, then cuts the row into slices: nothing smaller is handled', () => {
    const d = board();
    const [, , logs, row, cut, stood, slid] = run(d);
    const side = blockSide(1.25);
    // Six loose logs, each three diamonds as long as the strips, lying on a flat.
    expect(logs.kind).toBe('strips');
    expect(logs.slices.map((s) => s.pieces.length)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(logs.size[1]).toBeCloseTo(2.5, 9);
    expect(logs.summary).toMatch(/^Glue one strip of each wood into a hexagonal log, 6 logs,/);
    // The row: the six glued flat to flat, two diamond heights each, a point up and a point down.
    expect(row.kind).toBe('panel');
    expect(row.slices[0].pieces).toHaveLength(18);
    expect(row.size[0]).toBeCloseTo(14, 9);
    expect(row.size[1]).toBeCloseTo(2 * side, 9);
    expect(row.size[2]).toBeCloseTo(6 * 2.5, 9);
    for (const p of row.slices[0].pieces) expect(volume(p)).toBeCloseTo(stripVolume(1.25, 14), 6);
    expect(row.summary).toBe('Glue the 6 logs side by side into one row, flat face to flat face, every log the same way round. Clamp across the flats. The row is 15″ wide, with a zigzag top and bottom.');
    // Eight slices, each a whole row of the pattern in one piece: 8 things to handle, not 48.
    expect(cut.slices).toHaveLength(8);
    expect(cut.slices.every((s) => s.pieces.length === 18)).toBe(true);
    expect(cut.summary).toBe('Cross cut the row of logs into 8 slices 1 5/8″ long (kerf 1/8″). Use a stop block so they are all the same length.');
    // Stood on end they are as tall as they were cut long, with the fibres upright.
    expect(Math.max(...stood.slices.map((s) => boxSize(bbox(s.pieces))[1]))).toBeCloseTo(1.625, 9);
    for (const p of stood.slices[0].pieces) expect(Math.abs(p.grain[1])).toBeCloseTo(1, 9);
    expect(stood.summary).toBe('Stand every slice on end, so its row of hexagons is on top.');
    // Every other one slid half a log, which is the thickness of the boards.
    expect(slid.summary).toBe('Slide every 2nd slice, starting with slice 2, 1 1/4″ along its length (4 of the 8).');
  });

  it('glues the slices into a block with the points of each row in the hollows of the next: sound diamonds, no gap, no overlap', () => {
    const d = board();
    const stages = run(d);
    const block = stages[7];
    const pieces = block.slices[0].pieces;
    expect(pieces).toHaveLength(3 * 6 * 8);
    // Faces wound outward give every piece a positive volume: a diamond as tall as the slices were cut.
    for (const p of pieces) expect(volume(p)).toBeCloseTo(stripVolume(1.25, 1.625), 6);
    for (const p of pieces) expect(Math.abs(p.grain[1])).toBeCloseTo(1, 9);
    for (const p of pieces) for (const f of p.faces) expect(Math.hypot(...faceNormal(f))).toBeGreaterThan(1e-9);
    // Nested, the rows are three quarters of a hexagon apart: eight of them, and six and a half logs wide.
    const side = blockSide(1.25);
    expect(block.size[0]).toBeCloseTo(7 * 1.5 * side + 2 * side, 9);
    expect(block.size[2]).toBeCloseTo(6 * 2.5 + 1.25, 9);
    expect(block.block).toBeUndefined();
    expect(block.summary).toMatch(/^Glue the 8 slices together standing on end, in this order, the points of each fitted into the hollows of the next\./);
    // Trimmed, the top is wood all over: the area of the diamonds showing is the area of the board.
    const tops = topFaces(stages[8]);
    expect(tops.reduce((a, t) => a + area(t.face), 0)).toBeCloseTo(16 * 12, 6);
  });

  it('will not glue slices that have not been slid to nest, and says how far to slide them', () => {
    const d = board();
    const unslid = { ...d, autoFit: false, steps: d.steps.filter((s) => s.type !== 'shift') };
    const glued = run(unslid).find((s, i, all) => s.title === 'Glue up' && all[i - 1]?.title === 'Turn to end grain')!;
    expect(glued.error).toBe('The slices will not fit together as they lie. Slide every other one 1 1/4″ along its length first, half a log, so the points of one row fit the hollows of the next: add an Offset step before this.');
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

    it('works its stock length out directly, and it is the shortest that gives the slices: a quarter inch less is one slice short', () => {
      /** How many slices of a design's angled cut are full length. */
      const fullSlices = (d: Design) => {
        const lengths = run(d)[3].slices.map((s) => boxSize(bbox(s.pieces))[2]);
        return lengths.filter((l) => Math.max(...lengths) - l < 1e-6).length;
      };
      for (const target of [{ length: 16, width: 12, thickness: 1.5 }, { length: 20, width: 16, thickness: 2 }, { length: 12, width: 9, thickness: 0.75 }]) {
        const d = fitToTarget({ ...flat(), target });
        const columns = layupOf(d).blocks!.along;
        expect(fullSlices(d)).toBeGreaterThanOrEqual(columns);
        const shorter = withLayup({ ...d, autoFit: false }, { length: layupOf(d).length - 0.25 });
        expect(fullSlices(shorter)).toBeLessThan(columns);
      }
    });

    it('is not rounded: its sizes follow from the 60° of the diamonds', () => {
      const d = fitToTarget({ ...flat(), dimensions: { notation: 'fraction', rounding: 1 / 8, minWidth: 1 / 8 } });
      const size = run(d).at(-1)!.size;
      expect([size[0], size[1], size[2]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([16, 1.5, 12]);
    });
  });

  it('is fitted to another size by counting the logs and the rows again, not by changing a size', () => {
    const d = fitThickness(fitToTarget({ ...board(), target: { length: 20, width: 16, thickness: 2 } }));
    const stages = run(d);
    const size = stages.at(-1)!.size;
    expect(size[0]).toBeCloseTo(20, 9);
    expect(size[1]).toBeCloseTo(2, 9);
    expect(size[2]).toBeCloseTo(16, 9);
    expect(stages.filter((s) => s.error || s.warning)).toEqual([]);
    // Logs run across the board and rows along it.
    const lay = blockLayout(16, 20, 1.25);
    expect(layupOf(d).thickness).toBe(1.25);
    expect(layupOf(d).blocks).toEqual({ along: lay.along, across: lay.across });
    expect(layupOf(d).repeat).toBe(lay.along);
    // The cut is the board's thickness plus the flattening, and the row gives a slice for every row.
    const cut = d.steps.find((s) => s.type === 'crosscut')!;
    expect(cut.type === 'crosscut' && cut.width).toBeCloseTo(2.125, 9);
    expect(stages[4].slices).toHaveLength(lay.across);
    expect(layupOf(d).length).toBeCloseTo(Math.ceil((lay.across * 2.25 - 0.125) * 4) / 4, 9);
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

  it('leaves a design that is not a 3D board alone, and refuses one with fewer than three woods', () => {
    const plain = PRESETS.find((p) => p.key === 'maple-purpleheart')!.make();
    expect(reblock(plain)).toBe(plain);
    const two = withLayup(board(), { strips: layupOf(board()).strips.slice(0, 2) });
    expect(run(two)[0].error).toBe('A 3D board needs three woods, one for each face of its blocks.');
  });
});
