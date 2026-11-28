import { isBlocks, reblock } from './blocks';
import { fitFlatBlocks, inferBlocks } from './blocksFlat';
import { dimensionsOf, isLocked, layupOf, sizingOf, unfitted, withLayup, woodSetsThickness } from './design';
import { NO_FINISH } from './finish';
import { run } from './pipeline';
import type { Design } from './types';

/**
 * Finished size of a design, or null when any step in it has an error. The groove and chamfer are
 * left out: they do not change the size, and cutting them on every trial would only slow the search.
 */
const finalSize = (d: Design) => {
  const stages = run({ ...d, finish: NO_FINISH });
  const last = stages[stages.length - 1];
  return stages.some((s) => s.error) ? null : last.size;
};

/** Whether a finished size covers the target: longer side against longer, shorter against shorter. */
function covers(size: readonly number[] | null, target: Design['target']): boolean {
  if (!size) return false;
  return Math.max(size[0], size[2]) >= Math.max(target.length, target.width) - 1e-9
    && Math.min(size[0], size[2]) >= Math.min(target.length, target.width) - 1e-9;
}

/**
 * The shortest stock, to the next 1/4 inch, that makes the board at least `goal` along `axis`.
 * The design comes back unchanged when no stock up to 12 feet reaches it.
 */
function shortestStock(d: Design, axis: 0 | 2, goal: number): Design {
  /** Whether stock of this length makes a board at least the goal in that direction. */
  const reaches = (length: number) => {
    const s = finalSize(withLayup(d, { length }));
    return !!s && s[axis] >= goal - 1e-9;
  };
  // Finished size steps up with stock length, so search for the shortest stock that reaches it.
  // The search runs over whole quarter inches, so it lands on the shortest quarter exactly; a
  // search over real lengths rounded up afterwards could overshoot by a quarter.
  let lo = 4, hi = 576; // quarters of an inch: 1″ to 144″
  if (!reaches(hi / 4)) return d;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (reaches(mid / 4)) hi = mid;
    else lo = mid + 1;
  }
  return withLayup(d, { length: hi / 4 });
}

/** Which finished side the strip count moves, and which the stock length: a quarter-turn step can swap them. */
function axesOf(design: Design, base: readonly number[]): { repeatAxis: 0 | 2; lengthAxis: 0 | 2 } {
  const withRepeat = finalSize(withLayup(design, { repeat: layupOf(design).repeat + 1 }));
  const repeatAxis = withRepeat && Math.abs(withRepeat[0] - base[0]) > Math.abs(withRepeat[2] - base[2]) ? 0 : 2;
  return { repeatAxis, lengthAxis: repeatAxis === 0 ? 2 : 0 };
}

/**
 * Make the finished board exactly the target length and width, and say how much wood that takes.
 *
 * First the counts: the fewest repeats of the strips and the shortest stock that make a board at
 * least the target, at the sizes asked for (`fitCounts`). That board is a little over, by up to
 * one block each way. Then the sizes give way so that it is not over at all (`exactly`): the
 * strips that are not locked are milled a little narrower, and the blocks are made a little
 * shorter along the board. What was asked for is kept; the adjustment is stored beside it on the
 * first step (`scale`, `along`), so fitting again starts from the same sizes and comes out the same.
 *
 * `orientation` is the design whose proportions decide which way the board lies: whether the
 * strips run along the target length or across it. Pass the design as it was before an edit, so
 * that an edit which makes the unfitted panel very wide does not turn the board round.
 *
 * With rounding on (`Design.dimensions`), every size is rounded to its step where it is used, so
 * each can be set on a machine, and the board finishes within a little of the target, not on it:
 * it has as many pieces as the exact board, each off by less than a rounding step.
 *
 * A 3D board is fitted its own way (`reblock`): its board is sawn out of a block of logs, so the
 * fit counts the logs and sets the trim, and no size gives way.
 */
