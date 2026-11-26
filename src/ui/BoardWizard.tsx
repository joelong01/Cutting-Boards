import { useEffect, useMemo, useState } from 'react';
import { fitThickness, fitToTarget } from '../model/fit';
import { inches } from '../model/fractions';
import { run } from '../model/pipeline';
import { CHESS_SQUARES, chessBoard, designs, doubleBorder, doubleBorderCount } from '../model/presets';
import type { Design, Stage } from '../model/types';
import { Len } from './inputs';

interface Props {
  /** Starting size, normally the current design's target. */
  initial: Design['target'];
  /** Open straight at the designs page; used by the smoke test. */
  startAtDesigns?: boolean;
  /** Render a stage to a PNG data URL, for the example thumbnails. */
  snapshot: (stage: Stage) => string;
  onCreate: (design: Design) => void;
  onClose: () => void;
}

const COMMON_SIZES: { label: string; size: Design['target'] }[] = [
  { label: 'Small bar board', size: { length: 12, width: 9, thickness: 0.75 } },
  { label: 'Everyday', size: { length: 16, width: 12, thickness: 1.25 } },
  { label: 'Large', size: { length: 18, width: 12, thickness: 1.5 } },
  { label: 'Butcher block', size: { length: 20, width: 16, thickness: 2 } },
];

/** One design the wizard offers on its last page, before it is built and drawn. */
interface Candidate {
  key: string;
  label: string;
  blurb: string;
  make: () => Design;
}

interface Example extends Candidate {
  design: Design;
  final: Stage;
  image: string;
}

/** A design resized to the wanted board: length and width by stock, then thickness. */
function sized(base: Design, target: Design['target']): Design {
  return fitThickness(fitToTarget({ ...base, target }));
}

/** Whether two board sizes are the same, so the matching common-size button can be highlighted. */
const sameSize = (a: Design['target'], b: Design['target']) =>
  Math.abs(a.length - b.length) < 1e-6 && Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.thickness - b.thickness) < 1e-6;

/** A finished stage's size as length x width x thickness, longer side first. */
const sizeText = (s: Stage) =>
  `${inches(Math.max(s.size[0], s.size[2]))} × ${inches(Math.min(s.size[0], s.size[2]))} × ${inches(s.size[1])}`;

/** The woods and sizes a chess board and a double border board start with; all can be changed once the board is open. */
const CHESS = { dark: 'walnut', light: 'maple' };
const DOUBLE = { block: 1.5, line: 0.125, field: 'maple', inner: 'walnut', outer: 'white-oak', spacer: 'poplar' };

/** The square that makes an eight-square chess board as wide as the board asked for, to the nearest 1/8 inch. */
const chessSquare = (target: Design['target']) =>
  Math.max(0.5, Math.round(Math.min(target.length, target.width)) / CHESS_SQUARES);

/**
 * Two-page dialog for starting a board. The first page asks for its size; the second offers every
 * design once, built to that size, named and described without a word about grain. Picking one opens it for editing, where its woods, its sizes
 * and which grain is on top are changed like any other board's: end grain or edge grain is not a
 * kind of board here, only whether the recipe stands the slices up. The chess board is eight
 * squares each way, as wide as the board asked for; the double border board is a whole number of
 * blocks, the nearest to the size.
 */
