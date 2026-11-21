import {
  bbox, box, boxCenter, boxSize, clipAxis, rotateY, rotateZ, toOrigin, translate, volume,
} from './geometry';
import { accentStrips, patternPeriod } from './accent';
import { applyFinish, finishOf } from './finish';
import { inches } from './fractions';
import type { AccentStrip, Design, Layup, Piece, Selector, Slice, Stage, Step, StockLine, StripSpec } from './types';

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

/**
 * A panel glued up from strips: one box per strip laid side by side across Z (three, stacked, for
 * a strip with a wood glued to both faces), with its stock list and milling instruction. `which`
 * names the panel in the stock list, "First glue-up" or "Second panel".
 */
function buildPanel(strips: StripSpec[], length: number, thickness: number, names: Names, which: string): { pieces: Piece[]; stock: StockLine[]; summary: string; width: number } {
  const pieces: Piece[] = [];
  let z = 0;
  strips.forEach((s, i) => {
    const f = s.faces && s.faces.thickness > 0 && 2 * s.faces.thickness < thickness ? s.faces : undefined;
    if (f) {
      pieces.push(box([0, 0, z], [length, f.thickness, z + s.width], f.species, [1, 0, 0], tone(500 + i)));
      pieces.push(box([0, f.thickness, z], [length, thickness - f.thickness, z + s.width], s.species, [1, 0, 0], tone(i)));
      pieces.push(box([0, thickness - f.thickness, z], [length, thickness, z + s.width], f.species, [1, 0, 0], tone(700 + i)));
    } else pieces.push(box([0, 0, z], [length, thickness, z + s.width], s.species, [1, 0, 0], tone(i)));
    z += s.width;
  });
  const groups = new Map<string, StockLine>();
  /** Count one more piece of this size, starting its stock line if it is the first. */
  const need = (species: string, thick: number, width: number, use: string, count = 1) => {
    const key = `${species}|${thick}|${width}|${use}`;
    const line = groups.get(key);
    if (line) line.count += count;
    else groups.set(key, { species, count, thickness: thick, width, length, use });
  };
  const faced = new Map<string, { strip: StripSpec; count: number }>();
  for (const s of strips) {
    const f = s.faces && s.faces.thickness > 0 && 2 * s.faces.thickness < thickness ? s.faces : undefined;
    if (!f) {
      need(s.species, thickness, s.width, `${which}: runs the length of the panel`);
      continue;
    }
    need(s.species, thickness - 2 * f.thickness, s.width, `${which}: a plank that gets a face glued to each side`);
    need(f.species, f.thickness, s.width, `${which}: the faces glued to both sides of a plank`, 2);
    const key = `${s.species}|${s.width}|${f.species}|${f.thickness}`;
    const entry = faced.get(key);
    if (entry) entry.count++;
    else faced.set(key, { strip: s, count: 1 });
  }
  const stock = [...groups.values()];
  const planks = [...faced.values()].map(({ strip, count }) =>
    `${count} ${names(strip.species)} plank${count > 1 ? 's' : ''} ${inches(thickness - 2 * strip.faces!.thickness)} thick and ${inches(strip.width)} wide, `
    + `with a ${names(strip.faces!.species)} face ${inches(strip.faces!.thickness)} thick glued to both sides`);
  const plain = stock.filter((l) => l.use.endsWith('runs the length of the panel'));
  const parts = [
    ...plain.map((l) => `${l.count} × ${names(l.species)} ${inches(l.width)} wide`),
    ...[...faced.values()].map(({ strip, count }) => `${count} × faced plank ${inches(strip.width)} wide`),
  ].join(', ');
  const summary = (planks.length ? `First make ${planks.join(', and ')}, ${inches(length)} long; each then counts as one strip ${inches(thickness)} thick. ` : '')
    + `Mill ${strips.length} strips ${inches(thickness)} thick and ${inches(length)} long: ${parts}. `
    + `Glue them edge to edge in order into a panel ${inches(z)} wide.`;
  return { pieces, stock, summary, width: z };
}

/** The first glue-up, from the design's strips. */
export function buildLayup(layup: Layup, names: Names): Stage {
  const strips = expandStrips(layup);
  const built = buildPanel(strips, layup.length, layup.thickness, names, 'First glue-up');
  return stage('panel', [{ pieces: built.pieces }], 'First glue-up', strips.length ? built.summary : 'Add at least one strip.', {
    stock: built.stock, error: strips.length ? undefined : 'The layup has no strips.',
  });
}