export function fitToTarget(asGiven: Design, orientation: Design = asGiven): Design {
  // Whether this is a 3D board, and which, follows from its steps.
  const design = inferBlocks(asGiven);
  if (isBlocks(design)) return layupOf(design).blocks?.flat ? fitFlatBlocks(design) : reblock(design);
  const grid = dimensionsOf(design).rounding;
  if (!(grid > 0)) return exactly(fitCounts(unfitted(design), unfitted(orientation)));
  // A design that rounds its sizes is fitted as if it did not, which finds the exact answer, and
  // is then built from that answer rounded: its stock is a whole number of steps long, and the
  // board finishes as near its target as sizes on that step allow.
  const plain = (d: Design): Design => ({ ...unfitted(d), dimensions: { ...dimensionsOf(d), rounding: 0 } });
  const fitted = exactly(fitCounts(plain(design), plain(orientation)));
  const built = withLayup({ ...fitted, dimensions: design.dimensions }, { length: Math.ceil(layupOf(fitted).length / grid - 1e-6) * grid });
  // Rounding can make every slice a little wider, and then the stock found for the exact slices
  // is one slice short and the board a whole block under its target. Lengthen the stock until the
  // board has as many pieces as the exact one: by whole rounding steps of about 1/16 inch, so a
  // fine step (a thousandth) does not mean thousands of trials, and by no more than 4 inches.
  const wanted = piecesIn(fitted);
  if (!wanted || piecesIn(built) >= wanted) return built;
  const by = grid * Math.max(1, Math.round(0.0625 / grid));
  for (let more = by; more <= 4 + 1e-9; more += by) {
    const longer = withLayup(built, { length: layupOf(built).length + more });
    if (piecesIn(longer) >= wanted) return longer;
  }
  return built;
}

/** How many pieces of wood a design's finished board is made of, or 0 when the design cannot be built. */
function piecesIn(d: Design): number {
  const stages = run({ ...d, finish: NO_FINISH });
  return stages.some((s) => s.error) ? 0 : stages[stages.length - 1].slices.reduce((n, sl) => n + sl.pieces.length, 0);
}

/** Whether a recipe's sizes can give way without breaking its pattern. */
function canGiveWay(design: Design): boolean {
  return !design.steps.some((s) =>
    // A second panel and a patterned strip are sized to match the first panel, piece for piece.
    s.type === 'panel' || s.type === 'combine' || s.type === 'rip'
    || (s.type === 'insert' && (!!s.pattern || !!s.more?.some((m) => m.pattern)))
    // On an angled cut the strip widths and the cut both move both sides of the board.
    || (s.type === 'crosscut' && s.angle !== 0));
}

/**
 * The fitted design with its sizes adjusted so the board is the target size and not just at
 * least that: see `fitToTarget`. Each adjustment is found by running the recipe, so it follows
 * whatever steps are in it. One that cannot be found is left off, and the board stays a little
 * over that way; so does a recipe whose pattern would not survive it (`canGiveWay`).
 */
function exactly(d: Design): Design {
  const base = finalSize(d);
  if (!base || !canGiveWay(d)) return d;
  const long = Math.max(d.target.length, d.target.width), short = Math.min(d.target.length, d.target.width);
  /** The target for a finished side: the longer target side for whichever side is longer now. */
  const goalFor = (axis: 0 | 2) => ((axis === 0 ? base[0] >= base[2] : base[2] > base[0]) ? long : short);
  /**
   * Find the value of one adjustment that puts the side it moves exactly on its target, starting
   * from `start` and staying between `lo` and `hi`. The side moves in a straight line with the
   * adjustment, so a few steps of the secant method land on it.
   */
  const solve = (start: number, lo: number, hi: number, set: (v: number) => Design): Design | null => {
    const s0 = finalSize(set(start)), s1 = finalSize(set(start - 1e-5));
    if (!s0 || !s1) return null;
    const axis = Math.abs(s1[0] - s0[0]) > Math.abs(s1[2] - s0[2]) ? 0 : 2;
    const goal = goalFor(axis);
    if (Math.abs(s0[axis] - goal) < 1e-10) return set(start);
    let a = start, fa = s0[axis], b = start - 1e-5, fb = s1[axis];
    for (let i = 0; i < 12; i++) {
      if (Math.abs(fb - fa) < 1e-13) return null;
      const c = Math.min(hi, Math.max(lo, b + ((goal - fb) * (b - a)) / (fb - fa)));
      const sc = finalSize(set(c));
      if (!sc) return null;
      if (Math.abs(sc[axis] - goal) < 1e-10) return set(c);
      a = b; fa = fb; b = c; fb = sc[axis];
    }
    return null;
  };

  let out = d;
  // Across the board: the strips that are not locked share the change evenly.
  if (layupOf(out).strips.some((s) => !isLocked(s))) {
    const from = out;
    out = solve(1, 0.5, 1.5, (scale) => withLayup(from, { scale })) ?? out;
  }
  // Along the board: the length of a block, or with no cross cut the length of the stock itself.
  const from = out;
  const { alongOn } = sizingOf(from);
  if (alongOn === 'thickness') {
    out = solve(0, 0.25 - layupOf(from).thickness, 2, (along) => withLayup(from, { along })) ?? out;
  } else if (alongOn === 'crosscut') {
    // A narrower cut makes more slices from the same stock, so the stock is found again each time.
    const { lengthAxis } = axesOf(from, base);
    const goal = goalFor(lengthAxis);
    out = solve(0, -1, 1, (along) => shortestStock(withLayup(from, { along }), lengthAxis, goal)) ?? out;
  } else {
    out = solve(layupOf(from).length, 1, 144, (length) => withLayup(from, { length })) ?? out;
  }
  return out;
}

