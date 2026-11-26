import { blockRecipe, blockSide, reblock } from './blocks';
import { dimensionsOf, layupOf, withLayup } from './design';
import { NO_FINISH } from './finish';
import { roundTo } from './fractions';
import { bbox } from './geometry';
import { newId } from './ids';
import { runSteps } from './pipeline';
import type { Design, Piece, Step, StripSpec } from './types';

/**
 * The 3D board (tumbling blocks) with face grain on top, made entirely from strips: nothing
 * smaller than a slice of a panel is ever handled. See blocks.ts for the end-grain recipe.
 *
 * Call the three woods left, right and top, for the faces of the cubes. Then:
 *
 * 1. Rip flat strips, square: left and right `w` wide, top about half that. Glue them into one
 *    striped panel in the order left, top, right, top, repeated.
 * 2. Cross cut the panel 30° off square into slices `w` wide. In a slice the stripes slope, and
 *    a left or right stripe is a diamond-sided parallelogram: `s = w / sin 60°` on every side.
 * 3. Flip every other slice face down, which makes its stripes slope the other way, and slide it
 *    half a repeat along, which puts right beside left. Glue: a zigzag panel, where left and
 *    right meet in chevrons and the top wood runs between them in a zigzag band.
 * 4. Rip that panel into strips, each cut running along the middle of a top-wood band. A cut
 *    there leaves the band's two halves as rows of triangles, half-diamonds, on either side.
 * 5. Flip every other strip face down. The half-diamonds of one strip now meet those of the next
 *    as whole diamonds, each sitting on a left and a right face: the cubes.
 * 6. Trim to size and flatten.
 *
 * The top strips are milled wider than half by the rip's kerf (as it lies across the slope), so
 * that what the saw removes from the middle of each band is exactly the extra.
 *
 * Every step is an ordinary one. What is special is the fit (`fitFlatBlocks`): the sizes follow
 * from each other and from the target, and none can give way.
 */

const SIN60 = Math.sqrt(3) / 2;

/** The longest stock the fit will try before giving up. */
const MAX_STOCK = 96;

/** The width of the top-wood strips for diamonds of side `s` when the panel is ripped with a kerf `kerf` wide. */
const topWidth = (s: number, kerf: number) => (s / 2 + kerf) * SIN60;

/** A step with a fresh id. */
const step = <S extends Omit<Step, 'id'>>(st: S) => ({ ...st, id: newId() }) as unknown as Step;

/**
 * The steps of the face-grain 3D board, strips first, at sizes for `fitFlatBlocks` to set.
 * `woods` are its three woods in the order the end-grain recipe keeps them (top, left, right),
 * and `width` is how wide the left and right strips are ripped, which is the height of a diamond.
 */
export function flatRecipe(woods: Pick<StripSpec, 'species'>[], width: number): Step[] {
  const [top, left, right] = woods.map((w) => w.species);
  const s = blockSide(width), kerf = 0.125;
  const strips: StripSpec[] = [
    { id: newId(), species: left, width },
    { id: newId(), species: top, width: topWidth(s, kerf), locked: true },
    { id: newId(), species: right, width },
    { id: newId(), species: top, width: topWidth(s, kerf), locked: true },
  ];
  const everyOther = { mode: 'every', n: 2, offset: 1 } as const;
  const flatten = { type: 'flatten', top: 0.0625, bottom: 0.0625 } as const;
  return [
    { id: newId(), type: 'strips', strips, thickness: 1.75, length: 28, repeat: 5, closeWithFirst: false, blocks: { along: 2, across: 2, flat: true } },
    step({ type: 'glue' }),
    step(flatten),
    step({ type: 'crosscut', width, kerf, angle: 30 }),
    step({ type: 'flip', sel: everyOther, how: 'face' }),
    step({ type: 'shift', sel: everyOther, amount: 1.5 * s + kerf }),
    step({ type: 'glue' }),
    step(flatten),
    step({ type: 'trim', auto: false, x0: 0, x1: 0, z0: 0, z1: 0 }),
    step({ type: 'rip', width: 1.5 * s, kerf, note: 'Mark the cuts before sawing: each one runs along the middle of a zigzag band of the top wood, and that matters more than the measurement.' }),
    step({ type: 'flip', sel: everyOther, how: 'face' }),
    step({ type: 'glue' }),
    step({ type: 'trim', auto: false, x0: 0, x1: 0, z0: 0, z1: 0 }),
    step(flatten),
  ];
}

/** The same 3D board made the other way up, fitted to its target: the same woods, size, finish and diamonds, by the other recipe. */
export function turnedBlocks(design: Design, flat: boolean): Design {
  const layup = layupOf(design);
  if (!layup.blocks || !!layup.blocks.flat === flat) return design;
  if (flat) {
    // The boards' thickness was the height of a diamond; now the strips' width is.
    return fitFlatBlocks({ ...design, steps: flatRecipe(layup.strips, layup.thickness) });
  }
  const [left, top, right] = layup.strips;
  const recipe = blockRecipe([top, left, right], left.width);
  return reblock({ ...design, steps: [{ ...recipe.layup, id: newId(), type: 'strips' }, ...recipe.steps] });
}

