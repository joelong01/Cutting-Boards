import { describe, expect, it } from 'vitest';
import { NO_FINISH } from './finish';
import { withGrain } from './grain';
import { run } from './pipeline';
import { catalog } from './presets';
import type { Design } from './types';

/**
 * What each design's top must look like, said on its own terms: stripes that meet, squares that
 * alternate, joints that stagger, lines that run unbroken. The other tests check sizes, counts
 * and wording, and compare a design with itself (rebuilt from Custom, or as it was last time);
 * none of those can tell a right pattern from a wrong one. These can.
 */

/** The finished top of a design, without its finishing cuts: its size, its pieces' top faces, and the wood at any point. */
function topOf(d: Design) {
  const last = run({ ...d, finish: NO_FINISH }, (id) => id).at(-1)!;
  const pieces = last.slices[0].pieces;
  const height = Math.max(...pieces.flatMap((p) => p.faces.flat().map((v) => v[1])));
  const faces = pieces.flatMap((p) => p.faces.filter((f) => f.every((v) => Math.abs(v[1] - height) < 1e-6)).map((f) => ({
    wood: p.species, f,
    x0: Math.min(...f.map((v) => v[0])), x1: Math.max(...f.map((v) => v[0])), z0: Math.min(...f.map((v) => v[2])), z1: Math.max(...f.map((v) => v[2])),
  })));
  /** The wood on top at (x, z), or '' where there is none. */
  const at = (x: number, z: number): string => {
    for (const face of faces) {
      if (x < face.x0 || x > face.x1 || z < face.z0 || z > face.z1) continue;
      let inside = false;
      const f = face.f;
      for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
        if ((f[i][2] > z) !== (f[j][2] > z) && x < ((f[j][0] - f[i][0]) * (z - f[i][2])) / (f[j][2] - f[i][2]) + f[i][0]) inside = !inside;
      }
      if (inside) return face.wood;
    }
    return '';
  };
  return { length: last.size[0], width: last.size[2], faces, at, error: last.error };
}

/** The woods met walking a straight line in fine steps, as runs: each wood and how far it goes. `along` is the direction walked. */
function runs(at: (x: number, z: number) => string, along: 'x' | 'z', fixed: number, from: number, to: number): { wood: string; len: number }[] {
  const out: { wood: string; len: number }[] = [];
  const step = 0.01;
  for (let t = from; t < to; t += step) {
    const wood = along === 'x' ? at(t, fixed) : at(fixed, t);
    if (out.length && out[out.length - 1].wood === wood) out[out.length - 1].len += step;
    else out.push({ wood, len: step });
  }
  return out;
}

const designs = Object.fromEntries(catalog({ length: 16, width: 12, thickness: 1.5 }).map((o) => [o.key, o.make()])) as Record<string, Design>;
designs['tumbling-blocks-flat'] = withGrain(designs['tumbling-blocks'], 'edge')!;

