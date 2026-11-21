import { useEffect, useMemo, useState } from 'react';
import { fitThickness, fitToTarget } from '../model/fit';
import { inches } from '../model/fractions';
import { run } from '../model/pipeline';
import { CHESS_SQUARES, PRESETS, chessBoard, doubleBorder, doubleBorderCount, type BoardType, type Preset } from '../model/presets';
import type { Design, Stage } from '../model/types';
import { Len } from './inputs';

interface Props {
  /** Starting size, normally the current design's target. */
  initial: Design['target'];
  /** Open straight at the designs for this grain; used by the smoke test. */
  startType?: BoardType;
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

const GRAINS: { type: BoardType; title: string; text: string }[] = [
  {
    type: 'end',
    title: 'End grain',
    text: 'Blocks standing on end, fibres pointing up. Easiest on knife edges and hides cuts best. Two glue-ups: strips into a panel, then cross-cut slices turned up and glued again.',
  },
  {
    type: 'edge',
    title: 'Edge grain',
    text: 'Long strips glued side by side, fibres running the length of the board. One glue-up, less wood lost to the saw, and the quickest board to make. Shows knife marks sooner.',
  },
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

/** A starter design resized to the wanted board: length and width by stock, then thickness. */
function sized(preset: Preset, target: Design['target']): Design {
  const base = preset.make();
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
 * Two-page dialog for starting a board. The first page asks for its size and which grain faces
 * up; the second offers the designs of that grain, built to the size asked for. Picking one opens
 * it for editing, where its woods and sizes are changed like any other board's. The chess board
 * is eight squares each way, as wide as the board asked for; the double border board is a whole
 * number of blocks, the nearest to the size.
 */
export function BoardWizard({ initial, startType, snapshot, onCreate, onClose }: Props) {
  const [target, setTarget] = useState(initial);
  const [grain, setGrain] = useState<BoardType>(startType ?? 'end');
  const [page, setPage] = useState<1 | 2>(startType ? 2 : 1);
  const [examples, setExamples] = useState<Example[]>([]);

  const candidates = useMemo<Candidate[]>(() => {
    // Slices not turned on end show face grain; that is the edge-grain way to make these two.
    const way = grain === 'end' ? 'end' : 'face';
    const blocks = {
      along: doubleBorderCount(target.length, DOUBLE.block, DOUBLE.line),
      across: doubleBorderCount(target.width, DOUBLE.block, DOUBLE.line),
    };
    return [
      ...PRESETS.filter((p) => p.type === grain).map((p) => ({ key: p.key, label: p.label, blurb: p.blurb, make: () => sized(p, target) })),
      {
        key: `chess-${way}`,
        label: way === 'end' ? 'End-grain chess board' : 'Face-grain chess board',
        blurb: way === 'end'
          ? 'Eight squares each way, as wide as the board asked for. Two glue-ups: eight strips, then eight slices turned on end with every other one turned end for end.'
          : 'Eight squares each way, as wide as the board asked for, from thinner stock: eight strips, cross cut into eight slices, every other one turned end for end. Solid wood this wide moves with the seasons, so do not glue it into a tight frame.',
        make: () => chessBoard({ ...CHESS, square: chessSquare(target), thickness: target.thickness, grain: way }),
      },
      {
        key: `double-${way}`,
        label: way === 'end' ? 'End-grain double border' : 'Face-grain double border',
        blurb: way === 'end'
          ? 'Maple blocks, each ringed with walnut, in a white oak grid. Three glue-ups: strips with a cheap spacer in them, then slices turned on end with a three-strip stack between them, then the panel sawn through each spacer and the oak glued into the kerfs.'
          : 'Maple blocks, each ringed with walnut, in a white oak grid: three glue-ups without turning the slices up, from thinner stock. Solid wood this wide moves with the seasons, so do not glue it into a tight frame.',
        make: () => doubleBorder({ ...DOUBLE, ...blocks, thickness: target.thickness, grain: way }),
      },
    ];
  }, [grain, target]);

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
            <li className={page === 1 ? 'on' : ''} onClick={() => setPage(1)}>1. Size and grain</li>
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
            <p>Which grain faces up?</p>
            <div className="wizard-types" role="radiogroup" aria-label="Grain">
              {GRAINS.map((g) => (
                <button key={g.type} role="radio" aria-checked={grain === g.type} className={grain === g.type ? 'on' : ''} onClick={() => setGrain(g.type)}>
                  <strong>{g.title}</strong>
                  <span>{g.text}</span>
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
              {grain === 'end' ? 'End-grain' : 'Edge-grain'} boards, built as close to{' '}
              {inches(target.length)} × {inches(target.width)} × {inches(target.thickness)} as their block sizes allow.
              Pick one to start from; its woods and everything else in it can be changed.
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
            <footer><button onClick={() => setPage(1)}>◀ Size and grain</button></footer>
          </section>
        )}
      </div>
    </div>
  );
}
