import { describe, expect, it } from 'vitest';
import { buildCutList } from './cutlist';
import { fitThickness, fitToTarget } from './fit';
import { bbox, volume } from './geometry';
import { withGrain } from './grain';
import { run } from './test-helpers';
import { PRESETS, basketWeave, chessBoard, doubleBorder } from './presets';
import { BUILTIN_SPECIES, speciesById } from './species';
import type { Design, Stage } from './types';

/**
 * Reference outputs. Every design the app can start is run and everything it produces is reduced
 * to one line per stage: its title, size and a digest of its geometry, instruction, stock, warning
 * and animation. The lines are kept in `__snapshots__/golden.test.ts.snap`.
 *
 * The lines count from the first glue-up, with the ripping of its strips folded into it (see
 * test-helpers.ts), as they were recorded before ripping became a step of its own.
 *
 * This is the guard for changes to how the recipe is run: such a change must leave every line as
 * it was. A line that differs names the design and the stage whose output changed. Only refresh
 * the snapshot (`npx vitest run -u src/model/golden.test.ts`) for a change that is meant to alter
 * what a design produces, and say so in the commit.
 */

/** A number rounded so that rounding noise in the last places does not change a digest. */
const r = (n: number) => (Math.abs(n) < 5e-7 ? '0' : n.toFixed(6));

/** A short digest of a string: two 32-bit FNV-1a style hashes, in hex. */
function digest(text: string): string {
  let a = 0x811c9dc5, b = 0x1b873593;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Every piece of a list of slices as text: wood, grain, shade, and each face's corners, slice by slice in order. */
function geometry(slices: Stage['slices']): string {
  return slices.map((s) => {
    const pieces = s.pieces.map((p) => `${p.species}/${p.grain.map(r).join(',')}/${r(p.tone)}/`
      + p.faces.map((f) => f.map((v) => v.map(r).join(',')).join(' ')).join('|'));
    const m = s.motion ? `${s.motion.axis}:${r(s.motion.angle)}:${r(s.motion.shift)}` : '-';
    return `${m}#${pieces.join(';')}`;
  }).join('\n');
}

/** One line for a stage: what a person reads, in the clear, and a digest of everything else. */
function line(stage: Stage, i: number): string {
  const pieces = stage.slices.flatMap((s) => s.pieces);
  const b = pieces.length ? bbox(pieces) : null;
  const rest = [
    stage.summary, stage.error ?? '', stage.warning ?? '',
    JSON.stringify(stage.stock ?? null),
    stage.trimHint ? `${r(stage.trimHint.zLo)}..${r(stage.trimHint.zHi)}` : '',
    b ? [...b.min, ...b.max].map(r).join(',') : '',
    r(pieces.reduce((v, p) => v + volume(p), 0)),
    geometry(stage.slices),
    stage.aside ? geometry(stage.aside) : '',
  ].join('\u0001');
  return `${String(i).padStart(2)} ${stage.title} | ${stage.kind} ${stage.slices.length} | ${stage.size.map(r).join(' x ')}`
    + `${stage.error ? ' | ERROR' : ''}${stage.warning ? ' | warning' : ''}${stage.aside ? ` | aside ${stage.aside.length}` : ''} | ${digest(rest)}`;
}

/** Everything a design produces: a line per stage, then one for the cut list. */
function outputs(design: Design): string[] {
  const names = (id: string) => speciesById(BUILTIN_SPECIES, id).name;
  const stages = run(design, names);
  const list = buildCutList(stages, design);
  return [
    ...stages.map(line),
    `cut list | ${list.lines.length} lines | ${r(list.totalBf)} bf | yield ${r(list.yield)} | ${digest(JSON.stringify([list.lines, list.boardFeet, list.operations, list.finished.map(r)]))}`,
  ];
}

/** The sizes the wizard offers, and one odd one. */
const SIZES: Design['target'][] = [
  { length: 12, width: 9, thickness: 0.75 },
  { length: 16, width: 12, thickness: 1.25 },
  { length: 20, width: 16, thickness: 2 },
  { length: 14.5, width: 10.25, thickness: 1.125 },
];

/** Every design the app can start, by a name that says how it was made. */
function cases(): [string, Design][] {
  const out: [string, Design][] = [];
  for (const p of PRESETS) {
    out.push([p.key, p.make()]);
    SIZES.forEach((target) => out.push([
      `${p.key} fitted to ${target.length} x ${target.width} x ${target.thickness}`,
      fitThickness(fitToTarget({ ...p.make(), target })),
    ]));
    for (const grain of ['end', 'edge'] as const) {
      const turned = withGrain(p.make(), grain);
      if (turned) out.push([`${p.key} turned to ${grain} grain`, turned]);
    }
  }
  for (const grain of ['end', 'face'] as const) {
    out.push([`chess board, ${grain} grain, 2 inch squares`, chessBoard({ square: 2, dark: 'walnut', light: 'maple', thickness: 1.5, grain })]);
    out.push([`chess board, ${grain} grain, 1.5 inch squares`, chessBoard({ square: 1.5, dark: 'cherry', light: 'ash', thickness: 1.125, grain })]);
    out.push([`double border, ${grain} grain, 6 x 4`, doubleBorder({ block: 1.5, line: 0.125, field: 'maple', inner: 'walnut', outer: 'white-oak', spacer: 'poplar', along: 6, across: 4, thickness: 1.25, grain })]);
    out.push([`double border, ${grain} grain, 3 x 3`, doubleBorder({ block: 2, line: 0.1875, field: 'cherry', inner: 'maple', outer: 'walnut', along: 3, across: 3, thickness: 1, grain })]);
  }
  out.push(['basket weave without a border', basketWeave({ border: false })]);
  out.push(['basket weave, 2 inch bars, 3 x 6', basketWeave({ bar: 2, across: 3, along: 6, thickness: 1.5 })]);
  return out;
}

describe('reference outputs: running a design gives exactly what it gave before', () => {
  for (const [name, design] of cases()) {
    it(name, () => {
      expect(outputs(design)).toMatchSnapshot();
    });
  }
});
