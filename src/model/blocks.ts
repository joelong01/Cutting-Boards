import { dimensionsOf, layupOf, withLayup } from './design';
import { roundTo } from './fractions';
import { faceNormal, sub, dot, translate, bbox } from './geometry';
import { newId } from './ids';
import type { Design, Layup, Piece, Step, StripSpec, Vec3 } from './types';

/**
 * The 3D board (tumbling blocks). Seen from above it is diamonds in three woods, three round
 * every point, which read as stacked cubes. No row of straight cuts through a striped panel makes
 * that, so its strips are not square: each is ripped on the table saw with the blade tilted 30°,
 * which leaves a diamond (60° rhombus) cross-section. Three strips, one of each wood, glue into a
 * hexagonal log. The logs are cross cut into short pieces, the pieces are stood on end, and they
 * pack like honeycomb into a block whose top is the pattern, end grain up.
 *
 * The recipe is ordinary steps: rip the strips, glue up, cross cut, turn to end grain, glue up,
 * trim, flatten. The actions know a 3D board by the `block` its stages carry.
 *
 * That is the board with end grain on top. With face grain on top it is the same pattern made
 * from flat strips by ordinary steps, with no special actions at all: see blocksFlat.ts. The
 * grain switch moves between the two recipes.
 */

const SIN60 = Math.sqrt(3) / 2;

/** The longest strip the fit asks for: past this it rips more strips and not longer ones. */
const MAX_STRIP = 30;

/** Space left between the logs as they lie on the bench, drawn side by side. */
const LOG_GAP = 0.5;

/** The side of a diamond ripped from a board that thick: every side of it, and of the hexagon three make. */
export const blockSide = (thickness: number) => thickness / SIN60;

/** Whether a design is a 3D board: its strips are ripped to a diamond and glued into logs. */
export const isBlocks = (design: Pick<Design, 'steps'>) => !!layupOf(design).blocks;

/** How the pieces of a 3D board are counted and where the board is sawn out of the block they make. */
export interface BlockLayout {
  /** The side of every diamond. */
  side: number;
  /** Pieces in each row, along the board, and rows across it. */
  along: number;
  across: number;
  /** What comes off each side of the ragged block to leave the target: both ends, then both long edges. */
  trim: { x0: number; x1: number; z0: number; z1: number };
}

/**
 * The fewest pieces that cover a board `length` by `width`, from boards `thickness` thick, and the
 * trim that saws that board out of the middle of the block.
 *
 * A piece is a hexagon of side s with a point towards each long edge of the board: 2h wide along it
 * (h = s·sin 60°), and rows are 1.5 s apart with every other row moved over by h. The block's
 * edges are ragged. The part with wood all the way across runs from h in from one end to h in
 * from the other, and from s/2 in from one long edge to s/2 in from the other.
 */
export function blockLayout(length: number, width: number, thickness: number): BlockLayout {
  const side = blockSide(thickness), h = side * SIN60;
  const along = Math.max(2, Math.ceil((length / h + 1) / 2 - 1e-9));
  const across = Math.max(2, Math.ceil((width - side) / (1.5 * side) - 1e-9) + 1);
  const sizeX = (2 * along + 1) * h, sizeZ = (across - 1) * 1.5 * side + 2 * side;
  const x0 = h + ((2 * along - 1) * h - length) / 2;
  const z0 = side / 2 + ((across - 1) * 1.5 * side + side - width) / 2;
  return { side, along, across, trim: { x0, x1: sizeX - x0 - length, z0, z1: sizeZ - z0 - width } };
}

/** What every flattening in the recipe takes off the block's two faces in all, each pass rounded to `grid` as it is when it is done. */
const flattened = (steps: Step[], grid: number) => steps.reduce((t, s) => t + (s.type === 'flatten' ? roundTo(s.top, grid) + roundTo(s.bottom, grid) : 0), 0);

/**
 * An end-grain 3D board fitted to its target, which is all that fitting one means, since none of
 * its sizes can give way. From the target and the thickness of the boards its strips are ripped
 * from, which sets the size of its diamonds, it sets:
 *
 * - how many pieces the block has, along and across;
 * - the cross cut, to the target thickness plus what the flattening takes off;
 * - how many strips are ripped from each board and how long the boards are, so the logs cut
 *   into at least the pieces needed, with no board longer than 30 inches;
 * - the first Trim step, which saws the board out of the block.
 *
 * When the design rounds its sizes, the counting is done with the rounded ones, since those are
 * what the board is built from: a rounded kerf or cut must not leave the block a piece short.
 *
 * A design that is not an end-grain 3D board is returned as it is.
 */