/** Saw kerf and end trim allowed for when a second panel works out its own length. */
const SECOND_KERF = 0.125, SECOND_TRIM = 0.25;

/**
 * Start another panel: the loose slices are set aside and a new panel is glued up from the
 * step's strips. Left to size itself, it is made as wide as the set-aside slices are long, plus
 * the step's extra, in whole repeats of its strips; and long enough to square both ends and
 * cross cut one slice, as wide as the set-aside slices are tall, for each gap between them.
 */
function anotherPanel(prev: Stage, step: Extract<Step, { type: 'panel' }>, names: Names): Stage {
  const title = STEP_TITLES.panel;
  if (prev.aside) return failed(prev, title, 'There are already slices set aside. Interleave them before starting another panel.');
  const pattern = step.strips.filter((st) => st.width > 0);
  if (!pattern.length) return failed(prev, title, 'The panel needs at least one strip.');
  if (!(step.thickness > 0)) return failed(prev, title, 'The panel needs a thickness greater than zero.');
  const b = bbox(prev.slices.flatMap((sl) => sl.pieces));
  const period = pattern.reduce((w, st) => w + st.width, 0);
  const gaps = Math.max(1, prev.slices.length - 1);
  const tall = b.max[1] - b.min[1];
  const length = step.length ?? gaps * (tall + SECOND_KERF) + 2 * SECOND_TRIM;
  const strips: StripSpec[] = [];
  if (step.repeat !== undefined) {
    for (let r = 0; r < Math.max(1, Math.floor(step.repeat)); r++) strips.push(...pattern);
  } else {
    // Sizing itself: add strips in order, starting the pattern again as needed, and stop at the
    // first one that makes the panel wide enough. The last repeat need not be a whole one.
    const wanted = b.max[2] - b.min[2] + Math.max(0, step.extra);
    for (let n = 0, z = 0; z < wanted - 1e-9 && n < MAX_SLICES * 4; n++) {
      strips.push(pattern[n % pattern.length]);
      z += pattern[n % pattern.length].width;
    }
  }
  if (strips.length > MAX_SLICES * 4 || period <= 0) return failed(prev, title, 'That is too many strips.');
  const built = buildPanel(strips, length, step.thickness, names, 'Second panel');
  return stage('panel', [{ pieces: built.pieces }], title,
    `Set the ${prev.slices.length} slices aside, in order. Now a second panel: ${built.summary.charAt(0).toLowerCase()}${built.summary.slice(1)}`,
    { stock: built.stock, aside: prev.slices.map((sl) => ({ pieces: sl.pieces })) });
}

/**
 * Interleave: bring back the slices set aside and put one of the new slices after each of them
 * but the last, so the two kinds alternate with a set-aside slice at each end. Every slice keeps
 * its place along its length, the new ones moved as a set so that their edge A ends line up with
 * the others'. New slices beyond the number of gaps are left over.
 */
