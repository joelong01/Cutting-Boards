import {
  bbox, box, boxCenter, boxSize, clipAxis, rotateY, rotateZ, toOrigin, translate, volume,
} from './geometry';
import { accentStrips, patternPeriod } from './accent';
import { blockBoards, blockLogs, blockRow, blockSide, blockStrips, boardWidth, post } from './blocks';
import { FEET } from './species';
import { NO_FINISH, finishPanel } from './finish';
import { inches } from './fractions';
import type { AccentStrip, Finish, FinishPart, Layup, Piece, Selector, Slice, Stage, Step, StockLine, StripSpec, Vec3 } from './types';

/**
 * The primitive actions: the things that are actually done to wood at the bench. Each one is a
 * pure function from the state of the work (a Stage: one glued panel or a row of loose slices,
 * plus any slices set aside) to its state afterwards, with the sentence that tells a person how
 * to do it and the stock it needs. `ACTIONS` at the foot of this file is the whole list.
 *
 * Nothing here knows about boards, patterns or grain. A step of a design (see pipeline.ts) is
 * one or more of these in a row, and a design is a list of steps: "Turn to end grain" is a
 * `rotate` of 90° about a slice's length, "Flip" is a `rotate` of 180°, "Start another panel" is
 * `setAside`, `rip`, `glue`. Every sentence of the instructions is written by the action that does
 * the work it describes; a step only puts its actions' sentences one after another. Whether a board is end grain or edge grain is not stored anywhere: it
 * follows from whether its steps stand the slices up.
 */
export type Action =
  /**
   * Rip and mill the strips for a glue-up: the blanks. `strips` is the pattern; it is repeated
   * `repeat` times (and closed with its first strip again, with `closeWithFirst`), each strip
   * `thickness` thick and `length` long. With slices set aside and no `repeat` or `length`, the
   * strips are sized to them: enough to make a panel as wide as those slices are long plus
   * `extra`, and long enough to cross cut one slice for each gap between them. With `blocks` the
   * strips are the three woods of a 3D board, ripped to a diamond section (see `diamondStrips`).
   */
  | {
    type: 'rip'; strips: StripSpec[]; thickness: number; length?: number; repeat?: number; closeWithFirst?: boolean; extra?: number; blocks?: Layup['blocks'];
    /** The saw kerf, where the stock has to allow for cuts to come: the boards of an end-grain 3D board, and a second panel that sizes itself. */
    kerf?: number;
    /** These are for a second panel: the loose slices on the bench are set aside first, in order. */
    second?: boolean;
    /** Leave a plank and the two faces it gets as separate pieces, to be glued by `glueFaces`. */
    loose?: boolean;
  }
  /** Glue a face of another wood to both sides of each plank that was milled to take one. */
  | { type: 'glueFaces' }
  /** Put the loose slices to one side, in order, leaving the bench clear. */
  | { type: 'setAside' }
  /** Bring back the slices set aside and put one of the slices on the bench after each. */
  | { type: 'interleave' }
  /**
   * Saw a panel across into slices `width` wide, the blade `angle` degrees off square, losing
   * `kerf` between them. With `blade`, the blade is thinner than that: each cut is sawing out a
   * spacer `kerf` wide and takes more than one pass.
   */
  | { type: 'crosscut'; width: number; kerf: number; angle: number; blade?: number }
  /**
   * Turn wood by `angle` degrees. With `sel`, each chosen slice turns about its own middle: about
   * `z`, its length (90° rolls it onto its side, 180° lays it face down), or about `y`, the
   * upright (180° turns it end for end). Without `sel`, the whole panel turns on the bench.
   */
  | { type: 'rotate'; axis: 'y' | 'z'; angle: number; sel?: Selector }
  /** Slide the chosen slices `amount` along their length; negative is towards edge A. */
  | { type: 'shift'; sel: Selector; amount: number }
  /** Mill the strips an "Insert accent strips" step puts between the slices, and lay them beside the slices. `spec` is the step that describes them. */
  | { type: 'millAccents'; spec: Extract<Step, { type: 'insert' }> }
  /** Put a stack of those strips between the slices. `spec` is the step that describes them. */
  | { type: 'addStrips'; spec: Extract<Step, { type: 'insert' }> }
  /** Mill the pieces of a border for a panel, and lay them beside it. `spec` is the step that describes it, and `grid` the design's rounding step, which the stock is milled on. */
  | { type: 'millBorder'; spec: Extract<Step, { type: 'frame' }>; grid?: number }
  /** Glue the strips milled for an end-grain border into its two small panels. Nothing to do for a border of single strips. */
  | { type: 'borderPanels' }
  /** Cross cut those panels into the border's pieces and stand them on end. Nothing to do for a border of single strips. */
  | { type: 'borderCut' }
  /** Glue the border's two end pieces to the panel. */
  | { type: 'borderEnds' }
  /** Glue the border's two side pieces on, covering the ends of the first two. */
  | { type: 'borderSides' }
  /** Glue what is on the bench into one panel: ripped strips edge to edge, or cross-cut slices face to face. */
  | { type: 'glue' }
  /** Saw the edges and ends of a panel straight; `auto` first takes off whatever is ragged. */
  | { type: 'trim'; auto: boolean; x0: number; x1: number; z0: number; z1: number }
  /** Take `top` and `bottom` off the faces of a panel. */
  | { type: 'flatten'; top: number; bottom: number }
  /** Saw a panel lengthways into strips `width` wide, and turn them to lie across the bench as slices. */
  | { type: 'ripPanel'; width: number; kerf: number; tilt?: number }
  /** Round the four corners of the finished panel, seen from above, to `radius`. */
  | { type: 'roundCorners'; radius: number }
  /** Cut a 45° chamfer `size` wide round the bottom edges. */
  | { type: 'chamfer'; size: number }
  /** Round over the top edges with a bit of `radius`. */
  | { type: 'roundOver'; radius: number }
  /**
   * Make the template the router runs round to cut the juice groove and stick it on the board.
   * `groove` is the groove it is for, which sets where it goes. Nothing is cut.
   */
  | { type: 'grooveTemplate'; stripWidth: number; thickness: number; groove: Omit<Finish['groove'], 'on'> }
  /** Rout a juice groove round the top. See `Finish.groove` for what each number is. */
  | { type: 'groove'; inset: number; width: number; depth: number; cornerRadius: number; align: boolean }
  /** Screw a round foot under each corner: `diameter` across, `height` tall, its centre `inset` in from both edges. Nothing is cut. */
  | { type: 'addFeet'; diameter: number; height: number; inset: number }
  /** Sand and oil the board. Nothing is cut. */
  | { type: 'sand' };

export type ActionType = Action['type'];

/** What each action is called when it is run on its own. A step gives its stage its own title. */
const TITLES: Record<ActionType, string> = {
  rip: 'Rip the strips',
  addFeet: 'Add the feet',
  glueFaces: 'Glue the faces on',
  setAside: 'Set the slices aside',
  interleave: 'Interleave the slices',
  crosscut: 'Cross cut',
  rotate: 'Turn',
  shift: 'Offset',
  millAccents: 'Mill the accent strips',
  addStrips: 'Insert accent strips',
  millBorder: 'Mill the border',
  borderPanels: 'Glue up the border panels',
  borderCut: 'Cut the border pieces',
  borderEnds: 'Glue on the border ends',
  borderSides: 'Glue on the border sides',
  glue: 'Glue up',
  trim: 'Trim',
  flatten: 'Flatten',
  ripPanel: 'Rip the panel',
  roundCorners: 'Round the corners',
  chamfer: 'Chamfer the bottom edges',
  roundOver: 'Round over the top edges',
  grooveTemplate: 'Juice groove template',
  groove: 'Juice groove',
  sand: 'Sand and oil',
};

