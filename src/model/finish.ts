import { bbox, clip, dot, faceNormal, normalize, volume, type Box3 } from './geometry';
import { inches } from './fractions';
import type { Design, Finish, Piece, Plane, Stage, Vec3 } from './types';

/** The usual finishing touches at ordinary sizes, all on unless turned off. */
export const DEFAULT_FINISH: Finish = {
  groove: { on: true, inset: 0.75, width: 0.5, depth: 0.25, cornerRadius: 0, align: true },
  chamfer: { on: true, size: 0.25 },
  corners: { on: true, radius: 0.5 },
  roundover: { on: true, radius: 0.125 },
};

export const NO_FINISH: Finish = {
  groove: { ...DEFAULT_FINISH.groove, on: false },
  chamfer: { ...DEFAULT_FINISH.chamfer, on: false },
  corners: { ...DEFAULT_FINISH.corners, on: false },
  roundover: { ...DEFAULT_FINISH.roundover, on: false },
};

/** The finishing options of a design, with the defaults filled in for designs that predate them. */
export function finishOf(design: Pick<Design, 'finish'>): Finish {
  return {
    groove: { ...DEFAULT_FINISH.groove, ...design.finish?.groove },
    chamfer: { ...DEFAULT_FINISH.chamfer, ...design.finish?.chamfer },
    corners: { ...DEFAULT_FINISH.corners, ...design.finish?.corners },
    roundover: { ...DEFAULT_FINISH.roundover, ...design.finish?.roundover },
  };
}

/** The plane each face of a piece lies in, as unit normal and offset. */
export function planesOf(piece: Piece): Plane[] {
  return piece.faces.map((f) => {
    const n = normalize(faceNormal(f));
    return { n, d: dot(n, f[0]) };
  });
}

/**
 * Remove a convex region from a convex piece. The region is the set of points on the inner side
 * of every plane (n.p <= d). What is left is not convex, so it comes back as several convex
 * parts: for each plane in turn, the part of the remaining piece outside that plane is split off
 * and kept. A piece the region does not touch comes back as itself, the same object.
 *
 * Each part remembers the planes of the piece it was cut from, so the view can tell the block's
 * real edges from the seams this splitting adds.
 */
export function subtractConvex(piece: Piece, region: Plane[]): Piece[] {
  const parts: Piece[] = [];
  let rest: Piece | null = piece;
  for (const { n, d } of region) {
    if (!rest) break;
    const outside = clip(rest, [-n[0], -n[1], -n[2]], -d);
    if (outside === rest) {
      // Wholly outside this plane, so wholly outside the region.
      parts.push(rest);
      rest = null;
      break;
    }
    if (outside && volume(outside) > 1e-9) parts.push(outside);
    rest = clip(rest, n, d);
  }
  if (parts.length === 1 && parts[0] === piece) return parts;
  const origin = piece.origin ?? planesOf(piece);
  return parts.map((p) => ({ ...p, origin }));
}

const K = Math.SQRT1_2;
/** Flat facets used to draw a quarter circle, for the corners and for the rounded top edge. */
const CORNER_FACETS = 6;
const EDGE_FACETS = 3;
/** The furthest lining up may move a side of the groove from where it was asked for, in inches. */
const ALIGN_REACH = 1.25;
/** Wedges used to draw the groove where it turns a corner. */
const GROOVE_WEDGES = 5;

/** Cross-section of the groove: (offset across it, height relative to the top), left to right. */
function grooveProfile(width: number, depth: number): [number, number][] {
  const a = width / 2;
  return [[-a, 0], [-K * a, -K * depth], [0, -depth], [K * a, -K * depth], [a, 0]];
}

/**
 * The regions the groove removes where it turns one corner: what a round-bottomed bit cuts as its
 * centre swings a quarter turn of radius `pathRadius` about the upright axis through (cx, cz),
 * starting at angle `startDeg` (from +X toward +Z). The quarter turn is cut into wedges, each a
 * convex region bounded by its two upright planes through the axis and by the groove's profile
 * laid along the wedge's middle direction.
 *
 * With `pathRadius` zero the bit simply pivots on the corner of a square path, and the wedges
 * make the rounded outside corner a rail-guided router leaves.
 */