function combine(prev: Stage): Stage {
  const title = STEP_TITLES.combine;
  const aside = prev.aside;
  if (!aside?.length) return failed(prev, title, 'No slices are set aside. Add "Start another panel" before this.');
  const gaps = aside.length - 1;
  if (prev.slices.length < gaps) {
    return failed(prev, title, `${aside.length} slices set aside have ${gaps} gaps between them, and there are only ${prev.slices.length} new slices. Make the second panel longer.`);
  }
  const shift = bbox(aside.flatMap((sl) => sl.pieces)).min[2] - bbox(prev.slices.flatMap((sl) => sl.pieces)).min[2];
  const slices: Slice[] = [];
  aside.forEach((sl, i) => {
    slices.push({ pieces: sl.pieces });
    if (i < gaps) slices.push({ pieces: translate(prev.slices[i].pieces, [0, 0, shift]) });
  });
  const st = stage('slices', slices, title,
    `Bring back the ${aside.length} slices set aside and stand one of the new slices after each of the first ${gaps}, so the two kinds alternate and the row starts and ends with a set-aside slice. `
    + 'Line up all their ends at edge A.');
  if (prev.slices.length > gaps) st.warning = `${prev.slices.length - gaps} of the new slices ${prev.slices.length - gaps > 1 ? 'are' : 'is'} left over. Shorten the second panel to save the wood.`;
  return st;
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

/** Saw kerf allowed between slices when a patterned strip's own panel, or a border's, is cross cut. */
const PANEL_KERF = 0.125;
/** A layer thinner than this cannot be milled or glued at its thickness: it goes on thicker and is planed down. */
const TOO_THIN = 0.375;
/** What a too-thin layer is left over its finished thickness when it is glued on. */
const PLANE_OFF = 0.0625;

/**
 * Insert accent strips: put the step's stack of strips between the slices (and outside the end
 * ones, with `ends`). Each gap's stack is one slice, so later steps count it as one.
 *
 * A plain strip is one piece of one wood running the length of the slices. A patterned strip is
 * a slice of another glue-up: it is drawn as that panel's strips side by side along the gap,
 * starting `offset` in from edge A and, in every other gap, `stagger` further along. A strip of
 * that panel with `faces` is a plank with another wood on both faces, drawn as its three layers.
 * A patterned strip's wood is given the same grain direction as the slices it lies between,
 * because it is cut and turned the way they were.
 */
function insert(prev: Stage, step: Extract<Step, { type: 'insert' }>, names: Names): Stage {
  const title = STEP_TITLES.insert;
  const accents = accentStrips(step);
  if (accents.some((a) => !(a.thickness > 0))) return failed(prev, title, 'Accent strip thickness must be greater than zero.');
  if (accents.some((a) => a.pattern && !(a.pattern.every((s) => s.width > 0)))) return failed(prev, title, 'Every strip in a patterned strip needs a width greater than zero.');
  if (accents.some((a) => a.pattern?.some((s) => s.faces && !(s.faces.thickness > 0 && 2 * s.faces.thickness < a.thickness)))) {
    return failed(prev, title, 'The two faces of a plank must be thinner, together, than the strip they are in.');
  }
  const every = Math.max(1, Math.floor(step.every));
  const b = bbox(prev.slices.flatMap((s) => s.pieces));
  const grain = prev.slices[0]?.pieces[0]?.grain ?? [0, 0, 1];
  const stagger = step.stagger ?? 0;
  const slices: Slice[] = [];
  let count = 0;
  /** One more stack of the step's strips, as a slice of its own. */
  const stack = (): Slice => {
    let x = 0;
    const pieces: Piece[] = [];
    accents.forEach((a, k) => {
      if (!a.pattern) {
        pieces.push(box([x, 0, b.min[2]], [x + a.thickness, b.max[1], b.max[2]], a.species, [0, 0, 1], tone(1000 + count + 37 * k)));
      } else {
        // Lay the pattern along the gap from a whole repeat at or before edge A, and keep what
        // falls within the slices' length.
        const period = patternPeriod(a);
        const phase = ((((a.offset ?? 0) + (count % 2 ? stagger : 0)) % period) + period) % period;
        let z = b.min[2] + phase - (phase > 1e-9 ? period : 0);
        for (let n = 0; z < b.max[2] - 1e-9; n++) {
          const strip = a.pattern[n % a.pattern.length];
          const lo = Math.max(z, b.min[2]), hi = Math.min(z + strip.width, b.max[2]);
          if (hi - lo > 1e-9) {
            const shade = tone(2000 + n + 37 * k + 101 * count);
            const f = strip.faces;
            if (f) {
              pieces.push(box([x, 0, lo], [x + f.thickness, b.max[1], hi], f.species, grain, tone(3000 + n + 101 * count)));
              pieces.push(box([x + f.thickness, 0, lo], [x + a.thickness - f.thickness, b.max[1], hi], strip.species, grain, shade));
              pieces.push(box([x + a.thickness - f.thickness, 0, lo], [x + a.thickness, b.max[1], hi], f.species, grain, tone(4000 + n + 101 * count)));
            } else pieces.push(box([x, 0, lo], [x + a.thickness, b.max[1], hi], strip.species, grain, shade));
          }
          z += strip.width;
        }
      }
      x += a.thickness;
    });
    count++;
    return { pieces };
  };
  // With `ends` on, a stack also goes outside the first slice and outside the last.
  if (step.ends) slices.push(stack());
  prev.slices.forEach((s, i) => {
    slices.push({ pieces: s.pieces });
    if (i < prev.slices.length - 1 && (i + 1) % every === 0) slices.push(stack());
  });
  if (step.ends) slices.push(stack());
  if (slices.length > MAX_SLICES * 2) return failed(prev, title, 'Too many slices.');
  const width = b.max[1] - b.min[1], length = b.max[2] - b.min[2];
  const where = `after every ${every > 1 ? ordinal(every) + ' ' : ''}slice${step.ends ? ', and on the outside of the first and last slice' : ''}`;
  const plain = accents.filter((a) => !a.pattern);
  // Strips of the same wood and thickness are one line of stock, however many are in a gap.
  const stock: StockLine[] = [];
  if (count) {
    for (const a of plain) {
      const same = stock.find((l) => l.species === a.species && Math.abs(l.thickness - a.thickness) < 1e-9 && l.width === width);
      if (same) same.count += count;
      else stock.push({ species: a.species, count, thickness: a.thickness, width, length, use: 'Second glue-up: between the cross-cut slices' });
    }
  }
  if (plain.length === accents.length) {
    const summary = accents.length === 1
      ? `Mill ${count} ${names(step.species)} strips ${inches(step.thickness)} × ${inches(width)} × ${inches(length)} and place one ${where}.`
      : `Mill strips ${inches(width)} × ${inches(length)}: ${stock.map((l) => `${l.count} ${names(l.species)} ${inches(l.thickness)} thick`).join(', ')}. `
        + `Place a stack of ${accents.length} ${where}, in this order: ${accents.map((a) => `${names(a.species)} ${inches(a.thickness)}`).join(', ')}.`;
    return stage('slices', slices, title, summary, { stock });
  }

  // Patterned strips. Each different one is a panel of its own: wide enough to cover the slices
  // (and the slide of every other one), and long enough to cross cut one slice for every gap.
  const panels: { strip: AccentStrip; uses: number; letter: string }[] = [];
  const letters = accents.map((a) => {
    if (!a.pattern) return '';
    const key = JSON.stringify([a.thickness, a.pattern, a.offset ?? 0]);
    let panel = panels.find((p) => JSON.stringify([p.strip.thickness, p.strip.pattern, p.strip.offset ?? 0]) === key);
    if (!panel) panels.push(panel = { strip: a, uses: 0, letter: String.fromCharCode(65 + panels.length) });
    panel.uses++;
    return panel.letter;
  });
  const panelWidth = length + stagger;
  const panelLength = count * (width + PANEL_KERF) + 0.5;
  const single = panels.length === 1 && accents.length === 1;
  /** Add to a stock line that matches, or start a new one. */
  const need = (line: StockLine) => {
    const same = stock.find((l) => l.use === line.use && l.species === line.species && Math.abs(l.width - line.width) < 1e-9 && Math.abs(l.thickness - line.thickness) < 1e-9);
    if (same) same.count += line.count;
    else stock.push(line);
  };
  const describe = panels.map(({ strip, uses, letter }) => {
    const name = single ? 'the panel' : `panel ${letter}`;
    const period = patternPeriod(strip);
    const repeats = Math.ceil(panelWidth / period - 1e-9);
    const n = repeats * uses;
    // A panel too thin to glue up is made thicker and planed once it is glued to its neighbour.
    const thin = strip.thickness < TOO_THIN && !single;
    const milled = thin ? 0.75 : strip.thickness;
    const use = `${single ? 'Panel' : `Panel ${letter}`} for the strips between the slices${uses > 1 ? ` (${uses} panels)` : ''}`;
    const planks: string[] = [];
    for (const st of strip.pattern!) {
      if (!st.faces) {
        need({ species: st.species, count: n, thickness: milled, width: st.width, length: panelLength, use: thin ? `${use}; planed to ${inches(strip.thickness)} after it is glued on` : use });
        continue;
      }
      const f = st.faces, core = strip.thickness - 2 * f.thickness;
      const glued = f.thickness < TOO_THIN ? f.thickness + PLANE_OFF : f.thickness;
      need({ species: st.species, count: n, thickness: core, width: st.width, length: panelLength, use: `${use}: the planks` });
      need({
        species: f.species, count: 2 * n, thickness: glued, width: st.width, length: panelLength,
        use: `${use}: a face on each side of a plank${glued > f.thickness ? `, planed to ${inches(f.thickness)} once glued on` : ''}`,
      });
      planks.push(`${n} ${names(st.species)} planks ${inches(core)} × ${inches(st.width)} × ${inches(panelLength)}, each with a ${names(f.species)} face `
        + `${inches(glued)} thick glued to both sides${glued > f.thickness ? `; when the glue has set, plane each face down to ${inches(f.thickness)}` : ''}, `
        + `which leaves the plank ${inches(strip.thickness)} thick`);
    }
    const start = (((strip.offset ?? 0) % period) + period) % period;
    const order = strip.pattern!.map((st) => `${st.faces ? 'a faced plank' : names(st.species)} ${inches(st.width)}`).join(', ');
    return (planks.length ? `For ${name}, first make ${planks.join('; and ')}. Then glue up ${name}` : `Glue up ${name}`)
      + `${uses > 1 ? ` (make ${uses})` : ''}, ${inches(milled)} thick`
      + `${thin ? ` (it finishes ${inches(strip.thickness)}, but cannot be glued up that thin)` : ''}, edge to edge in this order: ${order}, repeated ${repeats} times, `
      + `to about ${inches(panelWidth)} wide. Measured from edge A of the slices, its first strip starts ${start > 1e-9 ? `${inches(start)} in` : 'at the edge'}`;
  });
  const order = accents.map((a, k) => letters[k] ? `panel ${letters[k]}` : `${names(a.species)} ${inches(a.thickness)}`).join(', ');
  const anyThin = panels.some((p) => p.strip.thickness < TOO_THIN) && !single;
  const summary = `The strips between the slices are cut from ${panels.length === 1 ? 'one more glue-up' : `${panels.length} more glue-ups`}, `
    + `made like the first with strips ${inches(panelLength)} long. ${describe.join('. ')}. `
    + (single
      ? `Flatten it, square one end, and cross cut it into ${count} slices ${inches(width)} wide (kerf ${inches(PANEL_KERF)}). `
      : `Glue the panels face to face in this order: ${order}, with each one's first strip where its measurement puts it. `
        + (anyThin ? 'Plane each thin panel down to its finished thickness once the glue has set. ' : '')
        + `Flatten the stack, square one end, and cross cut it into ${count} slices ${inches(width)} wide (kerf ${inches(PANEL_KERF)}). `)
    + `Stand each one the same way up as the slices already cut and place one ${where}`
    + (stagger ? `, sliding every other one ${inches(stagger)} along towards edge B so the pattern alternates. Let the ends overhang; they are trimmed after the glue-up.` : '.');
  return stage('slices', slices, title, summary, { stock });
}

/**
 * Add a border: glue a frame round the panel, with an optional thin line between the panel and
 * the frame. The two ends go on first, as wide as the panel; the two long sides then cover the
 * ends of those as well. The frame is drawn as blocks about `block` long. On an end-grain panel
 * the frame is end grain too, so it moves with the board: each side is a slice cross cut from a
 * panel of its own and stood on end. On a face-grain panel each side is one strip, grain along it.
 */
function frame(prev: Stage, step: Extract<Step, { type: 'frame' }>, names: Names): Stage {
  const title = STEP_TITLES.frame;
  if (!(step.width > 0)) return failed(prev, title, 'The border needs a width greater than zero.');
  const [sx, sy, sz] = prev.size;
  const w = step.width, lt = Math.max(0, step.line);
  const end = endGrainUp(prev.slices[0].pieces);
  const pieces: Piece[] = [...prev.slices[0].pieces];
  const x0 = -lt - w, x1 = sx + lt + w;
  /** How many blocks make up a side this long, and how long each is. */
  const blocks = (span: number) => {
    const n = end ? Math.max(1, Math.round(span / Math.max(step.block, 0.5))) : 1;
    return { n, each: span / n };
  };
  const ends = blocks(sz), sides = blocks(x1 - x0);
  let shade = 5000;
  for (const [lineAt, frameAt] of [[-lt, -lt - w], [sx, sx + lt]]) {
    if (lt) pieces.push(box([lineAt, 0, 0], [lineAt + lt, sy, sz], step.lineSpecies, [0, 0, 1], tone(shade++)));
    for (let i = 0; i < ends.n; i++) {
      pieces.push(box([frameAt, 0, i * ends.each], [frameAt + w, sy, (i + 1) * ends.each], step.species, end ? [0, 1, 0] : [0, 0, 1], tone(shade++)));
    }
  }
  for (const [lineAt, frameAt] of [[-lt, -lt - w], [sz, sz + lt]]) {
    if (lt) pieces.push(box([x0, 0, lineAt], [x1, sy, lineAt + lt], step.lineSpecies, [1, 0, 0], tone(shade++)));
    for (let i = 0; i < sides.n; i++) {
      pieces.push(box([x0 + i * sides.each, 0, frameAt], [x0 + (i + 1) * sides.each, sy, frameAt + w], step.species, end ? [0, 1, 0] : [1, 0, 0], tone(shade++)));
    }
  }
  const stock: StockLine[] = [];
  const long = x1 - x0;
  let how: string;
  if (end) {
    // Two slices, one for each end or side, cross cut from a panel as thick as the border is wide.
    const length = 2 * (sy + PANEL_KERF) + 0.5;
    stock.push({ species: step.species, count: ends.n, thickness: w, width: ends.each, length, use: 'Border: the panel the two end pieces are cut from' });
    stock.push({ species: step.species, count: sides.n, thickness: w, width: sides.each, length, use: 'Border: the panel the two side pieces are cut from' });
    how = `The border is end grain like the board, so it moves with it. Glue up two ${names(step.species)} panels ${inches(w)} thick and ${inches(length)} long: `
      + `one ${inches(sz)} wide from ${ends.n} strips ${inches(ends.each)} wide, and one ${inches(long)} wide from ${sides.n} strips ${inches(sides.each)} wide. `
      + `Cross cut two slices ${inches(sy)} wide from each (kerf ${inches(PANEL_KERF)}) and stand them end grain up: those are the two end pieces and the two side pieces. `;
  } else {
    stock.push({ species: step.species, count: 2, thickness: sy, width: w, length: sz, use: 'Border: the two end pieces' });
    stock.push({ species: step.species, count: 2, thickness: sy, width: w, length: long, use: 'Border: the two side pieces' });
    how = `Mill four ${names(step.species)} border pieces ${inches(sy)} thick and ${inches(w)} wide: two ${inches(sz)} long for the ends and two ${inches(long)} long for the sides. `;
  }
  if (lt) {
    stock.push({ species: step.lineSpecies, count: 2, thickness: lt, width: sy, length: sz, use: 'Border: the line at each end' });
    stock.push({ species: step.lineSpecies, count: 2, thickness: lt, width: sy, length: long, use: 'Border: the line along each side' });
    how += `Mill four ${names(step.lineSpecies)} lines ${inches(lt)} × ${inches(sy)}: two ${inches(sz)} long and two ${inches(long)} long. `;
  }
  const each = lt ? 'a line and then a border piece' : 'a border piece';
  return stage('panel', [{ pieces: toOrigin(pieces) }], title,
    `${how}Glue ${each} to each end of the board, flush with its long edges. When that has set, glue ${each} along each long edge, covering the ends of the first two. `
    + 'Leave the border a hair proud of both faces; the next flattening brings it level.',
    { stock });
}

const NEEDS_PANEL: Step['type'][] = ['crosscut', 'trim', 'flatten', 'rotate', 'frame'];
// 'panel' and 'combine' work on loose slices, like the rest.

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
  frame: 'Add a border',
  panel: 'Start another panel',
  combine: 'Interleave the slices',
};