describe('every design has the pattern it is named for', () => {
  it.each(Object.keys(designs))('%s: the top is wood all over, with no gap anywhere', (key) => {
    const t = topOf(designs[key]);
    expect(t.error).toBeUndefined();
    const bare: string[] = [];
    for (let x = 0.13; x < t.length; x += 0.37) for (let z = 0.11; z < t.width; z += 0.31) if (!t.at(x, z)) bare.push(`${x.toFixed(2)},${z.toFixed(2)}`);
    expect(bare).toEqual([]);
  });

  it('single wood is one wood', () => {
    const t = topOf(designs['single-end-grain']);
    expect([...new Set(t.faces.map((f) => f.wood))]).toEqual(['maple']);
  });

  it('stripes run unbroken from one end of the board to the other', () => {
    const t = topOf(designs['edge-grain-stripes']);
    const across = runs(t.at, 'z', t.length / 2, 0.05, t.width - 0.05);
    expect(new Set(across.map((r) => r.wood)).size).toBeGreaterThanOrEqual(3);
    expect(across.length).toBeGreaterThan(6);
    for (let z = 0.05; z < t.width; z += 0.1) {
      const line = runs(t.at, 'x', z, 0.05, t.length - 0.05);
      expect(line.length, `at ${z.toFixed(2)} across`).toBe(1);
    }
  });

  it('stripes in a border: the border goes all the way round and the stripes run the length inside it', () => {
    const t = topOf(designs['edge-grain-border']);
    for (let x = 0.1; x < t.length; x += 0.5) {
      expect(t.at(x, 0.3)).toBe('purpleheart');
      expect(t.at(x, t.width - 0.3)).toBe('purpleheart');
    }
    for (let z = 0.1; z < t.width; z += 0.5) {
      expect(t.at(0.3, z)).toBe('purpleheart');
      expect(t.at(t.length - 0.3, z)).toBe('purpleheart');
    }
    for (let z = 1.2; z < t.width - 1.2; z += 0.1) expect(runs(t.at, 'x', z, 1.2, t.length - 1.2).length, `at ${z.toFixed(2)} across`).toBe(1);
  });

  it.each(['checkerboard', 'chess'])('%s: squares of two woods alternate along the board and across it, and meet corner to corner', (key) => {
    const t = topOf(designs[key]);
    const first = runs(t.at, 'x', 0.3, 0.02, t.length - 0.02);
    const down = runs(t.at, 'z', 0.3, 0.02, t.width - 0.02);
    for (const line of [first, down]) {
      expect(line.length).toBeGreaterThanOrEqual(4);
      expect(new Set(line.map((r) => r.wood)).size).toBe(2);
      // Alternating, and every square between the first and last the same size.
      line.forEach((r, i) => i && expect(r.wood).not.toBe(line[i - 1].wood));
      const inner = line.slice(1, -1).map((r) => r.len);
      expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(0.03);
    }
    // One square along and one across is the same wood again; one along only is the other.
    const [cx, cz] = [first[1].len, down[1].len];
    const [x, z] = [first[0].len + cx / 2, down[0].len + cz / 2];
    for (let i = 0; x + (i + 1) * cx < t.length - 0.1; i++) {
      for (let j = 0; z + (j + 1) * cz < t.width - 0.1; j++) {
        expect(t.at(x + (i + 1) * cx, z + (j + 1) * cz)).toBe(t.at(x + i * cx, z + j * cz));
        expect(t.at(x + (i + 1) * cx, z + j * cz)).not.toBe(t.at(x + i * cx, z + j * cz));
      }
    }
  });

  it('brick: the joints of each row fall halfway along the blocks of the next', () => {
    const t = topOf(designs.brick);
    // Rows are the pieces sharing a stretch of the board's length; a row's joints are where its blocks meet.
    const rows = new Map<string, number[]>();
    for (const f of t.faces) {
      const key = f.x0.toFixed(3);
      rows.set(key, [...(rows.get(key) ?? []), f.z0]);
    }
    const joints = [...rows.entries()].sort((a, b) => +a[0] - +b[0]).map(([, zs]) => zs.filter((z) => z > 0.01).sort((a, b) => a - b));
    expect(joints.length).toBeGreaterThanOrEqual(6);
    const block = joints[0][1] - joints[0][0];
    expect(block).toBeGreaterThan(1);
    for (let r = 1; r < joints.length; r++) {
      for (const z of joints[r]) {
        const nearest = Math.min(...joints[r - 1].map((other) => Math.abs(other - z)));
        expect(nearest, `row ${r + 1}, joint at ${z.toFixed(2)}`).toBeCloseTo(block / 2, 2);
      }
    }
  });

  it('grid: the accent lines run unbroken both ways, with equal squares between them', () => {
    const t = topOf(designs['maple-purpleheart']);
    const along = runs(t.at, 'z', t.length / 2 + 0.31, 0.02, t.width - 0.02);
    const across = runs(t.at, 'x', t.width / 2 + 0.31, 0.02, t.length - 0.02);
    for (const [line, dir, far] of [[along, 'x', t.length], [across, 'z', t.width]] as const) {
      expect(new Set(line.map((r) => r.wood))).toEqual(new Set(['maple', 'purpleheart']));
      const squares = line.slice(1, -1).filter((r) => r.wood === 'maple').map((r) => r.len);
      expect(Math.max(...squares) - Math.min(...squares)).toBeLessThan(0.03);
      // Walk the middle of each accent line the other way: it is the accent wood from edge to edge.
      let at = 0.02;
      for (const r of line) {
        if (r.wood === 'purpleheart') expect(runs(t.at, dir, at + r.len / 2, 0.02, far - 0.02).map((x) => x.wood)).toEqual(['purpleheart']);
        at += r.len;
      }
    }
  });

  it('chevron: every stripe carries on across the glue line into the next slice, leaning the other way', () => {
    const d = designs.chevron;
    const t = topOf(d);
    const cut = d.steps.find((s) => s.type === 'crosscut')!;
    const wide = cut.type === 'crosscut' ? cut.width : 0;
    expect(wide).toBeGreaterThan(0);
    const leans: number[] = [];
    for (let k = 0; (k + 1) * wide <= t.length + 1e-6; k++) {
      // Same wood either side of the glue line, all the way across the board.
      if (k) {
        let same = 0, n = 0;
        for (let z = 0.2; z < t.width - 0.2; z += 0.03) {
          n++;
          if (t.at(k * wide - 0.015, z) === t.at(k * wide + 0.015, z)) same++;
        }
        expect(same / n, `glue line ${k}`).toBeGreaterThan(0.97);
      }
      // Which way this slice's stripes lean: a stripe is the same wood one inch along and one up, or one down.
      let up = 0, down = 0;
      for (let z = 1.5; z < t.width - 1.5; z += 0.05) {
        const here = t.at(k * wide + 0.4, z);
        if (t.at(k * wide + 1.4, z + 1) === here) up++;
        if (t.at(k * wide + 1.4, z - 1) === here) down++;
      }
      expect(Math.abs(up - down), `slice ${k + 1} leans one way`).toBeGreaterThan(0.5 * Math.max(up, down));
      leans.push(Math.sign(up - down));
    }
    expect(leans.length).toBeGreaterThanOrEqual(4);
    leans.forEach((lean, k) => k && expect(lean, `slice ${k + 1}`).toBe(-leans[k - 1]));
  });

  it('double border: the outer lines run unbroken both ways, and every block is ringed by the inner wood', () => {
    const t = topOf(designs.double);
    const along = runs(t.at, 'z', t.length / 2 + 0.4, 0.02, t.width - 0.02);
    const across = runs(t.at, 'x', t.width / 2 + 0.4, 0.02, t.length - 0.02);
    for (const [line, dir, far] of [[along, 'x', t.length], [across, 'z', t.width]] as const) {
      expect(new Set(line.map((r) => r.wood))).toEqual(new Set(['maple', 'walnut', 'white-oak']));
      // Between two outer lines: inner, block, inner. Never a block against an outer line.
      line.forEach((r, i) => {
        if (r.wood !== 'maple') return;
        expect(line[i - 1]?.wood).toBe('walnut');
        expect(line[i + 1]?.wood).toBe('walnut');
      });
      let at = 0.02;
      for (const r of line) {
        if (r.wood === 'white-oak') expect(runs(t.at, dir, at + r.len / 2, 0.02, far - 0.02).map((x) => x.wood)).toEqual(['white-oak']);
        at += r.len;
      }
    }
    expect(t.faces.some((f) => f.wood === 'poplar')).toBe(false);
  });

  it('basket weave: a border all the way round, and bars that pass over and under in turn', () => {
    const t = topOf(designs['basket-weave']);
    for (let x = 0.1; x < t.length; x += 0.5) {
      expect(t.at(x, 0.4)).toBe('walnut');
      expect(t.at(x, t.width - 0.4)).toBe('walnut');
    }
    // The sides go on over the ends, so each end is the border wood but for the two thin lines
    // of the sides running through it.
    for (const x of [0.4, t.length - 0.4]) {
      const end = runs(t.at, 'z', x, 0.02, t.width - 0.02);
      expect(end.map((r) => r.wood)).toEqual(['walnut', 'cherry', 'walnut', 'cherry', 'walnut']);
      expect(end[1].len).toBeLessThan(0.2);
      expect(end[3].len).toBeLessThan(0.2);
    }
    // Inside the border the three woods all show, and the pattern is the same turned half round:
    // a weave has no top or bottom.
    const woods = new Set<string>();
    let same = 0, n = 0;
    for (let x = 2.05; x < t.length - 2; x += 0.23) {
      for (let z = 2.05; z < t.width - 2; z += 0.19) {
        woods.add(t.at(x, z));
        n++;
        if (t.at(x, z) === t.at(t.length - x, t.width - z)) same++;
      }
    }
    expect(woods).toEqual(new Set(['walnut', 'maple', 'cherry']));
    expect(same / n).toBeGreaterThan(0.97);
  });

  it.each(['tumbling-blocks', 'tumbling-blocks-flat'])('%s: three woods in equal diamonds, each wood always leaning the same way', (key) => {
    const t = topOf(designs[key]);
    // Away from the trimmed edges every piece on top is a whole diamond or a part of one, and each
    // wood's whole diamonds all point the same way: that is what makes a face read as a face.
    const whole = t.faces.filter((f) => f.f.length === 4 && f.x0 > 0.01 && f.z0 > 0.01 && f.x1 < t.length - 0.01 && f.z1 < t.width - 0.01);
    const ways = new Map<string, Set<string>>();
    for (const f of whole) {
      const sides = f.f.map((v, i) => Math.hypot(v[0] - f.f[(i + 1) % 4][0], v[2] - f.f[(i + 1) % 4][2]));
      if (Math.max(...sides) - Math.min(...sides) > 1e-6) continue;
      // The long diagonal's direction, to the nearest 30°, says which way a diamond points.
      const d0 = Math.hypot(f.f[0][0] - f.f[2][0], f.f[0][2] - f.f[2][2]), d1 = Math.hypot(f.f[1][0] - f.f[3][0], f.f[1][2] - f.f[3][2]);
      const [p, q] = d0 > d1 ? [f.f[0], f.f[2]] : [f.f[1], f.f[3]];
      const turn = ((Math.round((Math.atan2(q[2] - p[2], q[0] - p[0]) * 180) / Math.PI / 30) * 30) % 180 + 180) % 180;
      ways.set(f.wood, (ways.get(f.wood) ?? new Set()).add(String(turn)));
    }
    if (key === 'tumbling-blocks') {
      expect([...ways.keys()].sort()).toEqual(['cherry', 'maple', 'walnut']);
      for (const [wood, set] of ways) expect([...set], wood).toHaveLength(1);
      expect(new Set([...ways.values()].map((s) => [...s][0])).size).toBe(3);
    }
    // In either grain the three woods share the top equally.
    const share = new Map<string, number>();
    for (let x = 0.07; x < t.length; x += 0.11) for (let z = 0.05; z < t.width; z += 0.09) share.set(t.at(x, z), (share.get(t.at(x, z)) ?? 0) + 1);
    const total = [...share.values()].reduce((a, b) => a + b, 0);
    expect([...share.keys()].sort()).toEqual(['cherry', 'maple', 'walnut']);
    for (const count of share.values()) expect(Math.abs(count / total - 1 / 3)).toBeLessThan(0.05);
  });
});