export function reblock(design: Design): Design {
  const layup = layupOf(design);
  if (!layup.blocks || layup.blocks.flat) return design;
  const grid = dimensionsOf(design).rounding;
  const lay = blockLayout(design.target.length, design.target.width, roundTo(layup.thickness, grid));
  const trimAt = design.steps.findIndex((s) => s.type === 'trim');
  const cutAt = design.steps.findIndex((s) => s.type === 'crosscut');
  const cut = design.steps[cutAt];
  const kerf = roundTo(cut?.type === 'crosscut' ? Math.max(0, cut.kerf) : 0.125, grid);
  const thick = design.target.thickness + flattened(design.steps, grid);
  // The pieces as they are cut: the cut's width is rounded like everything else.
  const piece = roundTo(thick, grid);
  const need = lay.along * lay.across;
  const count = Math.ceil(need / Math.max(1, Math.floor((MAX_STRIP + kerf) / (piece + kerf))));
  // To the next quarter inch over what the cuts and their kerfs take, and a whole number of rounding steps.
  const quarter = Math.ceil((Math.ceil(need / count) * (piece + kerf) - kerf) * 4 - 1e-9) / 4;
  const steps = design.steps.map((s, i) => (
    // The bevel rip's width is only a record of the diamonds' side.
    s.type === 'rip' && s.tilt ? { ...s, width: lay.side }
      : i === trimAt && s.type === 'trim' ? { ...s, auto: false, ...lay.trim }
        : i === cutAt && s.type === 'crosscut' ? { ...s, width: thick, angle: 0 }
          : s));
  return withLayup({ ...design, steps }, {
    blocks: { along: lay.along, across: lay.across },
    repeat: count,
    length: grid > 0 ? Math.ceil(quarter / grid - 1e-9) * grid : quarter,
    strips: layup.strips.map((s) => ({ ...s, width: lay.side })),
    scale: undefined, along: undefined,
  });
}

/**
 * The strips and steps of an end-grain 3D board, at placeholder sizes that `reblock` then sets:
 * rip the boards into diamond strips, glue the strips into logs, cut them up, stand the pieces
 * on end and glue the block. `woods` are its three, one for each face of the cubes, and `height`
 * is the thickness of the boards, which is the height of a diamond.
 */
export function blockRecipe(woods: Pick<StripSpec, 'species'>[], height: number): { layup: Layup; steps: Step[] } {
  /** A step with a fresh id. */
  const step = <S extends Omit<Step, 'id'>>(st: S) => ({ ...st, id: newId() }) as unknown as Step;
  return {
    layup: {
      length: 26, thickness: height, repeat: 3, closeWithFirst: false,
      strips: woods.slice(0, 3).map((w) => ({ id: newId(), species: w.species, width: blockSide(height) })),
      blocks: { along: 2, across: 2 },
    },
    steps: [
      step({ type: 'rip', width: blockSide(height), kerf: 0.125, tilt: 30 }),
      step({ type: 'glue' }),
      step({ type: 'crosscut', width: 1.625, kerf: 0.125, angle: 0 }),
      step({ type: 'turn', sel: { mode: 'all' } }),
      step({ type: 'glue' }),
      step({ type: 'trim', auto: false, x0: 0, x1: 0, z0: 0, z1: 0 }),
      step({ type: 'flatten', top: 0.0625, bottom: 0.0625 }),
    ],
  };
}

/**
 * A piece with the outline `poly`, given as [a, b] corners in order, running from `lo` to `hi`
 * along the third direction. `place` turns (a, b, c) into a point, which is what lays the piece
 * down or stands it up. Every face is wound to point outward.
 */
function solid(poly: [number, number][], lo: number, hi: number, place: (a: number, b: number, c: number) => Vec3, species: string, grain: Vec3, tone: number): Piece {
  const at = (c: number): Vec3[] => poly.map(([a, b]) => place(a, b, c));
  const faces: Vec3[][] = [at(lo), at(hi)];
  poly.forEach(([a, b], i) => {
    const [a2, b2] = poly[(i + 1) % poly.length];
    faces.push([place(a, b, lo), place(a2, b2, lo), place(a2, b2, hi), place(a, b, hi)]);
  });
  const mid = place(poly.reduce((t, p) => t + p[0], 0) / poly.length, poly.reduce((t, p) => t + p[1], 0) / poly.length, (lo + hi) / 2);
  // Turn round any face whose normal points at the middle of the piece.
  return { species, grain, tone, faces: faces.map((f) => (dot(faceNormal(f), sub(f[0], mid)) < 0 ? [...f].reverse() : f)) };
}

