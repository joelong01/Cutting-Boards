import {
  bbox, box, boxCenter, boxSize, clipAxis, rotateY, rotateZ, toOrigin, translate, volume,
} from './geometry';
import { applyFinish, finishOf } from './finish';
import { inches } from './fractions';
import type { Design, Layup, Piece, Selector, Slice, Stage, Step, StockLine, StripSpec } from './types';

type Names = (speciesId: string) => string;

const MAX_SLICES = 300;
/** Repeatable pseudo-random number in [0, 1) for strip i, so a strip keeps its shade between runs. */
const tone = (i: number) => {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** The full strip sequence across the panel: the pattern repeated, plus the closing strip if asked for. Zero-width strips are dropped. */
export function expandStrips(layup: Layup): StripSpec[] {
  const out: StripSpec[] = [];
  const reps = Math.max(1, Math.floor(layup.repeat));
  for (let r = 0; r < reps; r++) out.push(...layup.strips);
  if (layup.closeWithFirst && layup.strips.length) out.push(layup.strips[0]);
  return out.filter((s) => s.width > 0);
}

/** Whether slice i (zero-based) is chosen by a selector. */
export function matches(sel: Selector, i: number): boolean {
  if (sel.mode === 'all') return true;
  if (sel.mode === 'pick') return sel.indices.includes(i);
  const n = Math.max(1, Math.floor(sel.n));
  return i >= sel.offset && (i - sel.offset) % n === 0;
}

/** English ordinal for a number: 1st, 2nd, 3rd, 4th, 11th. */
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** A selector in plain words for the order of operations, counting slices from 1. */
export function describeSelector(sel: Selector): string {
  if (sel.mode === 'all') return 'every slice';
  if (sel.mode === 'pick') {
    return sel.indices.length
      ? `slice${sel.indices.length > 1 ? 's' : ''} ${[...sel.indices].sort((a, b) => a - b).map((i) => i + 1).join(', ')}`
      : 'no slices';
  }
  const n = Math.max(1, Math.floor(sel.n));
  if (n === 1) return sel.offset ? `every slice from slice ${sel.offset + 1}` : 'every slice';
  return `every ${ordinal(n)} slice, starting with slice ${sel.offset + 1}`;
}

/** Pack slices tight along X, each sitting on Y = 0. Z is left alone: it carries the offsets. */
function layout(slices: Slice[]): Slice[] {
  let cursor = 0;
  return slices.map((s) => {
    const b = bbox(s.pieces);
    const out = { ...s, pieces: translate(s.pieces, [cursor - b.min[0], -b.min[1], 0]) };
    cursor += b.max[0] - b.min[0];
    return out;
  });
}

/** Assemble a Stage, packing loose slices tight and measuring the overall size. */
function stage(kind: Stage['kind'], slices: Slice[], title: string, summary: string, extra: Partial<Stage> = {}): Stage {
  const laid = kind === 'slices' ? layout(slices) : slices;
  const size = boxSize(bbox(laid.flatMap((s) => s.pieces)));
  return { kind, slices: laid, size, title, summary, ...extra };
}

/** The stage for a step that could not run: the previous geometry passed through unchanged, carrying an error message. */
function failed(prev: Stage, title: string, error: string): Stage {
  return {
    ...prev,
    slices: prev.slices.map((s) => ({ pieces: s.pieces })),
    title, summary: '', error, warning: undefined, stock: undefined,
  };
}

/** The first glue-up: one box per strip laid side by side across Z, with the stock list and the milling instruction. */
export function buildLayup(layup: Layup, names: Names): Stage {
  const strips = expandStrips(layup);
  const pieces: Piece[] = [];
  let z = 0;
  strips.forEach((s, i) => {
    pieces.push(box([0, 0, z], [layup.length, layup.thickness, z + s.width], s.species, [1, 0, 0], tone(i)));
    z += s.width;
  });
  const groups = new Map<string, StockLine>();
  for (const s of strips) {
    const key = `${s.species}|${s.width}`;
    const line = groups.get(key);
    if (line) line.count++;
    else {
      groups.set(key, {
        species: s.species, count: 1, thickness: layup.thickness, width: s.width,
        length: layup.length, use: 'First glue-up: runs the length of the panel',
      });
    }
  }
  const stock = [...groups.values()];
  const parts = stock.map((l) => `${l.count} × ${names(l.species)} ${inches(l.width)} wide`).join(', ');
  const summary = strips.length
    ? `Mill ${strips.length} strips ${inches(layup.thickness)} thick and ${inches(layup.length)} long: ${parts}. `
      + `Glue them edge to edge in order into a panel ${inches(z)} wide.`
    : 'Add at least one strip.';
  return stage('panel', [{ pieces }], 'First glue-up', summary, {
    stock, error: strips.length ? undefined : 'The layup has no strips.',
  });
}

/** Cut a panel into slices of a set width, losing a kerf between each. At an angle the panel is first rotated so the blade is square to X, which leaves every slice a straight slab with flat glue faces. */
function crosscut(prev: Stage, step: Extract<Step, { type: 'crosscut' }>): Stage {
  const title = 'Cross cut';
  if (!(step.width > 0)) return failed(prev, title, 'Slice width must be greater than zero.');
  if (Math.abs(step.angle) > 75) return failed(prev, title, 'Cut angle must be between -75° and 75°.');
  const angle = (step.angle * Math.PI) / 180;
  const kerf = Math.max(0, step.kerf);
  const pieces = angle ? rotateY(prev.slices[0].pieces, angle, [0, 0, 0]) : prev.slices[0].pieces;
  const b = bbox(pieces);
  if ((b.max[0] - b.min[0]) / (step.width + kerf) > MAX_SLICES) {
    return failed(prev, title, `That would make more than ${MAX_SLICES} slices.`);
  }
  const ranges = pieces.map((p) => {
    const pb = bbox([p]);
    return [pb.min[0], pb.max[0]] as const;
  });
  let slices: Slice[] = [];
  let offcut = 0;
  for (let start = b.min[0]; start < b.max[0] - 1e-6; start += step.width + kerf) {
    const end = start + step.width;
    if (end > b.max[0] + 1e-6) {
      offcut = b.max[0] - start;
      break;
    }
    const cut: Piece[] = [];
    pieces.forEach((p, i) => {
      if (ranges[i][1] <= start + 1e-9 || ranges[i][0] >= end - 1e-9) return;
      const c = clipAxis(p, 0, start, end);
      if (c && volume(c) > 1e-9) cut.push(c);
    });
    if (cut.length) slices.push({ pieces: cut });
  }
  let dropped = 0;
  if (angle) {
    // The corners of an angled cut are triangles too short to use; keep the full-length slices
    // and line them up, as you would on the bench.
    const vols = slices.map((s) => s.pieces.reduce((v, p) => v + volume(p), 0));
    const most = Math.max(0, ...vols);
    const kept = slices.filter((_, i) => vols[i] >= 0.6 * most);
    dropped = slices.length - kept.length;
    slices = kept.map((s) => {
      const c = boxCenter(bbox(s.pieces));
      return { pieces: translate(s.pieces, [0, 0, -c[2]]) };
    });
  }
  if (!slices.length) return failed(prev, title, 'The panel is shorter than one slice.');
  let summary = `Cross cut the panel into ${slices.length} slices, each ${inches(step.width)} wide`
    + (step.angle ? `, with the blade at ${step.angle}° to square` : '')
    + ` (kerf ${inches(kerf)}).`;
  if (offcut > 1e-6) summary += ` The last ${inches(offcut)} is an offcut.`;
  if (dropped) summary += ` ${dropped} short corner piece${dropped > 1 ? 's are' : ' is'} waste.`;
  return stage('slices', slices, title, summary);
}

/** Apply one move (turn, flip or slide) to the selected slices and leave the rest alone, recording the motion for animation. */
function arrange(
  prev: Stage, sel: Selector, title: string, verb: string,
  move: (pieces: Piece[]) => { pieces: Piece[]; motion: Slice['motion'] },
): Stage {
  let count = 0;
  const slices = prev.slices.map((s, i) => {
    if (!matches(sel, i)) return { pieces: s.pieces };
    count++;
    return move(s.pieces);
  });
  const st = stage('slices', slices, title, `${verb} ${describeSelector(sel)} (${count} of ${slices.length}).`);
  if (!count) st.warning = 'The selection matches no slices.';
  return st;
}

/** The Z range covered by every slice on both of its glue faces: what is left after the ragged edges of an offset or angled glue-up are trimmed. */
function trimHintFor(slices: Slice[]): { zLo: number; zHi: number } {
  let zLo = -Infinity, zHi = Infinity;
  for (const s of slices) {
    const b = bbox(s.pieces);
    // The Z span present on both glue faces of the slice is the part with no gap beside it.
    for (const x of [b.min[0], b.max[0]]) {
      let lo = Infinity, hi = -Infinity;
      for (const p of s.pieces) {
        for (const f of p.faces) {
          for (const v of f) {
            if (Math.abs(v[0] - x) < 1e-5) {
              lo = Math.min(lo, v[2]);
              hi = Math.max(hi, v[2]);
            }
          }
        }
      }
      zLo = Math.max(zLo, lo);
      zHi = Math.min(zHi, hi);
    }
  }
  return { zLo, zHi };
}

/** Whether most of the wood in a panel has its fibres pointing up, by volume. */
function endGrainUp(pieces: Piece[]): boolean {
  let up = 0, total = 0;
  for (const p of pieces) {
    const v = volume(p);
    total += v;
    if (Math.abs(p.grain[1]) > 0.75) up += v;
  }
  return total > 0 && up > total / 2;
}

const NEEDS_PANEL: Step['type'][] = ['crosscut', 'trim', 'flatten', 'rotate'];

/** Whether a step type works on a glued panel or on loose slices. */
export function stepNeeds(type: Step['type']): Stage['kind'] {
  return NEEDS_PANEL.includes(type) ? 'panel' : 'slices';
}

export const STEP_TITLES: Record<Step['type'], string> = {
  crosscut: 'Cross cut',
  turn: 'Turn to end grain',
  flip: 'Flip',
  shift: 'Offset',
  insert: 'Insert accent strips',
  glue: 'Glue up',
  trim: 'Trim',
  flatten: 'Flatten',
  rotate: 'Quarter-turn panel',
};

/** Run one step on the previous stage and return the new stage. Never throws: a step that cannot run returns a stage with an error. */
export function applyStep(prev: Stage, step: Step, names: Names): Stage {
  const title = STEP_TITLES[step.type];
  if (prev.error && !prev.slices.some((s) => s.pieces.length)) return failed(prev, title, 'Fix the earlier step first.');
  const needs = stepNeeds(step.type);
  if (prev.kind !== needs) {
    return failed(prev, title, needs === 'panel'
      ? 'This needs a glued panel. Add a "Glue up" step before it.'
      : 'This works on loose slices. Add a "Cross cut" step before it.');
  }
  switch (step.type) {
    case 'crosscut':
      return crosscut(prev, step);
    case 'turn':
      return arrange(prev, step.sel, title, 'Roll onto its side, end grain up:', (pieces) => ({
        pieces: rotateZ(pieces, Math.PI / 2, boxCenter(bbox(pieces))),
        motion: { axis: 'z', angle: Math.PI / 2, shift: 0 },
      }));
    case 'flip':
      return arrange(prev, step.sel, title,
        step.how === 'end' ? 'Turn end for end:' : 'Flip face down:',
        (pieces) => {
          const c = boxCenter(bbox(pieces));
          return step.how === 'end'
            ? { pieces: rotateY(pieces, Math.PI, c), motion: { axis: 'y', angle: Math.PI, shift: 0 } }
            : { pieces: rotateZ(pieces, Math.PI, c), motion: { axis: 'z', angle: Math.PI, shift: 0 } };
        });
    case 'shift':
      return arrange(prev, step.sel, title, `Slide ${inches(step.amount)} along its length:`, (pieces) => ({
        pieces: translate(pieces, [0, 0, step.amount]),
        motion: { axis: null, angle: 0, shift: step.amount },
      }));
    case 'insert': {
      if (!(step.thickness > 0)) return failed(prev, title, 'Accent strip thickness must be greater than zero.');
      const every = Math.max(1, Math.floor(step.every));
      const b = bbox(prev.slices.flatMap((s) => s.pieces));
      const slices: Slice[] = [];
      let count = 0;
      prev.slices.forEach((s, i) => {
        slices.push({ pieces: s.pieces });
        if (i < prev.slices.length - 1 && (i + 1) % every === 0) {
          slices.push({
            pieces: [box([0, 0, b.min[2]], [step.thickness, b.max[1], b.max[2]], step.species, [0, 0, 1], tone(1000 + count))],
          });
          count++;
        }
      });
      if (slices.length > MAX_SLICES * 2) return failed(prev, title, 'Too many slices.');
      const stock: StockLine[] = count ? [{
        species: step.species, count, thickness: step.thickness, width: b.max[1] - b.min[1],
        length: b.max[2] - b.min[2], use: 'Second glue-up: between the cross-cut slices',
      }] : [];
      return stage('slices', slices, title,
        `Mill ${count} ${names(step.species)} strips ${inches(step.thickness)} × ${inches(b.max[1] - b.min[1])} × `
        + `${inches(b.max[2] - b.min[2])} and place one after every ${every > 1 ? ordinal(every) + ' ' : ''}slice.`,
        { stock });
    }
    case 'glue': {
      const laid = layout(prev.slices);
      const heights = laid.map((s) => boxSize(bbox(s.pieces))[1]);
      const hint = trimHintFor(laid);
      const all = laid.flatMap((s) => s.pieces);
      const b = bbox(all);
      const st = stage('panel', [{ pieces: toOrigin(all) }], title,
        `Glue the ${laid.length} slices face to face in this order, keeping the ends lined up as shown.`,
        { trimHint: { zLo: hint.zLo - b.min[2], zHi: hint.zHi - b.min[2] } });
      if (Math.max(...heights) - Math.min(...heights) > 1 / 64) {
        st.warning = `Slices differ in height by ${inches(Math.max(...heights) - Math.min(...heights))}; flatten after glue-up.`;
      }
      return st;
    }
    case 'trim': {
      let zLo = 0, zHi = prev.size[2];
      if (step.auto && prev.trimHint && prev.trimHint.zHi > prev.trimHint.zLo) {
        zLo = prev.trimHint.zLo;
        zHi = prev.trimHint.zHi;
      }
      zLo += Math.max(0, step.z0);
      zHi -= Math.max(0, step.z1);
      const xLo = Math.max(0, step.x0), xHi = prev.size[0] - Math.max(0, step.x1);
      if (zHi - zLo < 1e-3 || xHi - xLo < 1e-3) return failed(prev, title, 'The trim removes the whole panel.');
      const pieces: Piece[] = [];
      for (const p of prev.slices[0].pieces) {
        const a = clipAxis(p, 2, zLo, zHi);
        const c = a && clipAxis(a, 0, xLo, xHi);
        if (c && volume(c) > 1e-9) pieces.push(c);
      }
      const done = stage('panel', [{ pieces: toOrigin(pieces) }], title, '');
      done.summary = `Trim the panel square to ${inches(done.size[0])} × ${inches(done.size[2])}: `
        + `${inches(zLo)} off long edge A and ${inches(prev.size[2] - zHi)} off long edge B`
        + (xLo || prev.size[0] - xHi > 1e-9 ? `, ${inches(xLo)} off end A and ${inches(prev.size[0] - xHi)} off end B.` : '.');
      return done;
    }
    case 'flatten': {
      const lo = Math.max(0, step.bottom), hi = prev.size[1] - Math.max(0, step.top);
      if (hi - lo < 1e-3) return failed(prev, title, 'Flattening removes the whole thickness.');
      const pieces: Piece[] = [];
      for (const p of prev.slices[0].pieces) {
        const c = clipAxis(p, 1, lo, hi);
        if (c && volume(c) > 1e-9) pieces.push(c);
      }
      return stage('panel', [{ pieces: toOrigin(pieces) }], title,
        (endGrainUp(pieces)
          ? 'Flatten both faces with a drum sander or router sled: '
          : 'Flatten both faces (planer, drum sander or router sled): ')
        + `${inches(step.top)} off the top and ${inches(step.bottom)} off the bottom, to ${inches(hi - lo)} thick.`
        + (endGrainUp(pieces)
          ? ' This is end grain: a thickness planer can tear out the trailing edge or throw the board. If you do plane it, '
            + 'glue a sacrificial long-grain strip across the trailing end, take very light passes, and cut the strip off after.'
          : ''),
        { trimHint: prev.trimHint });
    }
    case 'rotate':
      return stage('panel', [{ pieces: toOrigin(rotateY(prev.slices[0].pieces, Math.PI / 2, [0, 0, 0])) }], title,
        'Turn the panel a quarter turn on the bench, so the next cut runs the other way (a rip, if the grain now runs across).');
  }
}

/**
 * stages[0] is the first glue-up and stages[i + 1] is the result of steps[i]. When the design has
 * a juice groove or bottom chamfer turned on and the recipe ends in a sound panel, one more
 * stage, titled Finish, follows the last step.
 */
export function run(design: Design, names: Names = (id) => id): Stage[] {
  const stages = [buildLayup(design.layup, names)];
  for (const step of design.steps) stages.push(applyStep(stages[stages.length - 1], step, names));
  warnUnflattened(design, stages);
  const finished = applyFinish(stages[stages.length - 1], finishOf(design));
  if (finished) stages.push(finished);
  return stages;
}

/**
 * Add a warning wherever a glue-up is used without being flattened first: cross cut straight
 * from the clamps, or left as the finished board. A glued panel is never flat, so the recipe
 * needs a Flatten step, and thickness to lose in it, before that point. Existing warnings and
 * errors are kept.
 */
function warnUnflattened(design: Design, stages: Stage[]) {
  // flat[i]: has stage i been flattened since it was last glued?
  let flat = false;
  design.steps.forEach((step, i) => {
    const stage = stages[i + 1];
    if (stage.error) return;
    if (step.type === 'flatten') flat = true;
    else if (step.type === 'glue') flat = false;
    else if (step.type === 'crosscut' && !flat && !stage.warning) {
      stage.warning = 'This panel is cut straight from the glue-up. Add a Flatten step before it and mill the strips thicker to allow for it.';
    }
    if (step.type === 'crosscut') flat = false;
  });
  const last = stages[stages.length - 1];
  if (!flat && !last.error && !last.warning && last.kind === 'panel') {
    last.warning = 'The finished board is never flattened. Add a Flatten step at the end and allow thickness for it.';
  }
}

/** Number of separate pieces of wood in a stage. */
export function pieceCount(stage: Stage): number {
  return stage.slices.reduce((n, s) => n + s.pieces.length, 0);
}
