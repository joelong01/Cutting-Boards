import { useEffect, useMemo, useState } from 'react';
import { run } from '../model/pipeline';
import { LEVELS, catalog, type Offer } from '../model/presets';
import type { Design, Stage } from '../model/types';
import { Len } from './inputs';
import { useShow } from './show';

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

/** One design the wizard offers on its last page, built and drawn. */
interface Example extends Offer {
  design: Design;
  final: Stage;
  image: string;
}

/** Whether two board sizes are the same, so the matching common-size button can be highlighted. */
const sameSize = (a: Design['target'], b: Design['target']) =>
  Math.abs(a.length - b.length) < 1e-6 && Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.thickness - b.thickness) < 1e-6;

/**
 * Two-page dialog for starting a board. The first page asks for its size; the second offers every
 * design once, built to that size, drawn full face, named and described without a word about grain. The designs are a
 * list to pick from: a click picks one, and OK, Enter or a double click starts it. Picking one opens it for editing, where its woods, its sizes
 * and which grain is on top are changed like any other board's: end grain or edge grain is not a
 * kind of board here, only whether the recipe stands the slices up. The chess board is eight
 * squares each way, as wide as the board asked for; the double border board is a whole number of
 * blocks, the nearest to the size.
 */
export function BoardWizard({ initial, startAtDesigns, snapshot, onCreate, onClose }: Props) {
  const [target, setTarget] = useState(initial);
  const [page, setPage] = useState<1 | 2>(startAtDesigns ? 2 : 1);
  const [examples, setExamples] = useState<Example[]>([]);
  // The design picked in the list, by key: one click picks it, and OK or a double click starts it.
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = examples.find((ex) => ex.key === picked && !ex.final.error);

  const { len: inches } = useShow();
  /** A finished stage's size as length x width x thickness, longer side first. */
  const sizeText = (st: Stage) =>
    `${inches(Math.max(st.size[0], st.size[2]))} × ${inches(Math.min(st.size[0], st.size[2]))} × ${inches(st.size[1])}`;
  const candidates = useMemo(() => catalog(target), [target]);

  // Sizing and drawing an example takes a moment, so add them one per tick: the page paints
  // first and each card appears as it is ready, instead of the dialog freezing until all are done.
  useEffect(() => {
    if (page !== 2) return;
    setExamples([]);
    setPicked(null);
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
    /** Close the wizard on Escape, and start the picked design on Enter. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter' && page === 2 && chosen) onCreate(chosen.design);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onCreate, page, chosen]);

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
              Pick a design and press OK, or double-click one. They run from the easiest to make to the hardest, and each is drawn at{' '}
              {inches(target.length)} × {inches(target.width)} × {inches(target.thickness)}, or as close as its pattern allows.
              End grain or edge grain is chosen afterwards, on the board, along with its woods and sizes.
            </p>
            {examples.length < candidates.length && <p className="note">Drawing examples… {examples.length} of {candidates.length}</p>}
            {LEVELS.filter((l) => examples.some((ex) => ex.level === l.level)).map((l) => (
              <div key={l.level} className="wizard-level">
                <h3>{l.label}</h3>
                <div className="wizard-examples" role="listbox" aria-label={`${l.label} designs`}>
                  {examples.filter((ex) => ex.level === l.level).map((ex) => (
                    <button
                      key={ex.key}
                      role="option"
                      aria-selected={picked === ex.key}
                      className={picked === ex.key ? 'on' : ''}
                      disabled={!!ex.final.error}
                      onClick={() => setPicked(ex.key)}
                      onDoubleClick={() => onCreate(ex.design)}
                    >
                      {ex.image && <img src={ex.image} alt="" />}
                      <strong>{ex.label}</strong>
                      <span>{ex.blurb}</span>
                      <small>{ex.final.error ? ex.final.error : `Finishes at ${sizeText(ex.final)}`}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <footer className="wizard-pick">
              <button onClick={() => setPage(1)}>◀ Size</button>
              <span className="note">{chosen ? chosen.label : 'Click a design to pick it, or double-click to start it.'}</span>
              <button className="primary" disabled={!chosen} onClick={() => chosen && onCreate(chosen.design)}>OK</button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