export type Names = (speciesId: string) => string;

const MAX_SLICES = 300;
/** Repeatable pseudo-random number in [0, 1) for strip i, so a strip keeps its shade between runs. */
const tone = (i: number) => {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** The full strip sequence across the panel: the pattern repeated, plus the closing strip if asked for. Zero-width strips are dropped. */
export function expandStrips(layup: Pick<Layup, 'strips' | 'repeat' | 'closeWithFirst'>): StripSpec[] {
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
export function failed(prev: Stage, title: string, error: string): Stage {
  return {
    ...prev,
    slices: prev.slices.map((s) => ({ pieces: s.pieces })),
    title, summary: '', error, warning: undefined, stock: undefined,
  };
}

/**
 * The strips for a glue-up: one slice per strip, lying side by side across Z (three pieces,
 * stacked, for a strip with a wood glued to both faces), with the stock list and the sentence
 * that says how to mill them. `which` names the panel in the stock list, "First glue-up" or
 * "Second panel".
 */
function buildStrips(strips: StripSpec[], length: number, thickness: number, names: Names, which: string, loose = false): { slices: Slice[]; stock: StockLine[]; summary: string; faced?: Stage['faced'] } {
  const slices: Slice[] = [];
  // The same strips with each plank and its two faces lying apart, side by side, before they are glued.
  const apart: Slice[] = [];
  let z = 0, zApart = 0;
  strips.forEach((s, i) => {
    const pieces: Piece[] = [];
    const f = s.faces && s.faces.thickness > 0 && 2 * s.faces.thickness < thickness ? s.faces : undefined;
    if (f) {
      apart.push({ pieces: [box([0, 0, zApart], [length, f.thickness, zApart + s.width], f.species, [1, 0, 0], tone(500 + i))] });
      apart.push({ pieces: [box([0, 0, zApart + s.width], [length, thickness - 2 * f.thickness, zApart + 2 * s.width], s.species, [1, 0, 0], tone(i))] });
      apart.push({ pieces: [box([0, 0, zApart + 2 * s.width], [length, f.thickness, zApart + 3 * s.width], f.species, [1, 0, 0], tone(700 + i))] });
      zApart += 3 * s.width;
    } else {
      apart.push({ pieces: [box([0, 0, zApart], [length, thickness, zApart + s.width], s.species, [1, 0, 0], tone(i))] });
      zApart += s.width;
    }
    if (f) {
      pieces.push(box([0, 0, z], [length, f.thickness, z + s.width], f.species, [1, 0, 0], tone(500 + i)));
      pieces.push(box([0, f.thickness, z], [length, thickness - f.thickness, z + s.width], s.species, [1, 0, 0], tone(i)));
      pieces.push(box([0, thickness - f.thickness, z], [length, thickness, z + s.width], f.species, [1, 0, 0], tone(700 + i)));
    } else pieces.push(box([0, 0, z], [length, thickness, z + s.width], s.species, [1, 0, 0], tone(i)));
    slices.push({ pieces });
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
  // One entry per size to be milled, each saying how many of which wood at which width.
  const parts = [
    ...plain.map((l) => `${l.count} ${names(l.species)} strip${l.count > 1 ? 's' : ''} ${inches(l.width)} wide`),
    ...[...faced.values()].map(({ strip, count }) => `${count} faced plank${count > 1 ? 's' : ''} ${inches(strip.width)} wide`),
  ];
  const common = `${inches(thickness)} thick and ${inches(length)} long`;
  // A single size is one plain sentence; several are counted out, so it is plain there is more than one setup.
  const mill = parts.length === 1
    ? `Mill ${parts[0]}, ${common}.`
    : `Mill ${strips.length} strips in ${parts.length} sizes, all ${common}: ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
  if (loose && faced.size) {
    // Milling and gluing the faces on are two operations: say only the milling here.
    const pieces = [...faced.values()].map(({ strip, count }) =>
      `${count} ${names(strip.species)} plank${count > 1 ? 's' : ''} ${inches(thickness - 2 * strip.faces!.thickness)} thick and ${2 * count} ${names(strip.faces!.species)} face strips ${inches(strip.faces!.thickness)} thick, all ${inches(strip.width)} wide`);
    const plainMill = plain.length ? ` Also mill ${plain.map((l) => `${l.count} ${names(l.species)} strip${l.count > 1 ? 's' : ''} ${inches(l.width)} wide`).join(', ')}, ${inches(thickness)} thick.` : '';
    const glueOn = [...faced.values()].map(({ strip, count }) =>
      `Glue a ${names(strip.faces!.species)} face to both sides of ${count > 1 ? `each of the ${count} ${names(strip.species)} planks` : `the ${names(strip.species)} plank`}`).join('. ');
    return {
      slices: apart, stock,
      summary: `Mill ${pieces.join(', and ')}, ${inches(length)} long.${plainMill}`,
      faced: { slices, summary: `${glueOn}. Each then counts as one strip ${inches(thickness)} thick.` },
    };
  }
  const summary = (planks.length ? `First make ${planks.join(', and ')}, ${inches(length)} long; each then counts as one strip ${inches(thickness)} thick. ` : '')
    + mill;
  return { slices, stock, summary };
}

/** The name of the stage that mills a second panel's pieces. */
const SECOND_TITLE = 'Mill the second panel';

/**
 * Glue a face of another wood to both sides of each plank milled to take one, which turns the
 * planks and loose faces on the bench into the strips the panel is glued up from.
 */
function glueFaces(prev: Stage): Stage {
  const title = TITLES.glueFaces;
  if (prev.kind !== 'strips' || !prev.faced) return failed(prev, title, 'There are no planks waiting for faces.');
  return stage('strips', prev.faced.slices, title, prev.faced.summary);
}

/** Saw kerf, when the design does not set one, and end trim allowed for when a second panel works out its own length. */
const SECOND_KERF = 0.125, SECOND_TRIM = 0.25;


/**
 * The first step of an end-grain 3D board (the face-grain one starts from ordinary strips): one
 * board of each wood, milled square and wide enough to rip `repeat` diamond strips from (see
 * `bevelRip`). The stage carries `block`, so that the steps after it know what they are working
 * on, and the stock is one line for each wood.
 */
function diamondStrips(prev: Stage, a: Extract<Action, { type: 'rip' }>, names: Names): Stage {
  const title = BOARDS_TITLE;
  const woods = a.strips.slice(0, 3).map((st) => st.species);
  const { along, across } = a.blocks!;
  const length = a.length ?? 0, logs = Math.floor(a.repeat ?? 1);
  if (woods.length < 3) return failed(prev, title, 'A 3D board needs three woods, one for each face of its blocks.');
  if (!(a.thickness > 0) || !(length > 0)) return failed(prev, title, 'The strips need a thickness and a length greater than zero.');
  if (!(logs >= 1 && along >= 1 && across >= 1) || along * across > MAX_SLICES || logs > MAX_SLICES) return failed(prev, title, 'That is too many blocks. Rip the strips from thicker boards.');
  const list = woods.map(names);
  // End grain on top: one board of each wood, milled square, wide enough to rip its strips from.
  // Wide enough for the strips, a kerf for each cut, and the corner the first slanted cut wastes.
  const width = boardWidth(blockSide(a.thickness), logs, a.kerf);
  const stock: StockLine[] = woods.map((species) => ({ species, count: 1, thickness: a.thickness, width, length, use: 'A board, milled square' }));
  return stage('strips', blockBoards(woods, a.thickness, width, length, tone).map((piece) => ({ pieces: [piece] })), title,
    `Mill a board of each wood ${inches(a.thickness)} thick, ${inches(width)} wide and ${inches(length)} long: ${list.slice(0, -1).join(', ')} and ${list.at(-1)}. `
    + 'Plane all three to the same thickness in one session.',
    { stock, block: { woods, thickness: a.thickness, along, across, count: logs } });
}

/**
 * Rip the boards of an end-grain 3D board into its strips, with the blade tilted 30°, so each is
 * a diamond in cross-section. The stage shows the strips lying side by side as they come off the
 * saw, one slice a strip, and marks the work as ripped so that it can be glued into logs.
 */
function bevelRip(prev: Stage, a: Extract<Action, { type: 'ripPanel' }>, title: string): Stage {
  // Three strips close into a hexagon only when each is a diamond with 60° corners, which is a
  // 30° tilt. At any other tilt the logs, the row and the block that follow could not be made.
  if (a.tilt !== BEVEL_TILT) {
    return failed(prev, title, `A 3D board's strips are ripped with the blade tilted ${BEVEL_TILT}°: that is what makes diamonds, three of which close into a hexagon. At ${a.tilt}° they would not. Set the tilt to ${BEVEL_TILT}°.`);
  }
  const { woods, thickness, count = 1 } = prev.block!;
  const side = blockSide(thickness);
  return stage('strips', blockStrips(woods, thickness, prev.size[0], count, tone).map((piece) => ({ pieces: [piece] })), title,
    `Tilt the table saw blade ${a.tilt}° and rip ${count} strip${count > 1 ? 's' : ''} from each board, every one a diamond in cross-section: `
    + `the two sawn faces slope at 60° and are as wide as the top and bottom, about ${inches(Math.round(side * 32) / 32)}. `
    + 'Test the setup on scrap first: three strips must close into a hexagon with no gap.',
    { block: { ...prev.block!, ripped: true } });
}

/**
 * Rip and mill the strips for a glue-up, and lay them out in order. On a clear bench with nothing
 * set aside these are the strips of the first glue-up: the pattern repeated as asked. With slices
 * set aside they are for a second panel, and left to size themselves there are enough, added in
 * order, to make it as wide as those slices are long plus the action's extra; and they are long
 * enough to square both ends and cross cut one slice, as wide as the set-aside slices are tall,
 * for each gap between them.
 */
function rip(prev: Stage, a: Extract<Action, { type: 'rip' }>, names: Names): Stage {
  const title = a.second ? SECOND_TITLE : TITLES.rip;
  // For a second panel the slices on the bench go to one side first, which clears it for the new strips.
  const clearing = !!a.second && !prev.aside && prev.kind === 'slices';
  const aside = clearing ? prev.slices.map((sl) => ({ pieces: sl.pieces })) : prev.aside;
  if (a.second && !aside) return failed(prev, title, 'A second panel starts from loose slices, which are set aside while it is made.');
  // Only one set can be aside at a time: the slices on the bench would have nowhere to go.
  if (a.second && prev.aside && prev.slices.some((sl) => sl.pieces.length)) return failed(prev, title, 'There are already slices set aside. Interleave them before starting another panel.');
  if (!aside && a.blocks) return diamondStrips(prev, a, names);
  if (!aside) {
    const strips = expandStrips({ strips: a.strips, repeat: a.repeat ?? 1, closeWithFirst: !!a.closeWithFirst });
    const built = buildStrips(strips, a.length ?? 0, a.thickness, names, 'First glue-up');
    return stage('strips', built.slices, title, strips.length ? built.summary : 'Add at least one strip.', {
      stock: built.stock, error: strips.length ? undefined : 'The layup has no strips.',
    });
  }
  const pattern = a.strips.filter((st) => st.width > 0);
  if (!pattern.length) return failed(prev, title, 'The panel needs at least one strip.');
  if (!(a.thickness > 0)) return failed(prev, title, 'The panel needs a thickness greater than zero.');
  const b = bbox(aside.flatMap((sl) => sl.pieces));
  const period = pattern.reduce((w, st) => w + st.width, 0);
  const gaps = Math.max(1, aside.length - 1);
  const tall = b.max[1] - b.min[1];
  // A slice for each gap, with the kerf of the saw in use between them.
  const length = a.length ?? gaps * (tall + (a.kerf ?? SECOND_KERF)) + 2 * SECOND_TRIM;
  const strips: StripSpec[] = [];
  if (a.repeat !== undefined) {
    for (let r = 0; r < Math.max(1, Math.floor(a.repeat)); r++) strips.push(...pattern);
  } else {
    // Sizing itself: add strips in order, starting the pattern again as needed, and stop at the
    // first one that makes the panel wide enough. The last repeat need not be a whole one.
    const wanted = b.max[2] - b.min[2] + Math.max(0, a.extra ?? 0);
    for (let n = 0, z = 0; z < wanted - 1e-9 && n < MAX_SLICES * 4; n++) {
      strips.push(pattern[n % pattern.length]);
      z += pattern[n % pattern.length].width;
    }
  }
  if (strips.length > MAX_SLICES * 4 || period <= 0) return failed(prev, title, 'That is too many strips.');
  const built = buildStrips(strips, length, a.thickness, names, 'Second panel', a.loose);
  return stage('strips', built.slices, title,
    (clearing ? `Set the ${aside.length} slices aside, in order. ` : '') + `Now a second panel: ${built.summary.charAt(0).toLowerCase()}${built.summary.slice(1)}`,
    { stock: built.stock, faced: built.faced, ...(clearing ? { aside } : {}) });
}

/** Put the loose slices to one side, in order. The bench is left clear for another panel. */
function setAside(prev: Stage): Stage {
  const title = TITLES.setAside;
  if (prev.aside) return failed(prev, title, 'There are already slices set aside. Interleave them before starting another panel.');
  return {
    kind: 'slices', slices: [], size: [0, 0, 0], title,
    summary: `Set the ${prev.slices.length} slices aside, in order.`,
    aside: prev.slices.map((sl) => ({ pieces: sl.pieces })),
  };
}

/**
 * Interleave: bring back the slices set aside and put one of the new slices after each of them
 * but the last, so the two kinds alternate with a set-aside slice at each end. Every slice keeps
 * its place along its length, the new ones moved as a set so that their edge A ends line up with
 * the others'. New slices beyond the number of gaps are left over.
 */
function interleave(prev: Stage): Stage {
  const title = TITLES.interleave;
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
function crosscut(prev: Stage, step: Extract<Action, { type: 'crosscut' }>): Stage {
  const title = TITLES.crosscut;
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
  // Where along the turned panel each slice was cut from: the middle of its width.
  const middles: number[] = [];
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
    if (cut.length) {
      slices.push({ pieces: cut });
      middles.push(start + step.width / 2);
    }
  }
  let dropped = 0;
  if (angle) {
    // The two ends of an angled cut give corners and short slices; keep the full-length slices
    // and line them up, as you would on the bench.
    const vols = slices.map((s) => s.pieces.reduce((v, p) => v + volume(p), 0));
    // A full slice runs from one long edge of the panel to the other. The measure is that, not
    // the biggest slice there happens to be: a panel too short for its width has no full slice at
    // all, only corners, and must not pass for a board.
    const whole = boxSize(bbox(prev.slices[0].pieces));
    const most = (step.width * whole[1] * whole[2]) / Math.cos(angle);
    // Only whole slices are used. One from near an end of the panel is sawn short at one end: it
    // could be lined up and used, but then the board is only as wide as the shortest of them, and
    // it takes more wood, not less, than cutting a longer panel into slices that are all alike.
    const keep = slices.map((_, i) => vols[i] >= 0.999 * most);
    dropped = keep.filter((k) => !k).length;
    if (dropped === slices.length) {
      return failed(prev, title, `The panel is too short to cut at ${step.angle}°: no slice reaches from one long edge to the other. Make the stock longer.`);
    }
    // Lined up means the stripes of one slice in line with the next one's, and what fixes a
    // stripe's place along a slice is the panel's long edges, which run with the stripes: so each
    // slice is centred on the point midway between where those two edges cross it. A full slice's
    // own middle is that point. A slice from near an end of the panel has one end sawn short, and
    // centring it on its own middle would slide its stripes out of line with its neighbours'.
    const edges = bbox(prev.slices[0].pieces);
    // The ends of the two long edges, turned the way the panel was, give the line each edge lies on.
    const corners: Vec3[] = [[edges.min[0], 0, edges.min[2]], [edges.max[0], 0, edges.min[2]], [edges.min[0], 0, edges.max[2]], [edges.max[0], 0, edges.max[2]]];
    const [a0, a1, b0, b1] = rotateY([{ species: '', grain: [1, 0, 0], tone: 0, faces: [corners] }], angle, [0, 0, 0])[0].faces[0];
    /** Where the line through two points is, along Z, at this X. */
    const on = (p: Vec3, q: Vec3, x: number) => p[2] + ((q[2] - p[2]) * (x - p[0])) / (q[0] - p[0]);
    const midway = (x: number) => (on(a0, a1, x) + on(b0, b1, x)) / 2;
    slices = slices
      .map((s, i) => ({ pieces: translate(s.pieces, [0, 0, -midway(middles[i])]) }))
      .filter((_, i) => keep[i]);
  }
  if (!slices.length) return failed(prev, title, 'The panel is shorter than one slice.');
  // The row of logs of a 3D board: each slice is a whole row of the pattern.
  let summary = prev.block
    ? `Cross cut the row of logs into ${slices.length} slices ${inches(step.width)} long (kerf ${inches(kerf)}). Use a stop block so they are all the same length.`
    : `Cross cut the panel into ${slices.length} slices, each ${inches(step.width)} wide`
      + (step.angle ? `, with the blade at ${step.angle}° to square` : '')
      // A spacer wider than the blade comes out in more than one pass.
      + (step.blade && kerf > step.blade + 1e-9
        ? `, sawing out the ${inches(kerf)} spacer between each pair in ${Math.ceil(kerf / step.blade - 1e-9)} passes of the blade (kerf ${inches(step.blade)}).`
        : ` (kerf ${inches(kerf)}).`);
  if (offcut > 1e-6) summary += ` The last ${inches(offcut)} is an offcut.`;
  if (dropped) summary += ` ${dropped} short corner piece${dropped > 1 ? 's are' : ' is'} waste.`;
  return stage('slices', slices, title, summary);
}

/** Apply one move (turn, flip or slide) to the selected slices and leave the rest alone, recording the motion for animation. */
function arrange(
  prev: Stage, sel: Selector, title: string, verb: string, how: string,
  move: (pieces: Piece[]) => { pieces: Piece[]; motion: Slice['motion'] },
): Stage {
  let count = 0;
  const slices = prev.slices.map((s, i) => {
    if (!matches(sel, i)) return { pieces: s.pieces };
    count++;
    return move(s.pieces);
  });
  // "Turn every 2nd slice, starting with slice 2, end for end (5 of the 11)."
  const which = describeSelector(sel);
  const st = stage('slices', slices, title,
    `${verb} ${which}${which.includes(',') ? ',' : ''} ${how} (${count === slices.length ? `all ${count}` : `${count} of the ${slices.length}`}).`);
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
 * Insert accent strips, worked out once for its two operations, milling the strips and placing
 * them: the step's stack of strips goes between the slices (and outside the end ones, with
 * `ends`). Each gap's stack is one slice, so later steps count it as one.
 *
 * A plain strip is one piece of one wood running the length of the slices. A patterned strip is
 * a slice of another glue-up: it is drawn as that panel's strips side by side along the gap,
 * starting `offset` in from edge A and, in every other gap, `stagger` further along. A strip of
 * that panel with `faces` is a plank with another wood on both faces, drawn as its three layers.
 * A patterned strip's wood is given the same grain direction as the slices it lies between,
 * because it is cut and turned the way they were.
 */
function accentWork(prev: Stage, step: Extract<Step, { type: 'insert' }>, names: Names): { failed: Stage } | AccentWork {
  const title = TITLES.addStrips;
  const accents = accentStrips(step);
  if (accents.some((a) => !(a.thickness > 0))) return { failed: failed(prev, title, 'Accent strip thickness must be greater than zero.') };
  if (accents.some((a) => a.pattern && !(a.pattern.every((s) => s.width > 0)))) return { failed: failed(prev, title, 'Every strip in a patterned strip needs a width greater than zero.') };
  if (accents.some((a) => a.pattern?.some((s) => s.faces && !(s.faces.thickness > 0 && 2 * s.faces.thickness < a.thickness)))) {
    return { failed: failed(prev, title, 'The two faces of a plank must be thinner, together, than the strip they are in.') };
  }
  const every = Math.max(1, Math.floor(step.every));
  const b = bbox(prev.slices.flatMap((s) => s.pieces));
  const grain = prev.slices[0]?.pieces[0]?.grain ?? [0, 0, 1];
  const stagger = step.stagger ?? 0;
  const slices: Slice[] = [];
  const stacks: Slice[] = [];
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
    stacks.push({ pieces });
    return { pieces };
  };
  // With `ends` on, a stack also goes outside the first slice and outside the last.
  if (step.ends) slices.push(stack());
  prev.slices.forEach((s, i) => {
    slices.push({ pieces: s.pieces });
    if (i < prev.slices.length - 1 && (i + 1) % every === 0) slices.push(stack());
  });
  if (step.ends) slices.push(stack());
  if (slices.length > MAX_SLICES * 2) return { failed: failed(prev, title, 'Too many slices.') };
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
    return accents.length === 1
      ? {
        slices, stacks, stock,
        mill: `Mill ${count} ${names(step.species)} strips ${inches(step.thickness)} × ${inches(width)} × ${inches(length)}.`,
        place: `Place one of the ${names(step.species)} strips ${where}.`,
      }
      : {
        slices, stacks, stock,
        mill: `Mill strips ${inches(width)} × ${inches(length)}: ${stock.map((l) => `${l.count} ${names(l.species)} ${inches(l.thickness)} thick`).join(', ')}.`,
        place: `Place a stack of ${accents.length} ${where}, in this order: ${accents.map((a) => `${names(a.species)} ${inches(a.thickness)}`).join(', ')}.`,
      };
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
  const mill = `The strips between the slices are cut from ${panels.length === 1 ? 'one more glue-up' : `${panels.length} more glue-ups`}, `
    + `made like the first with strips ${inches(panelLength)} long. ${describe.join('. ')}. `
    + (single
      ? `Flatten it, square one end, and cross cut it into ${count} slices ${inches(width)} wide (kerf ${inches(PANEL_KERF)}). `
      : `Glue the panels face to face in this order: ${order}, with each one's first strip where its measurement puts it. `
        + (anyThin ? 'Plane each thin panel down to its finished thickness once the glue has set. ' : '')
        + `Flatten the stack, square one end, and cross cut it into ${count} slices ${inches(width)} wide (kerf ${inches(PANEL_KERF)}). `);
  const place = `Stand each of the new slices the same way up as the slices already cut and place one ${where}`
    + (stagger ? `, sliding every other one ${inches(stagger)} along towards edge B so the pattern alternates. Let the ends overhang; they are trimmed after the glue-up.` : '.');
  return { slices, stacks, stock, mill: mill.trim(), place };
}

/** What an "Insert accent strips" step comes to: see `accentWork`. */
interface AccentWork {
  /** The slices with the stacks of strips between them. */
  slices: Slice[];
  /** The stacks on their own, one slice each, as they are before they are placed. */
  stacks: Slice[];
  stock: StockLine[];
  /** How to make the strips, and where to put them. */
  mill: string;
  place: string;
}

/** Mill the strips an "Insert accent strips" step needs. The slices stay as they are, and the new strips lie beside them. */
function millAccents(prev: Stage, step: Extract<Step, { type: 'insert' }>, names: Names): Stage {
  const work = accentWork(prev, step, names);
  if ('failed' in work) return { ...work.failed, title: TITLES.millAccents };
  return stage('slices', prev.slices.map((sl) => ({ pieces: sl.pieces })), TITLES.millAccents, work.mill, { stock: work.stock, beside: work.stacks });
}

/** Put the strips an "Insert accent strips" step milled between the slices: see `accentWork`. */
function addStrips(prev: Stage, step: Extract<Step, { type: 'insert' }>, names: Names): Stage {
  const work = accentWork(prev, step, names);
  if ('failed' in work) return work.failed;
  return stage('slices', work.slices, TITLES.addStrips, work.place);
}



/**
 * Mill a border, the first of the three operations of adding one (then `borderEnds`, then
 * `borderSides`): a frame to glue round the panel, with an optional thin line between the panel and
 * the frame. The two ends go on first, as wide as the panel; the two long sides then cover the
 * ends of those as well. The frame is drawn as blocks about `block` long. On an end-grain panel
 * the frame is end grain too, so it moves with the board: each side is a slice cross cut from a
 * panel of its own and stood on end. On a face-grain panel each side is one strip, grain along it.
 */
function millBorder(prev: Stage, step: Extract<Step, { type: 'frame' }>, names: Names, grid = 0): Stage {
  const title = TITLES.millBorder;
  if (!(step.width > 0)) return failed(prev, title, 'The border needs a width greater than zero.');
  const [sx, sy, sz] = prev.size;
  const w = step.width, lt = Math.max(0, step.line);
  const end = endGrainUp(prev.slices[0].pieces);
  const endPieces: Piece[][] = [[], []], sidePieces: Piece[][] = [[], []];
  const x0 = -lt - w, x1 = sx + lt + w;
  /** How many blocks make up a side this long, and how long each is. */
  const blocks = (span: number) => {
    const n = end ? Math.max(1, Math.round(span / Math.max(step.block, 0.5))) : 1;
    return { n, each: span / n };
  };
  const ends = blocks(sz), sides = blocks(x1 - x0);
  let shade = 5000;
  [[-lt, -lt - w], [sx, sx + lt]].forEach(([lineAt, frameAt], k) => {
    const pieces = endPieces[k];
    if (lt) pieces.push(box([lineAt, 0, 0], [lineAt + lt, sy, sz], step.lineSpecies, [0, 0, 1], tone(shade++)));
    for (let i = 0; i < ends.n; i++) {
      pieces.push(box([frameAt, 0, i * ends.each], [frameAt + w, sy, (i + 1) * ends.each], step.species, end ? [0, 1, 0] : [0, 0, 1], tone(shade++)));
    }
  });
  [[-lt, -lt - w], [sz, sz + lt]].forEach(([lineAt, frameAt], k) => {
    const pieces = sidePieces[k];
    if (lt) pieces.push(box([x0, 0, lineAt], [x1, sy, lineAt + lt], step.lineSpecies, [1, 0, 0], tone(shade++)));
    for (let i = 0; i < sides.n; i++) {
      pieces.push(box([x0 + i * sides.each, 0, frameAt], [x0 + (i + 1) * sides.each, sy, frameAt + w], step.species, end ? [0, 1, 0] : [1, 0, 0], tone(shade++)));
    }
  });
  const stock: StockLine[] = [];
  const long = x1 - x0;
  // The border has to fit the board, whose size rarely lands on the rounding step. So its stock
  // is milled to the next step up, a little over, and trimmed to fit: rounded to the nearest, it
  // could come up short.
  const up = (v: number) => (grid > 0 ? Math.ceil(v / grid - 1e-9) * grid : v);
  const over = (v: number) => up(v) > v + 1e-9;
  let how: string;
  let strips: Slice[] | undefined;
  let making: NonNullable<Stage['frame']>['making'];
  if (end) {
    // Two slices, one for each end or side, cross cut from a panel as thick as the border is wide.
    const length = 2 * (sy + PANEL_KERF) + 0.5;
    const [endEach, sideEach] = [up(ends.each), up(sides.each)];
    stock.push({ species: step.species, count: ends.n, thickness: w, width: endEach, length, use: 'Border: the panel the two end pieces are cut from' });
    stock.push({ species: step.species, count: sides.n, thickness: w, width: sideEach, length, use: 'Border: the panel the two side pieces are cut from' });
    how = `The border is end grain like the board, so it moves with it, and its pieces are cut from two small panels. Mill ${names(step.species)} strips ${inches(w)} thick and ${inches(length)} long for them: `
      + `${ends.n} strip${ends.n > 1 ? 's' : ''} ${inches(endEach)} wide for the ends, and ${sides.n} strip${sides.n > 1 ? 's' : ''} ${inches(sideEach)} wide for the sides. `;
    // The strips, then the two panels they make, lying on the bench beside the board.
    /** `n` strips `each` wide, side by side from `z`, as long as the border panels. */
    const lay = (n: number, each: number, z: number) => Array.from({ length: n }, (_, i) =>
      box([0, 0, z + i * each], [length, w, z + (i + 1) * each], step.species, [1, 0, 0], tone(6000 + shade++)));
    const forEnds = lay(ends.n, endEach, 0), forSides = lay(sides.n, sideEach, ends.n * endEach + 1);
    strips = [...forEnds, ...forSides].map((piece) => ({ pieces: [piece] }));
    making = {
      panels: [{ pieces: forEnds }, { pieces: forSides }],
      panelsText: over(ends.each) || over(sides.each)
        ? `Glue the strips edge to edge into two panels, which come out a little wide, and trim them to width: ${inches(sz)} for the ends, and ${inches(long)} for the sides.`
        : `Glue the strips edge to edge into two panels: one ${inches(sz)} wide for the ends, and one ${inches(long)} wide for the sides.`,
      pieces: [],
      piecesText: `Cross cut two slices ${inches(sy)} wide from each panel (kerf ${inches(PANEL_KERF)}) and stand them end grain up: those are the two end pieces and the two side pieces.`,
    };
  } else {
    stock.push({ species: step.species, count: 2, thickness: sy, width: w, length: up(sz), use: 'Border: the two end pieces' });
    stock.push({ species: step.species, count: 2, thickness: sy, width: w, length: up(long), use: 'Border: the two side pieces' });
    how = `Mill four ${names(step.species)} border pieces ${inches(sy)} thick and ${inches(w)} wide: two ${inches(up(sz))} long for the ends and two ${inches(up(long))} long for the sides`
      + `${over(sz) || over(long) ? ', a little over, to be trimmed flush' : ''}. `;
  }
  if (lt) {
    stock.push({ species: step.lineSpecies, count: 2, thickness: lt, width: sy, length: sz, use: 'Border: the line at each end' });
    stock.push({ species: step.lineSpecies, count: 2, thickness: lt, width: sy, length: long, use: 'Border: the line along each side' });
    how += `Mill four ${names(step.lineSpecies)} lines ${inches(lt)} × ${inches(sy)}: two ${inches(sz)} long and two ${inches(long)} long. `;
  }
  const each = lt ? 'a line and then a border piece' : 'a border piece';
  // The board is not touched yet: the pieces lie beside it, the ends and then the sides. For an
  // end-grain border what lies there first is the strips those pieces will be made from.
  const finished = [...endPieces, ...sidePieces].map((pieces) => ({ pieces }));
  return stage('panel', [{ pieces: prev.slices[0].pieces }], title, how.trim(), {
    stock,
    beside: strips ?? finished,
    frame: {
      ...(making ? { making: { ...making, pieces: finished } } : {}),
      ends: endPieces.flat(), sides: sidePieces.flat(),
      endsText: `Glue ${each} to each end of the board, flush with its long edges. Leave the border a hair proud of both faces.`,
      sidesText: `Glue ${each} along each long edge of the board, covering the ends of the two end pieces. Leave the border a hair proud of both faces.`,
    },
  });
}

/**
 * Glue the strips milled for an end-grain border into its two small panels, which lie beside the
 * board. A border of single strips has no such panels: the stage is returned as it is, which
 * says there is nothing to do and adds no stage.
 */
function borderPanels(prev: Stage): Stage {
  const making = prev.frame?.making;
  if (!making) return prev;
  return stage('panel', [{ pieces: prev.slices[0].pieces }], TITLES.borderPanels, making.panelsText, { beside: making.panels, frame: prev.frame });
}

/** Cross cut an end-grain border's two panels into its four pieces and stand them on end, beside the board. Nothing to do for a border of single strips. */
function borderCut(prev: Stage): Stage {
  const making = prev.frame?.making;
  if (!making) return prev;
  return stage('panel', [{ pieces: prev.slices[0].pieces }], TITLES.borderCut, making.piecesText, { beside: making.pieces, frame: { ...prev.frame!, making: undefined } });
}

/** Glue the two end pieces of a border to the panel they were milled for. The side pieces wait, moved with the panel. */
function borderEnds(prev: Stage): Stage {
  const title = TITLES.borderEnds;
  if (prev.kind !== 'panel' || !prev.frame?.ends.length || prev.frame.making) return failed(prev, title, 'The border pieces are made first.');
  const pieces = [...prev.slices[0].pieces, ...prev.frame.ends];
  // Back to the origin, and the sides with it, so they still line up.
  const min = bbox(pieces).min;
  const back: Vec3 = [-min[0], -min[1], -min[2]];
  return stage('panel', [{ pieces: translate(pieces, back) }], title, prev.frame.endsText,
    { frame: { ...prev.frame, ends: [], sides: translate(prev.frame.sides, back) } });
}

/** Glue the two side pieces of a border along the panel's long edges, over the ends of the two already on. */
function borderSides(prev: Stage): Stage {
  const title = TITLES.borderSides;
  if (prev.kind !== 'panel' || !prev.frame || prev.frame.ends.length) return failed(prev, title, 'The border ends are glued on first.');
  return stage('panel', [{ pieces: toOrigin([...prev.slices[0].pieces, ...prev.frame.sides]) }], title, prev.frame.sidesText);
}



/** Degrees as radians, written so that 90 and 180 come out as exactly a quarter and a half turn. */
const radians = (degrees: number) => (degrees / 180) * Math.PI;

/**
 * Turn wood. With a selection, each chosen slice turns about its own middle and the rest stay
 * put; without one, the whole panel turns on the bench and is set back at the origin. The
 * instruction names the familiar turns (onto its side, end for end, face down, a quarter turn of
 * the panel) and gives the angle for any other.
 */
function rotate(prev: Stage, a: Extract<Action, { type: 'rotate' }>): Stage {
  const title = TITLES.rotate;
  const angle = radians(a.angle);
  if (!a.sel) {
    const pieces = a.axis === 'y' ? rotateY(prev.slices[0].pieces, angle, [0, 0, 0]) : rotateZ(prev.slices[0].pieces, angle, [0, 0, 0]);
    return stage('panel', [{ pieces: toOrigin(pieces) }], title, a.axis === 'y' && a.angle === 90
      ? 'Turn the panel a quarter turn on the bench, so the next cut runs the other way (a rip, if the grain now runs across).'
      : `Turn the panel ${a.angle}° ${a.axis === 'y' ? 'on the bench' : 'about its width'}.`);
  }
  const [verb, how] = a.axis === 'z' && a.angle === 90 ? ['Roll', 'onto its side, so the end grain faces up']
    : a.axis === 'y' && a.angle === 180 ? ['Turn', 'end for end']
      : a.axis === 'z' && a.angle === 180 ? ['Flip', 'face down']
        : ['Turn', `${a.angle}° ${a.axis === 'z' ? 'about its length' : 'on the bench'}`];
  const out = arrange(prev, a.sel, title, verb, how, (pieces) => {
    const c = boxCenter(bbox(pieces));
    return {
      pieces: a.axis === 'y' ? rotateY(pieces, angle, c) : rotateZ(pieces, angle, c),
      motion: { axis: a.axis, angle, shift: 0 },
    };
  });
  // The slices of a 3D board are rows of hexagons: say what standing them up shows.
  if (prev.block && !out.error && a.axis === 'z' && a.angle === 90 && a.sel.mode === 'all') {
    out.summary = 'Stand every slice on end, so its row of hexagons is on top.';
  }
  return out;
}

/** Slide the chosen slices along their length. */
function shift(prev: Stage, a: Extract<Action, { type: 'shift' }>): Stage {
  return arrange(prev, a.sel, TITLES.shift, 'Slide', a.amount < 0 ? `${inches(-a.amount)} along its length, towards edge A` : `${inches(a.amount)} along its length`, (pieces) => ({
    pieces: translate(pieces, [0, 0, a.amount]),
    motion: { axis: null, angle: 0, shift: a.amount },
  }));
}

/**
 * Glue what is on the bench into one panel. Ripped strips go edge to edge, as they lie. Cross-cut
 * slices go face to face, and the panel notes what a later trim can square off.
 */
function glue(prev: Stage): Stage {
  if (prev.kind === 'strips') {
    const pieces = prev.slices.flatMap((s) => s.pieces);
    if (prev.block && !prev.block.ripped) {
      return failed(prev, TITLES.glue, 'The boards are ripped into strips first. Add "Rip the panel" with the blade tilted before this.');
    }
    if (prev.block && !prev.block.logs) {
      // The strips of a 3D board: three, one of each wood, make each hexagonal log. The logs are loose, to be glued again.
      const logs = Math.max(1, Math.round(prev.slices.length / 3));
      const made = blockLogs(prev.block.woods, prev.block.thickness, prev.size[0], logs, tone);
      return stage('strips', Array.from({ length: logs }, (_, i) => ({ pieces: made.slice(3 * i, 3 * i + 3) })), TITLES.glue,
        `Glue one strip of each wood into a hexagonal log, ${logs} log${logs > 1 ? 's' : ''}, with the woods in the same order round every one. `
        + 'Bind each with tape or a band clamp while the glue sets.',
        { block: { ...prev.block, logs: true } });
    }
    if (prev.block) {
      // The logs, side by side: one row of the pattern, as long as the logs.
      const logs = prev.slices.length;
      const row = blockRow(prev.block.woods, prev.block.thickness, prev.size[0], logs, tone);
      return stage('panel', [{ pieces: row }], TITLES.glue,
        `Glue the ${logs} logs side by side into one row, flat face to flat face, every log the same way round. `
        + `Clamp across the flats. The row is ${inches(boxSize(bbox(row))[2])} wide, with a zigzag top and bottom.`);
    }
    return stage('panel', [{ pieces }], TITLES.glue,
      `Glue them edge to edge in order into a panel ${inches(boxSize(bbox(pieces))[2])} wide.`);
  }
  if (prev.block) return glueBlock(prev);
  const laid = layout(prev.slices);
  const heights = laid.map((s) => boxSize(bbox(s.pieces))[1]);
  const hint = trimHintFor(laid);
  const all = laid.flatMap((s) => s.pieces);
  const b = bbox(all);
  const st = stage('panel', [{ pieces: toOrigin(all) }], TITLES.glue,
    `Glue the ${laid.length} slices face to face in this order, keeping the ends lined up as shown.`,
    { trimHint: { zLo: hint.zLo - b.min[2], zHi: hint.zHi - b.min[2] } });
  if (Math.max(...heights) - Math.min(...heights) > 1 / 64) {
    st.warning = `Slices differ in height by ${inches(Math.max(...heights) - Math.min(...heights))}; flatten after glue-up.`;
  }
  return st;
}

/**
 * Glue the slices of a 3D board, standing on end, into its block. Each slice is a row of
 * hexagons with a zigzag on both sides, and every other one has been slid half a log along, so
 * the points of one fit the hollows of the next: the rows close up to three quarters of a slice
 * apart and the pattern appears. Slices that have not been slid cannot nest, and it says so.
 */
function glueBlock(prev: Stage): Stage {
  const s = blockSide(prev.block!.thickness), half = prev.block!.thickness;
  const boxes = prev.slices.map((sl) => bbox(sl.pieces));
  // Neighbours must sit half a log apart along their length, give or take whole logs.
  const nests = boxes.every((b, k) => {
    if (!k) return true;
    const off = (((b.min[2] - boxes[k - 1].min[2] - half) % (2 * half)) + 2 * half) % (2 * half);
    return Math.min(off, 2 * half - off) < 1e-6;
  });
  if (!nests) {
    return failed(prev, TITLES.glue, `The slices will not fit together as they lie. Slide every other one ${inches(half)} along its length first, half a log, so the points of one row fit the hollows of the next: add an Offset step before this.`);
  }
  const pieces = toOrigin(prev.slices.flatMap((sl, k) => translate(sl.pieces, [k * 1.5 * s - boxes[k].min[0], -boxes[k].min[1], 0])));
  const size = boxSize(bbox(pieces));
  return stage('panel', [{ pieces }], TITLES.glue,
    `Glue the ${prev.slices.length} slices together standing on end, in this order, the points of each fitted into the hollows of the next. `
    + `The block is about ${inches(Math.round(size[0] * 8) / 8)} × ${inches(Math.round(size[2] * 8) / 8)} with ragged edges, and its top is the pattern.`,
    { block: undefined });
}

/** Saw a panel's long edges and ends straight. `auto` starts from what the last glue-up left whole. */
function trim(prev: Stage, step: Extract<Action, { type: 'trim' }>): Stage {
  const title = TITLES.trim;
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

/** Take wood off the two faces of a panel, with a warning about planing when it is end grain. */
function flatten(prev: Stage, step: Extract<Action, { type: 'flatten' }>): Stage {
  const title = TITLES.flatten;
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

/** What milling the boards of an end-grain 3D board is called. */
export const BOARDS_TITLE = 'Mill the boards';

/** The blade tilt that rips a board into the diamond strips of a 3D board. */
export const BEVEL_TILT = 30;

/** What a rip with the blade tilted is called. */
export const BEVEL_TITLE = 'Bevel rip';

/**
 * Saw a panel lengthways into strips: turn it a quarter turn so the saw runs along the grain, cut
 * it as a cross cut would, and leave the strips lying across the bench, where every later action
 * treats them as slices.
 */
function ripPanel(prev: Stage, a: Extract<Action, { type: 'ripPanel' }>): Stage {
  const title = a.tilt ? BEVEL_TITLE : TITLES.ripPanel;
  if (prev.kind === 'strips') {
    // Loose boards are ripped only on an end-grain 3D board, into its diamond strips.
    return a.tilt && prev.block && !prev.block.ripped ? bevelRip(prev, a, title)
      : failed(prev, title, 'This needs a glued panel. Add a "Glue up" step before it.');
  }
  if (!(a.width > 0)) return failed(prev, title, 'Strip width must be greater than zero.');
  const kerf = Math.max(0, a.kerf);
  if (prev.size[2] / (a.width + kerf) > MAX_SLICES) return failed(prev, title, `That would make more than ${MAX_SLICES} strips.`);
  const turned = rotate(prev, { type: 'rotate', axis: 'y', angle: 90 });
  const cut = crosscut(turned, { type: 'crosscut', width: a.width, kerf, angle: 0 });
  if (cut.error) return failed(prev, title, 'The panel is narrower than one strip.');
  const n = cut.slices.length;
  const offcut = prev.size[2] - n * a.width - (n - 1) * kerf;
  return {
    ...cut, title,
    summary: `Rip the panel lengthways into ${n} strips, each ${inches(a.width)} wide (kerf ${inches(kerf)}).`
      + (offcut > kerf + 1e-6 ? ` The last ${inches(offcut - kerf)} is an offcut.` : '')
      + ' Turn them a quarter turn on the bench, keeping their order: from here they are worked like cross-cut slices.',
  };
}

/** What each finishing touch is called in the options that describe it. */
const TOUCH_TITLE: Record<FinishPart, ActionType> = { corners: 'roundCorners', chamfer: 'chamfer', roundover: 'roundOver', template: 'grooveTemplate', groove: 'groove' };

/**
 * One finishing touch: cut it into the panel together with the touches already made. The panel
 * remembers what it was before the first of them (`finishing`), and each touch is cut from that
 * with the earlier ones, since they have to clear each other. The stage says only what this touch
 * is, or why it does not fit.
 */
function touch<P extends Exclude<FinishPart, 'template'>>(prev: Stage, part: P, options: Omit<Finish[P], 'on'>): Stage {
  const base = prev.finishing ?? { pieces: prev.slices[0].pieces, size: prev.size, applied: NO_FINISH };
  const applied = { ...base.applied, [part]: { ...options, on: true } } as Finish;
  const cutUp = finishPanel(base.size, base.pieces, applied);
  return {
    kind: 'panel', slices: [{ pieces: cutUp.pieces }], size: base.size, title: TITLES[TOUCH_TITLE[part]],
    summary: cutUp.done[part] ?? '', warning: cutUp.skipped[part],
    finish: part, finishing: { ...base, applied },
  };
}

/**
 * The groove's template: the board as the touches so far leave it, with the template lying on top
 * where the groove's inner edge will be. Nothing is cut, so the board carried on to the next touch
 * is the same; it only remembers that the groove is to be cut round a template.
 */
function grooveTemplate(prev: Stage, a: Extract<Action, { type: 'grooveTemplate' }>): Stage {
  const base = prev.finishing ?? { pieces: prev.slices[0].pieces, size: prev.size, applied: NO_FINISH };
  const applied: Finish = {
    ...base.applied,
    groove: { ...a.groove, on: false },
    template: { on: true, stripWidth: a.stripWidth, thickness: a.thickness },
  };
  const made = finishPanel(base.size, base.pieces, applied);
  return {
    kind: 'panel', slices: [{ pieces: [...made.pieces, ...(made.template ?? [])] }], size: base.size, title: TITLES.grooveTemplate,
    summary: made.done.template ?? '', warning: made.skipped.template,
    finish: 'template', finishing: { ...base, applied },
  };
}

/** Sand and oil: the last thing done. The board is drawn as the last cut left it. */
function sand(prev: Stage): Stage {
  return {
    kind: 'panel', slices: prev.slices, size: prev.size, title: TITLES.sand,
    summary: 'Sand through the grits and oil.', finish: 'sand', finishing: prev.finishing,
  };
}

/**
 * Screw a foot under each corner of the finished board. The board is not changed: the feet are
 * drawn beneath it, and the stage keeps the board's own size, since feet are not part of its
 * thickness. Feet too big to sit inside the corners, or set so far in that they meet, are left off
 * with the reason.
 */
function addFeet(prev: Stage, a: Extract<Action, { type: 'addFeet' }>): Stage {
  const title = TITLES.addFeet;
  const [x, , z] = prev.size;
  const r = a.diameter / 2;
  const base = { kind: 'panel' as const, size: prev.size, title, finish: 'feet' as const, finishing: prev.finishing };
  /** The board as it is, with why there are no feet under it. */
  const without = (warning: string): Stage => ({ ...base, slices: prev.slices, summary: '', warning });
  if (!(a.diameter > 0) || !(a.height > 0)) return without('No feet: they need a diameter and a height greater than zero.');
  if (a.inset < r - 1e-9) return without(`No feet: set ${inches(a.inset)} in from the edges, feet ${inches(a.diameter)} across would stick out past them. Set them at least ${inches(r)} in.`);
  if (2 * a.inset + a.diameter > Math.min(x, z) + 1e-9) return without(`No feet: set ${inches(a.inset)} in from the edges, they would meet in the middle of a board ${inches(Math.min(x, z))} wide.`);
  const feet = [[a.inset, a.inset], [x - a.inset, a.inset], [a.inset, z - a.inset], [x - a.inset, z - a.inset]]
    .map(([cx, cz], i) => post(cx, cz, r, -a.height, a.height, FEET, 0.5 + 0.05 * i));
  return {
    ...base, slices: [{ pieces: [...prev.slices[0].pieces, ...feet] }],
    summary: `Turn the board over and screw a foot inside each of the four corners, its centre ${inches(a.inset)} in from both edges. `
      + `The feet are ${inches(a.diameter)} across and ${inches(a.height)} tall. Drill a pilot hole for each screw, and check the screws are shorter than the board is thick.`,
  };
}

/** The actions that finish a board. Once one is done, only these can follow. */
const FINISHING: ActionType[] = ['roundCorners', 'chamfer', 'roundOver', 'grooveTemplate', 'groove', 'sand', 'addFeet'];

/** A clear bench with nothing on it and nothing set aside: where a design starts. */
export const EMPTY: Stage = { kind: 'slices', slices: [], size: [0, 0, 0], title: '', summary: '' };

type Apply<K extends ActionType> = (prev: Stage, action: Extract<Action, { type: K }>, names: Names) => Stage;

/**
 * Every action, by type: the function that does it. To add an action, add it to the `Action`
 * type and `TITLES` above, write its function, and list it here.
 */
export const ACTIONS: { [K in ActionType]: Apply<K> } = {
  rip,
  glueFaces,
  setAside,
  interleave,
  crosscut,
  rotate,
  shift,
  millAccents: (prev, a, names) => millAccents(prev, a.spec, names),
  addStrips: (prev, a, names) => addStrips(prev, a.spec, names),
  millBorder: (prev, a, names) => millBorder(prev, a.spec, names, a.grid),
  borderPanels,
  borderCut,
  borderEnds,
  borderSides,
  glue,
  trim,
  flatten,
  ripPanel,
  roundCorners: (prev, a) => touch(prev, 'corners', { radius: a.radius }),
  chamfer: (prev, a) => touch(prev, 'chamfer', { size: a.size }),
  roundOver: (prev, a) => touch(prev, 'roundover', { radius: a.radius }),
  grooveTemplate,
  groove: (prev, a) => touch(prev, 'groove', { inset: a.inset, width: a.width, depth: a.depth, cornerRadius: a.cornerRadius, align: a.align }),
  sand,
  addFeet,
};

/**
 * Do one action to the work. Never throws: an action that cannot be done returns a stage with an
 * error. Finishing comes last: once a finishing action is done only others can follow, and each
 * needs a sound glued panel. Slices set aside take no part in any action but `interleave`, which uses them up, so
 * they are carried through the rest untouched.
 */
export function act(prev: Stage, action: Action, names: Names): Stage {
  const finishing = FINISHING.includes(action.type);
  if (prev.finish && !finishing) return failed(prev, TITLES[action.type], 'Finishing comes last. Do this before the first finishing step.');
  if (finishing && (prev.kind !== 'panel' || prev.error)) return failed(prev, TITLES[action.type], 'Finishing needs a glued panel.');
  const out = (ACTIONS[action.type] as Apply<ActionType>)(prev, action, names);
  if (prev.aside && !out.aside && (action.type !== 'interleave' || out.error)) out.aside = prev.aside;
  return out;
}
