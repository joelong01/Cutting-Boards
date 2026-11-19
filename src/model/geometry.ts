import type { Piece, Vec3 } from './types';

export const EPS = 1e-7;

/** Sum of two vectors. */
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** Difference of two vectors, a minus b. */
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Vector multiplied by a number. */
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
/** Dot product: how far one vector reaches along the other. */
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Cross product: a vector square to both inputs, right-handed. */
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** Length of a vector. */
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
/** Same direction at length one; a zero vector stays zero rather than dividing by zero. */
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-12 ? [0, 0, 0] : scale(a, 1 / l);
};

/** Two unit vectors u, v with u x v = n. */
export function basisFor(n: Vec3): [Vec3, Vec3] {
  const h: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(n, h));
  return [u, cross(n, u)];
}

/** Unnormalised face normal by Newell's method; its length is twice the face area. */
export function faceNormal(f: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

/** Build a rectangular piece between two corners, with every face wound to point outward. */
export function box(min: Vec3, max: Vec3, species: string, grain: Vec3, tone: number): Piece {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  return {
    species, grain, tone,
    faces: [
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
      [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    ],
  };
}

/** Volume of a piece, by summing signed tetrahedra from the origin to each face triangle. */
export function volume(p: Piece): number {
  let v = 0;
  for (const f of p.faces) {
    for (let i = 1; i < f.length - 1; i++) v += dot(f[0], cross(f[i], f[i + 1]));
  }
  return v / 6;
}

/**
 * Keep the part of a convex piece where n.p <= d. Returns the same object when nothing is cut,
 * null when nothing is left.
 */
export function clip(p: Piece, n: Vec3, d: number): Piece | null {
  let anyIn = false, anyOut = false;
  for (const f of p.faces) {
    for (const v of f) {
      const s = dot(n, v) - d;
      if (s < -EPS) anyIn = true;
      else if (s > EPS) anyOut = true;
    }
  }
  if (!anyOut) return anyIn ? p : null;
  if (!anyIn) return null;

  const faces: Vec3[][] = [];
  const cap: Vec3[] = [];
  for (const f of p.faces) {
    const out: Vec3[] = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const sa = dot(n, a) - d, sb = dot(n, b) - d;
      if (sa <= EPS) out.push(a);
      if (Math.abs(sa) <= EPS) cap.push(a);
      if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) {
        const t = sa / (sa - sb);
        const pt = add(a, scale(sub(b, a), t));
        out.push(pt);
        cap.push(pt);
      }
    }
    if (out.length >= 3 && len(faceNormal(out)) > 1e-10) faces.push(out);
  }

  const uniq: Vec3[] = [];
  for (const c of cap) {
    if (!uniq.some((u) => len(sub(u, c)) < 1e-6)) uniq.push(c);
  }
  if (uniq.length >= 3) {
    const [u, v] = basisFor(n);
    const c = scale(uniq.reduce((s, q) => add(s, q), [0, 0, 0] as Vec3), 1 / uniq.length);
    /** Angle of a cap point around the centroid, used to put the new face in loop order. */
    const ang = (q: Vec3) => Math.atan2(dot(sub(q, c), v), dot(sub(q, c), u));
    uniq.sort((a, b) => ang(a) - ang(b));
    if (len(faceNormal(uniq)) > 1e-10) faces.push(uniq);
  }
  if (faces.length < 4) return null;
  return { ...p, faces };
}

/** Keep lo <= p[axis] <= hi. */
export function clipAxis(p: Piece, axis: 0 | 1 | 2, lo: number, hi: number): Piece | null {
  const n: Vec3 = [0, 0, 0];
  n[axis] = 1;
  const a = clip(p, n, hi);
  if (!a) return null;
  return clip(a, scale(n, -1), -lo);
}

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** Axis-aligned bounding box of a set of pieces; an empty set gives a zero box at the origin. */
export function bbox(pieces: Piece[]): Box3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pieces) {
    for (const f of p.faces) {
      for (const v of f) {
        for (let k = 0; k < 3; k++) {
          if (v[k] < min[k]) min[k] = v[k];
          if (v[k] > max[k]) max[k] = v[k];
        }
      }
    }
  }
  if (!pieces.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Width, height and depth of a bounding box. */
export const boxSize = (b: Box3): Vec3 => sub(b.max, b.min);
/** Midpoint of a bounding box. */
export const boxCenter = (b: Box3): Vec3 => scale(add(b.min, b.max), 0.5);

/** Copy a piece with one function applied to every vertex and another to its grain direction. */
function mapPiece(p: Piece, fp: (v: Vec3) => Vec3, fg: (v: Vec3) => Vec3): Piece {
  return { ...p, grain: fg(p.grain), faces: p.faces.map((f) => f.map(fp)) };
}

/** Move pieces by a vector. Grain is a direction, so it is unchanged. */
export function translate(pieces: Piece[], d: Vec3): Piece[] {
  if (!d[0] && !d[1] && !d[2]) return pieces;
  return pieces.map((p) => mapPiece(p, (v) => add(v, d), (g) => g));
}

// Clean up cos/sin so quarter turns give exact zeros and ones.
const snap = (x: number) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-12 ? Math.sign(x) : x);

/** Rotate about the Y axis: x' = x cos + z sin, z' = -x sin + z cos. */
export function rotateY(pieces: Piece[], angle: number, pivot: Vec3): Piece[] {
  const c = snap(Math.cos(angle)), s = snap(Math.sin(angle));
  /** Rotate one vector about Y by the precomputed cos and sin. */
  const r = (v: Vec3): Vec3 => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  return pieces.map((p) => mapPiece(p, (v) => add(r(sub(v, pivot)), pivot), r));
}

/** Rotate about the Z axis: x' = x cos - y sin, y' = x sin + y cos. */
export function rotateZ(pieces: Piece[], angle: number, pivot: Vec3): Piece[] {
  const c = snap(Math.cos(angle)), s = snap(Math.sin(angle));
  /** Rotate one vector about Z by the precomputed cos and sin. */
  const r = (v: Vec3): Vec3 => [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
  return pieces.map((p) => mapPiece(p, (v) => add(r(sub(v, pivot)), pivot), r));
}

/** Move the bounding box's low corner to the origin. */
export function toOrigin(pieces: Piece[]): Piece[] {
  const b = bbox(pieces);
  return translate(pieces, scale(b.min, -1));
}