/**
 * A 3D board as this version makes it. One saved before its recipes were split into single
 * operations is missing steps the engine now expects: an end-grain one has no bevel rip between
 * milling its boards and gluing the logs, and a face-grain one is the old recipe of loose tiles.
 * The first gets the rip put in; the second is rebuilt from strips with the same woods and
 * diamonds. Any other design, and a 3D board already current, is returned as it is.
 */
export function currentBlocks(design: Design): Design {
  const layup = layupOf(design);
  if (!layup.blocks) return design;
  if (layup.blocks.flat) {
    return layup.strips.length >= 4 ? design : fitFlatBlocks({ ...design, steps: flatRecipe(layup.strips, layup.strips[0]?.width ?? 1.25) });
  }
  if (design.steps.some((st) => st.type === 'rip' && st.tilt)) return design;
  const rip = blockRecipe(layup.strips, layup.thickness).steps[0];
  return reblock({ ...design, steps: [design.steps[0], rip, ...design.steps.slice(1)] });
}

/** The index of the n-th step of a type (0 for the first), or -1. */
const nth = (steps: Step[], type: Step['type'], n: number) => steps.map((s, i) => (s.type === type ? i : -1)).filter((i) => i >= 0)[n] ?? -1;

/** The stretch of Z that a set of pieces covers on the plane x = `x`. */
function spanAt(pieces: Piece[], x: number): { lo: number; hi: number } {
  const zs = pieces.flatMap((p) => p.faces.flat()).filter((v) => Math.abs(v[0] - x) < 1e-6).map((v) => v[2]);
  return { lo: Math.min(...zs), hi: Math.max(...zs) };
}

/** The pieces of a glued panel that came from slice number `k` of slices `width` wide. */
const column = (pieces: Piece[], k: number, width: number) => pieces.filter((p) => {
  const b = bbox([p]);
  return b.min[0] > k * width - 1e-6 && b.max[0] < (k + 1) * width + 1e-6;
});

/**
 * Where along the zigzag panel the rip cuts go: for each band of the top wood, the stretch that
 * the band covers at both edges of a slice, which is its middle and exactly a kerf wide. Read
 * from one slice of the glued panel, slice number `k`.
 */
function kerfZones(pieces: Piece[], top: string, k: number, width: number): { lo: number; hi: number }[] {
  const zones: { lo: number; hi: number }[] = [];
  for (const p of column(pieces, k, width)) {
    if (p.species !== top) continue;
    const a = spanAt([p], k * width), c = spanAt([p], (k + 1) * width);
    const zone = { lo: Math.max(a.lo, c.lo), hi: Math.min(a.hi, c.hi) };
    // A band cut off by the end of the slice is narrower at one edge and gives no true zone.
    if (zone.hi - zone.lo > 1e-6 && Math.abs((a.hi - a.lo) - (c.hi - c.lo)) < 1e-6) zones.push(zone);
  }
  return zones.sort((p, q) => p.lo - q.lo);
}

/**
 * The face-grain 3D board fitted to its target. The left and right strips' width is kept, and
 * everything else follows from it and the target:
 *
 * - the top strips' width, the cross cut, the slide and the rip, which make true diamonds;
 * - the strips' thickness, from the target thickness and the flattening;
 * - how many repeats of the strips and how long the stock, found by running the recipe: enough
 *   full-length slices to cover the target width (the slices from the two ends of an angled cut
 *   are short and are not used), and enough length in them for the rows the target length takes;
 * - the trim before the rip, which saws those short end slices off and puts the first cut on the
 *   middle of a top-wood band;
 * - the last trim, which saws the board out of the middle of the panel.
 *
 * Rounding is left off this board's own sizes (see `sizingOf`): they are fixed by the 60° of the
 * diamonds and are not round numbers. Returns the design unchanged if it is not this board, and
 * as near as it got if the stock would be absurdly long.
 */
