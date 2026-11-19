import { useEffect, useMemo, useState } from 'react';
import { fitThickness, fitToTarget } from '../model/fit';
import { inches } from '../model/fractions';
import { run } from '../model/pipeline';
import { CHESS_SQUARES, PRESETS, chessBoard, type BoardType, type Preset } from '../model/presets';
import { BUILTIN_SPECIES } from '../model/species';
import type { Design, Stage } from '../model/types';
import { Len, SpeciesSelect } from './inputs';

/** What the wizard can start: a board by which grain faces up, or a chess board. */
export type WizardType = BoardType | 'chess';

interface Props {
  /** Starting size, normally the current design's target. */
  initial: Design['target'];
  /** Open straight at the examples for this type; used by the smoke test. */
  startType?: WizardType;
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

const TYPES: { type: WizardType; title: string; text: string }[] = [
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
  {
    type: 'chess',
    title: 'Chess board',
    text: `Always ${CHESS_SQUARES} × ${CHESS_SQUARES} squares in two woods. You choose the woods and the size of a square; the board is eight squares each way, whatever size was entered on the first page.`,
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

/**
 * Three-page dialog for starting a board: its size, its type, then designs of that type to pick
 * from. For end grain and edge grain those are the starter designs built to the size asked for.
 * A chess board is always eight squares each way, so its last page asks for the square size and
 * the two woods instead, and offers it end grain or face grain.
 */
export function BoardWizard({ initial, startType, snapshot, onCreate, onClose }: Props) {
  const [target, setTarget] = useState(initial);
  const [type, setType] = useState<WizardType | null>(startType ?? null);
  const [page, setPage] = useState<1 | 2 | 3>(startType ? 3 : 1);
  const [examples, setExamples] = useState<Example[]>([]);
  const [chess, setChess] = useState({ square: 2, dark: 'walnut', light: 'maple' });

  const candidates = useMemo<Candidate[]>(() => {
    if (type === 'chess') {
      const options = { ...chess, thickness: target.thickness };
      return [
        {
          key: 'chess-end',
          label: 'End-grain chess board',
          blurb: 'Two glue-ups: eight strips, then eight slices turned on end with every other one turned end for end. The strips are milled square, as thick as a square is wide.',
          make: () => chessBoard({ ...options, grain: 'end' }),
        },
        {
          key: 'chess-face',
          label: 'Face-grain chess board',
          blurb: 'The classic look, and thinner stock: eight strips, cross cut into eight slices, every other one turned end for end. Solid wood this wide moves with the seasons, so do not glue it into a tight frame.',
          make: () => chessBoard({ ...options, grain: 'face' }),
        },
      ];
    }
    return PRESETS.filter((p) => p.type === type)
      .map((p) => ({ key: p.key, label: p.label, blurb: p.blurb, make: () => sized(p, target) }));
  }, [type, target, chess]);

  // Sizing and drawing an example takes a moment, so add them one per tick: the page paints
  // first and each card appears as it is ready, instead of the dialog freezing until all are done.
  useEffect(() => {
    if (page !== 3) return;
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
            <li className={page === 2 ? 'on' : ''} onClick={() => setPage(2)}>2. Type</li>
            <li className={page === 3 ? 'on' : ''} onClick={() => type && setPage(3)}>3. Design</li>
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
            <p className="note">A chess board takes only its thickness from here: it is always eight squares each way.</p>
            <footer><button className="primary" onClick={() => setPage(2)}>Next: type ▶</button></footer>
          </section>
        )}

        {page === 2 && (
          <section>
            <p>What kind of board?</p>
            <div className="wizard-types">
              {TYPES.map((t) => (
                <button
                  key={t.type}
                  className={type === t.type ? 'on' : ''}
                  onClick={() => {
                    setType(t.type);
                    setPage(3);
                  }}
                >
                  <strong>{t.title}</strong>
                  <span>{t.text}</span>
                </button>
              ))}
            </div>
            <footer><button onClick={() => setPage(1)}>◀ Size</button></footer>
          </section>
        )}

        {page === 3 && type === 'chess' && (
          <section>
            <p>
              A chess board: {CHESS_SQUARES} × {CHESS_SQUARES} squares, {inches(chess.square * CHESS_SQUARES)} each way.
              Choose the two woods and the size of a square, then pick how to build it.
            </p>
            <div className="row wizard-chess">
              <label className="field"><span>Dark squares</span>
                <SpeciesSelect value={chess.dark} species={BUILTIN_SPECIES} onChange={(dark) => setChess({ ...chess, dark })} />
              </label>
              <label className="field"><span>Light squares</span>
                <SpeciesSelect value={chess.light} species={BUILTIN_SPECIES} onChange={(light) => setChess({ ...chess, light })} />
              </label>
              <Len label="Square" value={chess.square} min={0.5} onChange={(square) => setChess({ ...chess, square })} />
              <Len label="Thickness" value={target.thickness} min={0.375} onChange={(thickness) => setTarget({ ...target, thickness })} />
            </div>
            {chess.dark === chess.light && <p className="note">Both woods are the same, so the squares will not show.</p>}
          </section>
        )}

        {page === 3 && (
          <section>
            {type !== 'chess' && (
              <p>
                Common {type === 'end' ? 'end-grain' : 'edge-grain'} boards, built as close to{' '}
                {inches(target.length)} × {inches(target.width)} × {inches(target.thickness)} as their block sizes allow.
                Pick one to start from; everything in it can be changed.
              </p>
            )}
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
            <footer><button onClick={() => setPage(2)}>◀ Type</button></footer>
          </section>
        )}
      </div>
    </div>
  );
}