/**
 * Run one step on the previous stage and return the new stage. Never throws: a step that cannot
 * run returns a stage with an error. Slices set aside are carried through every step untouched,
 * until "Interleave the slices" uses them up.
 */
export function applyStep(prev: Stage, step: Step, names: Names): Stage {
  const out = applyOne(prev, step, names);
  if (prev.aside && !out.aside && (step.type !== 'combine' || out.error)) out.aside = prev.aside;
  return out;
}

/** The step itself, without the carrying of set-aside slices that applyStep adds. */
function applyOne(prev: Stage, step: Step, names: Names): Stage {
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
      return arrange(prev, step.sel, title, step.amount < 0 ? `Slide ${inches(-step.amount)} along its length, towards edge A:` : `Slide ${inches(step.amount)} along its length:`, (pieces) => ({
        pieces: translate(pieces, [0, 0, step.amount]),
        motion: { axis: null, angle: 0, shift: step.amount },
      }));
    case 'insert':
      return insert(prev, step, names);
    case 'frame':
      return frame(prev, step, names);
    case 'panel':
      return anotherPanel(prev, step, names);
    case 'combine':
      return combine(prev);
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
    // A border is a glue-up too: it never goes on perfectly level with the faces.
    else if (step.type === 'glue' || step.type === 'frame' || step.type === 'panel') flat = false;
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