function grooveCorner(cx: number, cz: number, startDeg: number, pathRadius: number, top: number, width: number, depth: number): Plane[][] {
  const a = width / 2;
  const profile = grooveProfile(width, depth);
  const C: Vec3 = [cx, 0, cz];
  const wedges: Plane[][] = [];
  for (let k = 0; k < GROOVE_WEDGES; k++) {
    const t1 = ((startDeg + (k * 90) / GROOVE_WEDGES) * Math.PI) / 180;
    const t2 = ((startDeg + ((k + 1) * 90) / GROOVE_WEDGES) * Math.PI) / 180;
    const tm = (t1 + t2) / 2;
    const e: Vec3 = [Math.cos(tm), 0, Math.sin(tm)];
    /** The direction of increasing angle at angle t; a point is past that angle when its dot with this is positive. */
    const turn = (t: number): Vec3 => [-Math.sin(t), 0, Math.cos(t)];
    const s1 = turn(t1), s2 = turn(t2);
    const region: Plane[] = [
      { n: [-s1[0], 0, -s1[2]], d: -dot(s1, C) },
      { n: s2, d: dot(s2, C) },
      { n: [-e[0], 0, -e[2]], d: -(dot(e, C) + pathRadius - a) },
      { n: e, d: dot(e, C) + pathRadius + a },
    ];
    for (let i = 0; i < profile.length - 1; i++) {
      const [u1, y1] = profile[i], [u2, y2] = profile[i + 1];
      // Outward (downward) normal of this facet, in (distance from the axis, height), is (dy, -du).
      const n = normalize([e[0] * (y2 - y1), -(u2 - u1), e[2] * (y2 - y1)]);
      const point: Vec3 = [cx + e[0] * (pathRadius + u1), top + y1, cz + e[2] * (pathRadius + u1)];
      region.push({ n, d: dot(n, point) });
    }
    wedges.push(region);
  }
  return wedges;
}

/**
 * The region one straight run of juice groove removes: a channel with a rounded bottom, drawn
 * as five flat facets, open at the top. `axis` is the direction the run goes (0 = X, 2 = Z),
 * `centre` its position on the other axis, and `from`..`to` its extent along its own axis.
 * End planes come first so pieces beyond the ends are set aside whole and not split.
 */
function grooveRun(axis: 0 | 2, centre: number, from: number, to: number, top: number, width: number, depth: number): Plane[] {
  const across = axis === 0 ? 2 : 0;
  const a = width / 2;
  /** A plane from a normal given as (along the run, up, across the run). */
  const plane = (along: number, up: number, side: number, point: [number, number, number]): Plane => {
    const n: Vec3 = [0, up, 0];
    n[axis] = along;
    n[across] = side;
    const p: Vec3 = [0, point[1], 0];
    p[axis] = point[0];
    p[across] = point[2];
    const unit = normalize(n);
    return { n: unit, d: dot(unit, p) };
  };
  const profile = grooveProfile(width, depth);
  const region: Plane[] = [
    plane(-1, 0, 0, [from, top, centre]),
    plane(1, 0, 0, [to, top, centre]),
    plane(0, 0, -1, [from, top, centre - a]),
    plane(0, 0, 1, [from, top, centre + a]),
  ];
  for (let i = 0; i < profile.length - 1; i++) {
    const [u1, y1] = profile[i], [u2, y2] = profile[i + 1];
    // Outward (downward) normal of this facet in the cross-section is (dy, -du).
    region.push(plane(0, -(u2 - u1), y2 - y1, [from, top + y1, centre + u1]));
  }
  return region;
}

/**
 * Where the board's pattern has a line running the whole way across: the positions along `axis`
 * (0 = X, 2 = Z) of glue faces that are continuous over most of the board's other dimension,
 * together with the two edges of the board. Between two neighbours in this list lies one row of
 * blocks, or one accent strip. A pattern with no straight lines that way (brick joints, chevrons)
 * gives just the two edges.
 */
export function patternLines(pieces: Piece[], axis: 0 | 2, size: number, otherSize: number): number[] {
  const other = axis === 0 ? 2 : 0;
  const weight = new Map<number, number>();
  for (const p of pieces) {
    const b = bbox([p]);
    const span = b.max[other] - b.min[other];
    for (const at of [b.min[axis], b.max[axis]]) {
      const key = Math.round(at * 1e4);
      weight.set(key, (weight.get(key) ?? 0) + span);
    }
  }
  const lines = new Set<number>([0, Math.round(size * 1e4)]);
  // A glue face is counted from both sides, so a line right across the board weighs twice its length.
  for (const [key, w] of weight) if (w >= 1.2 * otherSize) lines.add(key);
  return [...lines].sort((a, b) => a - b).map((k) => k / 1e4);
}