/** A piece lying along the board: its outline is [z, y] and it runs along X. */
const lying = (z: number, y: number, x: number): Vec3 => [x, y, z];
/** A piece standing on end: its outline is [x, z] and it runs up Y. */
const standing = (x: number, z: number, y: number): Vec3 => [x, y, z];

/** Corner k of a hexagon of side s centred on (a, b), the first of them `turn` degrees round. */
const corner = (a: number, b: number, s: number, turn: number, k: number): [number, number] =>
  [a + s * Math.cos(((turn + 60 * k) * Math.PI) / 180), b + s * Math.sin(((turn + 60 * k) * Math.PI) / 180)];

/**
 * How wide a board must be to rip `count` diamond strips of side `side` from it with the blade
 * tilted 30°: the strips, a kerf for each (wider across the board than the blade is thick,
 * since it leans), and the corner lost to the first slanted cut, to the next quarter inch.
 */
export const boardWidth = (side: number, count: number, kerf = 0.125) => Math.ceil((side / 2 + count * (side + kerf / SIN60)) * 4 - 1e-9) / 4;

/** The boards an end-grain 3D board starts from: one of each wood, milled square, lying side by side. */
export function blockBoards(woods: string[], thickness: number, width: number, length: number, tone: (i: number) => number): Piece[] {
  return woods.map((wood, w) => solid([[w * width, 0], [(w + 1) * width, 0], [(w + 1) * width, thickness], [w * width, thickness]], 0, length, lying, wood, [1, 0, 0], tone(w)));
}

/**
 * The strips of a 3D board as they come off the saw: `logs` of each wood, lying side by side the
 * way they were ripped from the board, all the strips of the first wood, then the second, then
 * the third. Each is a diamond in cross-section: as wide on its faces as on its two sawn sides,
 * which slope at 60°.
 */
export function blockStrips(woods: string[], thickness: number, length: number, logs: number, tone: (i: number) => number): Piece[] {
  const s = blockSide(thickness);
  return woods.flatMap((wood, w) => Array.from({ length: logs }, (_, i) => {
    const z = (w * logs + i) * s;
    return solid([[z, 0], [z + s, 0], [z + 1.5 * s, thickness], [z + 0.5 * s, thickness]], 0, length, lying, wood, [1, 0, 0], tone(w * logs + i));
  }));
}

/**
 * The hexagonal logs of a 3D board, each three strips glued together, one of each wood in the
 * same order round every log. They lie side by side on the bench, each on one of its flats, with
 * a gap between them: they are not glued to each other.
 */
export function blockLogs(woods: string[], thickness: number, length: number, logs: number, tone: (i: number) => number): Piece[] {
  const s = blockSide(thickness);
  return Array.from({ length: logs }, (_, i) => {
    const cz = s + i * (2 * s + LOG_GAP);
    return woods.map((wood, f) => solid(
      [[cz, thickness], corner(cz, thickness, s, 0, 2 * f), corner(cz, thickness, s, 0, 2 * f + 1), corner(cz, thickness, s, 0, 2 * f + 2)],
      0, length, lying, wood, [1, 0, 0], tone(f * logs + i)));
  }).flat();
}

/**
 * The pieces of a 3D board's block, standing on end where they are glued: one list of pieces for
 * each row, the rows in order across the board. `woods` are the three woods, one for each face of
 * the cubes; every piece has them in the same order round it. `height` is how tall the pieces
 * stand. `tone` gives a strip its lightness from its number. The grain is upright: they are
 * lengths of log on end.
 */
export function blockRows(woods: string[], thickness: number, height: number, along: number, across: number, tone: (i: number) => number): Piece[][] {
  const s = blockSide(thickness), h = s * SIN60;
  const rows: Piece[][] = [];
  let n = 0;
  for (let j = 0; j < across; j++) {
    const row: Piece[] = [];
    for (let i = 0; i < along; i++) {
      const cx = i * 2 * h + (j % 2 ? h : 0), cz = j * 1.5 * s;
      for (let f = 0; f < 3; f++) {
        row.push(solid([[cx, cz], corner(cx, cz, s, 30, 2 * f), corner(cx, cz, s, 30, 2 * f + 1), corner(cx, cz, s, 30, 2 * f + 2)], 0, height, standing, woods[f % woods.length], [0, 1, 0], tone(n++)));
      }
    }
    rows.push(row);
  }
  const min = bbox(rows.flat()).min;
  return rows.map((row) => translate(row, [-min[0], -min[1], -min[2]]));
}