export function BoardWizard({ initial, startAtDesigns, snapshot, onCreate, onClose }: Props) {
  const [target, setTarget] = useState(initial);
  const [page, setPage] = useState<1 | 2>(startAtDesigns ? 2 : 1);
  const [examples, setExamples] = useState<Example[]>([]);

  const candidates = useMemo<Candidate[]>(() => {
    const blocks = {
      along: doubleBorderCount(target.length, DOUBLE.block, DOUBLE.line),
      across: doubleBorderCount(target.width, DOUBLE.block, DOUBLE.line),
    };
    return [
      ...designs().map((p) => ({ key: p.key, label: p.label, blurb: p.blurb, make: () => sized(p.make(), target) })),
      {
        key: 'chess',
        label: 'Chess board',
        blurb: 'For playing on: exactly eight squares each way, so the board is square, as wide as the width asked for.',
        make: () => chessBoard({ ...CHESS, square: chessSquare(target), thickness: target.thickness, grain: 'end' }),
      },
      {
        key: 'double',
        label: 'Double border',
        blurb: 'Maple blocks, each ringed with walnut, in a white oak grid. Three glue-ups: strips with a cheap spacer in them, then slices turned on end with a three-strip stack between them, then the panel sawn through each spacer and the oak glued into the kerfs.',
        make: () => doubleBorder({ ...DOUBLE, ...blocks, thickness: target.thickness, grain: 'end' }),
      },
    ];
  }, [target]);

  // Sizing and drawing an example takes a moment, so add them one per tick: the page paints
  // first and each card appears as it is ready, instead of the dialog freezing until all are done.
  useEffect(() => {
    if (page !== 2) return;
    setExamples([]);
    let timer = 0;
    /** Build example i, show it, and schedule the next one. */
    const next = (i: number) => {
      if (i >= candidates.length) return;
      const candidate = candidates[i];
      const design = candidate.make();
      const stages = run(design);
      const final = stages[stages.length - 1];
      const example = { ...candidate, design, final, image: final.error ? '' : snapshot(final) };
      setExamples((list) => [...list, example]);
      timer = window.setTimeout(() => next(i + 1), 0);
    };
    timer = window.setTimeout(() => next(0), 30);
    return () => clearTimeout(timer);
    // snapshot is a new function each render; the examples depend only on the choices made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, candidates]);

  useEffect(() => {
    /** Close the wizard on Escape. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>New board</h2>
          <ol className="crumbs">
            <li className={page === 1 ? 'on' : ''} onClick={() => setPage(1)}>1. Size</li>
            <li className={page === 2 ? 'on' : ''} onClick={() => setPage(2)}>2. Design</li>
          </ol>
          <button onClick={onClose} title="Close (Esc)">✕</button>
        </header>

        {page === 1 && (
          <section>
            <p>How big should the finished board be?</p>
            <div className="row">
              <Len label="Length" value={target.length} min={4} onChange={(length) => setTarget({ ...target, length })} />
              <Len label="Width" value={target.width} min={3} onChange={(width) => setTarget({ ...target, width })} />
              <Len label="Thickness" value={target.thickness} min={0.375} onChange={(thickness) => setTarget({ ...target, thickness })} />
            </div>
            <div className="wizard-sizes" role="radiogroup" aria-label="Common sizes">
              {COMMON_SIZES.map((c) => (
                <button
                  key={c.label}
                  role="radio"
                  aria-checked={sameSize(c.size, target)}
                  className={sameSize(c.size, target) ? 'on' : ''}
                  onClick={() => setTarget(c.size)}
                >
                  <strong>{c.label}</strong>
                  <small>{inches(c.size.length)} × {inches(c.size.width)} × {inches(c.size.thickness)}</small>
                </button>
              ))}
            </div>
            <footer>
              <button className="primary" onClick={() => setPage(2)}>Next: design ▶</button>
            </footer>
          </section>
        )}

        {page === 2 && (
          <section>
            <p>
              Pick a design. Each is drawn at{' '}
              {inches(target.length)} × {inches(target.width)} × {inches(target.thickness)}, or as close as its pattern allows.
              End grain or edge grain is chosen afterwards, on the board, along with its woods and sizes.
            </p>
            {examples.length < candidates.length && <p className="note">Drawing examples… {examples.length} of {candidates.length}</p>}
            <div className="wizard-examples">
              {examples.map((ex) => (
                <button key={ex.key} disabled={!!ex.final.error} onClick={() => onCreate(ex.design)}>
                  {ex.image && <img src={ex.image} alt="" />}
                  <strong>{ex.label}</strong>
                  <span>{ex.blurb}</span>
                  <small>{ex.final.error ? ex.final.error : `Finishes at ${sizeText(ex.final)}`}</small>
                </button>
              ))}
            </div>
            <footer><button onClick={() => setPage(1)}>◀ Size</button></footer>
          </section>
        )}
      </div>
    </div>
  );
}
