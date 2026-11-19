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
 * Adjust the strip repeat count and the stock length so the finished board is at least the target
 * length and width, with as little extra as possible. Works by running the whole recipe, so it
 * follows whatever steps are in it. On most boards each knob moves one finished side; on an
 * angled-cut board both move both, so if the first pass falls short it keeps adding a repeat and
 * re-finding the stock length. Returns the closest design found when the target cannot be reached.
 *
 * `orientation` is the design whose proportions decide which way the board lies: whether the
 * strips run along the target length or across it. Pass the design as it was before an edit, so
 * that an edit which makes the unfitted panel very wide does not turn the board round.
 */
export function fitToTarget(design: Design, orientation: Design = design): Design {
  const base = finalSize(design);
  if (!base) return design;
  // Which finished dimension does each knob move? A quarter-turn step can swap them.
  const withRepeat = finalSize({ ...design, layup: { ...design.layup, repeat: design.layup.repeat + 1 } });
  const repeatAxis = withRepeat && Math.abs(withRepeat[0] - base[0]) > Math.abs(withRepeat[2] - base[2]) ? 0 : 2;
  const lengthAxis = repeatAxis === 0 ? 2 : 0;
  // The longer target side goes with whichever finished side is longer in the orientation design.
  const lie = finalSize(orientation) ?? base;
  const long = Math.max(design.target.length, design.target.width);
  const short = Math.min(design.target.length, design.target.width);
  const repeatTarget = lie[repeatAxis] >= lie[lengthAxis] ? long : short;
  const lengthTarget = lie[repeatAxis] >= lie[lengthAxis] ? short : long;

  /** The same design with the shortest stock, to the next 1/4 inch, that reaches the length target. */
  const withLength = (d: Design): Design => {
    /** Whether stock of this length makes a board at least the target in the length direction. */
    const reaches = (length: number) => {
      const s = finalSize({ ...d, layup: { ...d.layup, length } });
      return !!s && s[lengthAxis] >= lengthTarget - 1e-9;
    };
    // Finished size steps up with stock length, so search for the shortest stock that reaches it.
    let lo = 1, hi = 144;
    if (!reaches(hi)) return d;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (reaches(mid)) hi = mid;
      else lo = mid;
    }
    return { ...d, layup: { ...d.layup, length: Math.ceil(hi * 4) / 4 } };
  };

  let best = design;
  for (let r = 1; r <= 80; r++) {
    const d = { ...design, layup: { ...design.layup, repeat: r } };
    const s = finalSize(d);
    if (s && s[repeatAxis] >= repeatTarget - 1e-9) {
      best = d;
      break;
    }
  }
  best = withLength(best);
  for (let round = 0; round < 30 && best.layup.repeat < 80 && !covers(finalSize(best), design.target); round++) {
    best = withLength({ ...best, layup: { ...best.layup, repeat: best.layup.repeat + 1 } });
  }
  return best;
}

/**
 * Adjust the design so the finished board is the target thickness. On an end-grain board the
 * thickness comes from the width of the last cross cut; otherwise it comes from the strip
 * thickness. Which one applies is found by trying it, so it follows whatever steps are in the
 * recipe, and the board stays lying the way it was. Returns the design unchanged when neither
 * knob reaches the target.
 */
export function fitThickness(design: Design): Design {
  const base = finalSize(design);
  if (!base) return design;
  const delta = design.target.thickness - base[1];
  if (Math.abs(delta) < 1e-6) return design;
  /** Whether a candidate design runs cleanly and lands on the target thickness. */
  const hits = (d: Design) => {
    const s = finalSize(d);
    return !!s && Math.abs(s[1] - design.target.thickness) < 1e-6;
  };
  for (let i = design.steps.length - 1; i >= 0; i--) {
    const step = design.steps[i];
    if (step.type !== 'crosscut') continue;
    const width = step.width + delta;
    if (width <= 0) break;
    const candidate = { ...design, steps: design.steps.map((s) => (s.id === step.id ? { ...step, width } : s)) };
    // The cut got wider or narrower, so the stock length has to be found again. The board keeps
    // lying the way it did: a much wider cut must not turn it round.
    if (hits(candidate)) return fitToTarget(candidate, design);
    break;
  }
  const thickness = design.layup.thickness + delta;
  if (thickness <= 0) return design;
  const candidate = { ...design, layup: { ...design.layup, thickness } };
  return hits(candidate) ? candidate : design;
}

/**
 * The design to keep after an edit. While the design holds its board size (autoFit not false),
 * an edit to the strips, the steps or the target is followed by a fresh fit, so that changing the
 * size of the wood changes how many strips and how much stock are needed and not how big the
 * board is. Edits that cannot change the size (the name, a custom wood) are passed through.
 */
export function withAutoFit(prev: Design, next: Design): Design {
  if (next.autoFit === false) return next;
  const same = prev.layup === next.layup && prev.steps === next.steps && prev.target === next.target
    && prev.autoFit !== false;
  // The board keeps lying the way it did before the edit; only a change of steps can turn it.
  return same ? next : fitToTarget(next, prev.steps === next.steps ? prev : next);
}