export function fitFlatBlocks(design: Design): Design {
  const layup = layupOf(design);
  if (!layup.blocks?.flat || layup.strips.length < 4) return design;
  const steps = design.steps;
  const cutAt = nth(steps, 'crosscut', 0), shiftAt = nth(steps, 'shift', 0), ripAt = nth(steps, 'rip', 0);
  const glueAt = nth(steps, 'glue', 1), trimAt = nth(steps, 'trim', 0), lastTrimAt = nth(steps, 'trim', 1);
  if ([cutAt, shiftAt, ripAt, glueAt, trimAt, lastTrimAt].some((i) => i < 0)) return design;
  const grid = dimensionsOf(design).rounding;
  const width = layup.strips[0].width, s = blockSide(width);
  const rip = steps[ripAt] as Extract<Step, { type: 'rip' }>;
  const kerf = Math.max(0, dimensionsOf(design).kerf ?? rip.kerf), row = 1.5 * s;
  const thickness = design.target.thickness + steps.reduce((t, st) => t + (st.type === 'flatten' ? roundTo(st.top, grid) + roundTo(st.bottom, grid) : 0), 0);
  const rows = Math.max(2, Math.ceil(design.target.length / row - 1e-9));
  const columns = Math.max(2, Math.ceil(design.target.width / width - 1e-9));
  const strips = layup.strips.map((st, i) => ({ ...st, width: i % 2 ? topWidth(s, kerf) : width }));
  /** The design with these counts and every size that follows from the strips' width. */
  const sized = (repeat: number, length: number, trim: object, last: object): Design => withLayup({
    ...design,
    steps: steps.map((st, i) => (
      i === cutAt && st.type === 'crosscut' ? { ...st, width, angle: 30 }
        : i === shiftAt && st.type === 'shift' ? { ...st, amount: row + kerf }
          : i === ripAt && st.type === 'rip' ? { ...st, width: row }
            : i === trimAt && st.type === 'trim' ? { ...st, auto: false, x0: 0, x1: 0, z0: 0, z1: 0, ...trim }
              : i === lastTrimAt && st.type === 'trim' ? { ...st, auto: false, x0: 0, x1: 0, z0: 0, z1: 0, ...last }
                : st)),
  }, { strips, thickness, repeat, length, blocks: { along: columns, across: rows, flat: true }, scale: undefined, along: undefined });
  /** The stages of a trial design up to and including step `to`, without the finishing. */
  const upTo = (d: Design, to: number) => runSteps({ ...d, steps: d.steps.slice(0, to + 1), finish: NO_FINISH });
  const period = strips.reduce((t, st) => t + st.width, 0);
  const need = rows * row + (rows - 1) * kerf;
  /** Which slices of a cross cut are full length: the first and last of the run in the middle, or null if there are none. */
  const fullRun = (d: Design): { first: number; last: number; all: number } | null => {
    const cut = upTo(d, cutAt)[cutAt];
    if (!cut || cut.error) return null;
    const lengths = cut.slices.map((sl) => { const b = bbox(sl.pieces); return b.max[2] - b.min[2]; });
    const most = Math.max(...lengths);
    const full = lengths.map((l, i) => (most - l < 1e-6 ? i : -1)).filter((i) => i >= 0);
    return full.length ? { first: full[0], last: full[full.length - 1], all: lengths.length } : null;
  };
  let best = design;
  // Enough repeats for the slices to be as long as the rows need, with room for the slide and the slanted ends.
  for (let repeat = Math.max(1, Math.ceil(((need + row + kerf) * SIN60) / period)); repeat <= 60; repeat++) {
    // Long enough stock for the full slices the width takes. Turned 30° for the cut, the panel
    // is cut from one corner at a pitch of a slice and a kerf: the first full-length slice is the
    // first that starts past the slant of the near end (half the panel's width along the cut),
    // and the stock has to reach the far side of the last one in use. That is worked out here,
    // to the next quarter inch, and checked by running the cut; the loop only runs on if the
    // engine counts fewer, which keeps this from depending on the sum being exactly right.
    const pitch = width + kerf;
    const firstFull = Math.ceil((repeat * period * 0.5) / pitch - 1e-9);
    let length = Math.ceil((((firstFull + columns - 1) * pitch + width) / SIN60) * 4 - 1e-9) / 4;
    let trial = sized(repeat, length, {}, {});
    let full = fullRun(trial);
    while (length <= MAX_STOCK && (!full || full.last - full.first + 1 < columns)) {
      length += 0.25;
      trial = sized(repeat, length, {}, {});
      full = fullRun(trial);
    }
    if (!full || length > MAX_STOCK) return best;
    best = trial;
    const glued = upTo(trial, glueAt)[glueAt];
    if (!glued || glued.error) return best;
    const pieces = glued.slices[0].pieces;
    // The stretch every slice in use covers on both of its faces: outside it the panel is ragged.
    let lo = -Infinity, hi = Infinity;
    for (let k = full.first; k < full.first + columns; k++) {
      const a = spanAt(column(pieces, k, width), k * width), c = spanAt(column(pieces, k, width), (k + 1) * width);
      lo = Math.max(lo, a.lo, c.lo);
      hi = Math.min(hi, a.hi, c.hi);
    }
    // The panel's edge goes on the far side of a band's middle, so the first strip starts with clean half-diamonds.
    const start = kerfZones(pieces, strips[1].species, full.first, width).find((z) => z.hi >= lo - 1e-6);
    if (!start || start.hi + need > hi + 1e-6) continue;
    const crop = { x: (rows * row - design.target.length) / 2, z: (columns * width - design.target.width) / 2 };
    return sized(repeat, length,
      { x0: full.first * width, x1: (full.all - full.first - columns) * width, z0: start.hi, z1: glued.size[2] - start.hi - need },
      // After the rip the rows run along the board and the slices across it.
      { x0: crop.x, x1: crop.x, z0: crop.z, z1: crop.z });
  }
  return best;
}