/**
 * Adjust the strip repeat count and the stock length so the finished board is at least the target
 * length and width, with as little extra as possible, at the sizes asked for. Works by running the whole recipe, so it
 * follows whatever steps are in it. On most boards each knob moves one finished side; on an
 * angled-cut board both move both, so if the first pass falls short it keeps adding a repeat and
 * re-finding the stock length. Returns the closest design found when the target cannot be reached.
 * A design that cannot be built only because its stock is too short is fitted from longer stock;
 * one that cannot be built for any other reason comes back as it is.
 * `orientation` is as for `fitToTarget`.
 */
function fitCounts(asGiven: Design, orientation: Design): Design {
  // The stock length is this fit's to find, so one too short to build from (typed into the
  // field, say: shorter than a single slice) is no reason to give up and leave the board broken.
  // Start again from the shortest of a few generous lengths that can be built.
  const design = finalSize(asGiven) ? asGiven
    : [12, 24, 48, 96].map((length) => withLayup(asGiven, { length })).find((d) => finalSize(d)) ?? asGiven;
  const base = finalSize(design);
  if (!base) return design;
  const { repeatAxis, lengthAxis } = axesOf(design, base);
  // The longer target side goes with whichever finished side is longer in the orientation design.
  const lie = finalSize(orientation);
  const long = Math.max(design.target.length, design.target.width);
  const short = Math.min(design.target.length, design.target.width);
  // With nothing to say how the board lay (it could not be built, and neither could the design
  // it is to lie like), the stock runs the long way of the board, as it does in every starter.
  const across = lie ? lie[repeatAxis] >= lie[lengthAxis] : design === asGiven && base[repeatAxis] >= base[lengthAxis];
  const repeatTarget = across ? long : short;
  const lengthTarget = across ? short : long;

  /** The same design with the shortest stock that reaches the length target. */
  const withLength = (d: Design): Design => shortestStock(d, lengthAxis, lengthTarget);

  let best = design;
  for (let r = 1; r <= 80; r++) {
    const d = withLayup(design, { repeat: r });
    const s = finalSize(d);
    if (s && s[repeatAxis] >= repeatTarget - 1e-9) {
      best = d;
      break;
    }
  }
  best = withLength(best);
  for (let round = 0; round < 30 && layupOf(best).repeat < 80 && !covers(finalSize(best), design.target); round++) {
    best = withLength(withLayup(best, { repeat: layupOf(best).repeat + 1 }));
  }
  return best;
}

/**
 * The design with every flattening set to its allowance: one rounding step off the thickness
 * (1/16 inch when nothing is rounded), half off each face. It is for a board whose slices lie
 * flat (`woodSetsThickness`). There the wood has a starting thickness, which is what the person
 * has, and nobody knows how much a glue-up needs to come flat until it is out of the clamps; so
 * the recipe allows the same small amount each time, and neither the wood nor the flattening is
 * bent to land on the thickness wanted. The board that leaves may be over or under what was
 * wanted. That is not an error: the last flattening's instruction and the window say where it
 * ends up, and the person takes it from there.
 */
function withAllowances(design: Design): Design {
  const grid = dimensionsOf(design).rounding;
  const face = (grid > 0 ? grid : 0.0625) / 2;
  if (design.steps.every((s) => s.type !== 'flatten' || (Math.abs(s.top - face) < 1e-9 && Math.abs(s.bottom - face) < 1e-9))) return design;
  const candidate = { ...design, steps: design.steps.map((s) => (s.type === 'flatten' ? { ...s, top: face, bottom: face } : s)) };
  return finalSize(candidate) ? candidate : design;
}