/**
 * The best place, near `want`, for the centre line of a groove of the given width running along
 * one side of the board: the middle of a row of blocks or of an accent strip, so the groove sits
 * evenly on the pattern instead of shaving one side of a line. `lines` comes from patternLines;
 * `fromLowEdge` says which edge of the board this side of the groove is measured from. Places
 * that would leave less than `minWall` between the groove and that edge are not considered, and
 * nor are places more than ALIGN_REACH from where the groove was asked for: lining up is a nudge,
 * not a move across the board. Returns `want` unchanged when the pattern offers nothing nearby,
 * as on a board with no lines running that way.
 */
export function alignGroove(lines: number[], want: number, width: number, minWall: number, fromLowEdge: boolean): number {
  const size = lines[lines.length - 1];
  let best = want, bestGap = Infinity;
  for (let i = 0; i < lines.length - 1; i++) {
    const middle = (lines[i] + lines[i + 1]) / 2;
    const wall = (fromLowEdge ? middle : size - middle) - width / 2;
    if (wall < minWall - 1e-9) continue;
    const gap = Math.abs(middle - want);
    if (gap > ALIGN_REACH) continue;
    if (gap < bestGap - 1e-9) {
      best = middle;
      bestGap = gap;
    }
  }
  return best;
}

/** Whether two boxes overlap by more than a hair. */
function overlaps(a: Box3, min: Vec3, max: Vec3): boolean {
  for (let k = 0; k < 3; k++) if (a.max[k] <= min[k] + 1e-9 || a.min[k] >= max[k] - 1e-9) return false;
  return true;
}

/**
 * The upright planes that bound the board seen from above, as outward normal and offset: its four
 * sides and, when the corners are rounded, the flat facets that stand in for each quarter circle.
 * Edge treatments (chamfer, roundover) are then applied to every one of these, so they follow the
 * rounded corners instead of stopping at them.
 */
function sidePlanes(X: number, Z: number, cornerRadius: number): { sides: Plane[]; facets: Plane[] } {
  const sides: Plane[] = [
    { n: [-1, 0, 0], d: 0 },
    { n: [1, 0, 0], d: X },
    { n: [0, 0, -1], d: 0 },
    { n: [0, 0, 1], d: Z },
  ];
  const facets: Plane[] = [];
  if (cornerRadius > 0) {
    const r = cornerRadius;
    // Each corner: the circle's centre, and the angle (from +X toward +Z) its arc starts at.
    const corners: [number, number, number][] = [[X - r, Z - r, 0], [r, Z - r, 90], [r, r, 180], [X - r, r, 270]];
    for (const [cx, cz, start] of corners) {
      for (let i = 0; i < CORNER_FACETS; i++) {
        const t = ((start + ((i + 0.5) * 90) / CORNER_FACETS) * Math.PI) / 180;
        const n: Vec3 = [Math.cos(t), 0, Math.sin(t)];
        // Tangent to the circle, so the facets sit just outside the true curve.
        facets.push({ n, d: n[0] * cx + n[2] * cz + r });
      }
    }
  }
  return { sides, facets };
}

/**
 * The finished board: the last glued panel with its corners rounded, its bottom edges chamfered,
 * its top edges rounded over and a juice groove routed in the top, as the design's finishing
 * options ask. Curves are drawn as short flat facets. Returns null when there is nothing to do
 * (every option off, or the recipe does not end in a sound panel). An option that does not fit
 * the board is skipped and reported in the stage's warning, so the picture never shows a cut that
 * could not be made.
 *
 * Every piece is given its `origin` planes first, with the board's own six faces marked `outer`,
 * so the view can draw glue lines and block edges but not the facet lines of the curves.
 */