/**
 * Adjust the design so the finished board is the target thickness. On an end-grain board the
 * thickness comes from the width of the last cross cut; otherwise it comes from the strip
 * thickness. Which one applies is found by trying it, so it follows whatever steps are in the
 * recipe, and the board stays lying the way it was. With rounding on, reaching the target means
 * landing within half a rounding step of it. Returns the design unchanged when neither knob
 * reaches the target.
 */
export function fitThickness(design: Design): Design {
  const base = finalSize(design);
  if (!base) return design;
  const delta = design.target.thickness - base[1];
  // A board built from rounded sizes can only land within half a rounding step of a target that
  // is not on a step (43 mm, with sixteenths): that is as near as it gets, and it counts. A board
  // already that near is left alone: trying a knob that does not move the thickness would
  // otherwise look like success and keep the change.
  const near = dimensionsOf(design).rounding / 2 + 1e-6;
  if (Math.abs(delta) < near) return design;
  /** Whether a candidate design runs cleanly and lands on the target thickness. */
  const hits = (d: Design) => {
    const s = finalSize(d);
    return !!s && Math.abs(s[1] - design.target.thickness) < near;
  };
  for (let i = design.steps.length - 1; i >= 0; i--) {
    const step = design.steps[i];
    if (step.type !== 'crosscut') continue;
    const width = step.width + delta;
    if (width <= 0) break;
    // A board made from two panels cross cuts both to the same width; they change together.
    const candidate = { ...design, steps: design.steps.map((s) => (s.type === 'crosscut' && Math.abs(s.width - step.width) < 1e-9 ? { ...s, width } : s)) };
    // The cut got wider or narrower, so the stock length has to be found again. The board keeps
    // lying the way it did: a much wider cut must not turn it round.
    if (hits(candidate)) return fitToTarget(candidate, design);
    break;
  }
  const thickness = layupOf(design).thickness + delta;
  if (thickness <= 0) return design;
  const candidate = withLayup(design, { thickness });
  return hits(candidate) ? candidate : design;
}

/**
 * The design to keep after an edit. While the design holds its board size (autoFit not false),
 * an edit to the strips, the steps or the target is followed by a fresh fit, so that changing the
 * size of the wood changes how many strips and how much stock are needed and not how big the
 * board is. On a board stood on end an edit to the target thickness is followed by a fit of the
 * thickness too, by the width of the cross cut. On one whose slices lie flat the wood is what
 * the person has: an edit to the thickness wanted, to the thickness of the wood or to the
 * rounding sets every flattening to its allowance (`withAllowances`) and changes nothing else.
 * Edits that cannot change the size (the name, a custom wood) are passed through.
 */
export function withAutoFit(prev: Design, edited: Design): Design {
  // What the first step makes follows from the steps, whether or not the size is held.
  const next = inferBlocks(edited);
  if (next.autoFit === false) return next;
  // Which steps are the very same objects as before: all of them, or all but the strips.
  const alike = (from: number) => prev.steps.length === next.steps.length && prev.steps.every((s, i) => i < from || s === next.steps[i]);
  const same = alike(0) && prev.target === next.target && prev.autoFit !== false && dimensionsOf(prev).rounding === dimensionsOf(next).rounding && dimensionsOf(prev).kerf === dimensionsOf(next).kerf;
  // The board keeps lying the way it did before the edit; only a change to the steps after the
  // strips can turn it.
  const fitted = same ? next : fitToTarget(next, alike(1) ? prev : next);
  const asked = prev.target.thickness !== next.target.thickness;
  // Where the wood sets the board's thickness, neither it nor the flattening gives way to the
  // thickness wanted: the flattenings are set to their allowances and the instructions say where
  // that leaves the board.
  if (woodSetsThickness(fitted)) {
    // The wood's thickness typed, and not changed along with the steps: turning the board to the
    // other grain swaps it with the cross cut, and that is not the person's wood changing.
    const wood = alike(1) && layupOf(prev).thickness !== layupOf(next).thickness;
    const touched = asked || wood || dimensionsOf(prev).rounding !== dimensionsOf(next).rounding;
    return touched ? withAllowances(fitted) : fitted;
  }
  // On a board stood on end the thickness is the width of the slices, which is free to change.
  return asked ? fitThickness(fitted) : fitted;
}