export function applyFinish(prev: Stage, finish: Finish): Stage | null {
  if (prev.kind !== 'panel' || prev.error) return null;
  if (!finish.groove.on && !finish.chamfer.on && !finish.corners.on && !finish.roundover.on) return null;
  const [X, T, Z] = prev.size;
  const done: string[] = [];
  const skipped: string[] = [];

  /** Whether a plane is one of the six faces of the whole board. */
  const isOuter = ({ n, d }: Plane) => {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(Math.abs(n[k]) - 1) > 1e-9) continue;
      const far = [X, T, Z][k];
      return n[k] < 0 ? Math.abs(d) < 1e-6 : Math.abs(d - far) < 1e-6;
    }
    return false;
  };
  let pieces: Piece[] = prev.slices[0].pieces.map((p) => ({
    ...p,
    origin: planesOf(p).map((pl) => ({ ...pl, outer: isOuter(pl) })),
  }));

  // ---- which edge work fits
  let r = 0;
  if (finish.corners.on) {
    if (!(finish.corners.radius > 0) || finish.corners.radius > Math.min(X, Z) / 2 - 0.25) {
      skipped.push(`Corners of ${inches(finish.corners.radius)} radius do not fit a board ${inches(Math.min(X, Z))} wide.`);
    } else {
      r = finish.corners.radius;
      done.push(`Round the four corners to a ${inches(r)} radius: mark them from a template, saw outside the line and sand to it.`);
    }
  }
  let c = 0;
  if (finish.chamfer.on) {
    if (!(finish.chamfer.size > 0) || finish.chamfer.size > T / 2 || finish.chamfer.size > Math.min(X, Z) / 4) {
      skipped.push(`A ${inches(finish.chamfer.size)} chamfer does not fit a board ${inches(T)} thick.`);
    } else {
      c = finish.chamfer.size;
      done.push(`Chamfer the bottom edges ${inches(c)} at 45° all the way round, so fingers can get under the board.`);
    }
  }
  let ro = 0;
  if (finish.roundover.on) {
    if (!(finish.roundover.radius > 0) || finish.roundover.radius > T - c - 1 / 16 || finish.roundover.radius > Math.min(X, Z) / 4) {
      skipped.push(`A ${inches(finish.roundover.radius)} roundover does not fit a board ${inches(T)} thick.`);
    } else {
      ro = finish.roundover.radius;
      done.push(`Round over the top edges all the way round with a ${inches(ro)} roundover bit.`);
    }
  }

  // ---- corners, chamfer and roundover are all plain cuts: keep the inner side of each plane
  const { sides, facets } = sidePlanes(X, Z, r);
  const cuts: Plane[] = [...facets];
  for (const { n: h, d: D } of [...sides, ...facets]) {
    if (c) {
      // Cut off everything closer than c to this side and to the bottom at once.
      cuts.push({ n: [h[0] * K, -K, h[2] * K], d: (D - c) * K });
    }
    for (let i = 0; ro && i < EDGE_FACETS; i++) {
      // Planes tangent to a quarter circle of radius ro tucked into the top edge of this side.
      const t = (((i + 0.5) * 90) / EDGE_FACETS) * (Math.PI / 180);
      const cos = Math.cos(t), sin = Math.sin(t);
      cuts.push({ n: [h[0] * cos, sin, h[2] * cos], d: cos * (D - ro) + sin * (T - ro) + ro });
    }
  }
  if (cuts.length) {
    // Only pieces near the rim can be touched; skip the middle of the board.
    const m = Math.max(r, c, ro) + 1e-6;
    pieces = pieces.flatMap((p) => {
      const b = bbox([p]);
      if (b.min[0] > m && b.max[0] < X - m && b.min[2] > m && b.max[2] < Z - m) return [p];
      let q: Piece | null = p;
      for (const cut of cuts) q = q && clip(q, cut.n, cut.d);
      return q && volume(q) > 1e-9 ? [q] : [];
    });
  }

  // ---- juice groove
  if (finish.groove.on) {
    const { inset, width, depth } = finish.groove;
    const a = width / 2;
    // The path of the centre of the bit: a rectangle, its corners turned at radius rc. Each side
    // starts `inset` in from its edge and, when aligning, moves to sit evenly on the pattern.
    let x0 = inset + a, x1 = X - inset - a, z0 = inset + a, z1 = Z - inset - a;
    if (finish.groove.align && width > 0) {
      const before = prev.slices[0].pieces;
      const minWall = Math.max(0.375, ro + 1 / 16);
      const xs = patternLines(before, 0, X, Z), zs = patternLines(before, 2, Z, X);
      x0 = alignGroove(xs, x0, width, minWall, true);
      x1 = alignGroove(xs, x1, width, minWall, false);
      z0 = alignGroove(zs, z0, width, minWall, true);
      z1 = alignGroove(zs, z1, width, minWall, false);
    }
    // Distance from each edge of the board to the groove's outer edge, as the jig must be set.
    const walls = { ends: [x0 - a, X - x1 - a], sides: [z0 - a, Z - z1 - a] };
    const wall = Math.min(...walls.ends, ...walls.sides);
    const room = Math.min(x1 - x0, z1 - z0) - width;
    const rc = Math.max(0, finish.groove.cornerRadius);
    if (!(width > 0) || !(depth > 0) || !(inset >= 0) || room < 2 || depth > T - 0.25 || depth > width || wall < ro) {
      skipped.push(room < 2
        ? `A juice groove ${inches(inset)} in from the edge leaves no room on a board ${inches(Math.min(X, Z))} wide.`
        : wall < ro
          ? `A juice groove ${inches(wall)} from the edge would cut into the ${inches(ro)} rounded edge.`
          : `A juice groove ${inches(depth)} deep does not fit: it must be no deeper than it is wide and leave 1/4″ of board under it.`);
    } else if (rc > Math.min(x1 - x0, z1 - z0) / 2) {
      skipped.push(`A juice groove with ${inches(rc)} corners does not fit: the corners would meet.`);
    } else {
      // Four straight runs between the corners, then the four corners, each a quarter turn.
      const regions: { region: Plane[]; min: Vec3; max: Vec3 }[] = [
        { region: grooveRun(0, z0, x0 + rc, x1 - rc, T, width, depth), min: [x0 + rc, T - depth, z0 - a], max: [x1 - rc, T, z0 + a] },
        { region: grooveRun(0, z1, x0 + rc, x1 - rc, T, width, depth), min: [x0 + rc, T - depth, z1 - a], max: [x1 - rc, T, z1 + a] },
        { region: grooveRun(2, x0, z0 + rc, z1 - rc, T, width, depth), min: [x0 - a, T - depth, z0 + rc], max: [x0 + a, T, z1 - rc] },
        { region: grooveRun(2, x1, z0 + rc, z1 - rc, T, width, depth), min: [x1 - a, T - depth, z0 + rc], max: [x1 + a, T, z1 - rc] },
      ];
      const reach = rc + a;
      const turns: [number, number, number][] = [[x1 - rc, z1 - rc, 0], [x0 + rc, z1 - rc, 90], [x0 + rc, z0 + rc, 180], [x1 - rc, z0 + rc, 270]];
      for (const [cx, cz, start] of turns) {
        for (const region of grooveCorner(cx, cz, start, rc, T, width, depth)) {
          regions.push({ region, min: [cx - reach, T - depth, cz - reach], max: [cx + reach, T, cz + reach] });
        }
      }
      for (const { region, min, max } of regions) {
        const out: Piece[] = [];
        for (const p of pieces) {
          if (!overlaps(bbox([p]), min, max)) out.push(p);
          else for (const part of subtractConvex(p, region)) out.push(part);
        }
        pieces = out;
      }
      /** One distance if both are the same, otherwise both, in the order low edge then high edge. */
      const pair = (v: number[]) => (Math.abs(v[0] - v[1]) < 1e-6 ? inches(v[0]) : `${inches(v[0])} and ${inches(v[1])}`);
      const even = Math.abs(walls.ends[0] - walls.ends[1]) < 1e-6 && Math.abs(walls.sides[0] - walls.sides[1]) < 1e-6
        && Math.abs(walls.ends[0] - walls.sides[0]) < 1e-6;
      done.push(`Rout a juice groove in the top with a ${inches(width)} round-bottomed bit, ${inches(depth)} deep, `
        + (even
          ? `its outer edge ${inches(walls.ends[0])} in from the edge of the board all round. `
          : `its outer edge ${pair(walls.ends)} in from the two ends and ${pair(walls.sides)} in from the two long sides. `)
        + (finish.groove.align ? 'Those distances put it evenly on the pattern. ' : '')
        + 'Use a jig or template and take several light passes of 1/16″ to 1/8″. '
        + (rc > 0
          ? `The centre of the bit turns each corner at a ${inches(rc)} radius.`
          : `Guided by straight rails, the bit leaves the groove's outside corners rounded to its own ${inches(a)} radius and the inside corners sharp.`));
    }
  }

  if (!done.length && !skipped.length) return null;
  return {
    kind: 'panel',
    slices: [{ pieces }],
    size: prev.size,
    title: 'Finish',
    summary: [...done, 'Sand through the grits and oil.'].join(' '),
    warning: skipped.length ? skipped.join(' ') : undefined,
  };
}
