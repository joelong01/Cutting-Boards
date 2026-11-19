import { useEffect, useMemo, useState } from 'react';
import { fitThickness, fitToTarget } from '../model/fit';
import { inches } from '../model/fractions';
import { run } from '../model/pipeline';
import { PRESETS, type BoardType, type Preset } from '../model/presets';
import type { Design, Stage } from '../model/types';
import { Len } from './inputs';

interface Props {
  /** Starting size, normally the current design's target. */
  initial: Design['target'];
  /** Open straight at the examples for this type; used by the smoke test. */
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

const TYPES: { type: BoardType; title: string; text: string }[] = [
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

interface Example {
  preset: Preset;
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

/** Three-page dialog for starting a board: its size, its grain type, then a common example of that type built to that size. */
export function BoardWizard({ initial, startType, snapshot, onCreate, onClose }: Props) {
  const [target, setTarget] = useState(initial);
  const [type, setType] = useState<BoardType | null>(startType ?? null);
  const [page, setPage] = useState<1 | 2 | 3>(startType ? 3 : 1);
  const [examples, setExamples] = useState<Example[]>([]);

  const presets = useMemo(() => PRESETS.filter((p) => p.type === type), [type]);

  // Sizing and drawing an example takes a moment, so add them one per tick: the page paints
  // first and each card appears as it is ready, instead of the dialog freezing until all are done.
  useEffect(() => {
    if (page !== 3) return;
    setExamples([]);
    let timer = 0;
    /** Build example i, show it, and schedule the next one. */
    const next = (i: number) => {
      if (i >= presets.length) return;
      const preset = presets[i];
      const design = sized(preset, target);
      const stages = run(design);
      const final = stages[stages.length - 1];
      const example = { preset, design, final, image: final.error ? '' : snapshot(final) };
      setExamples((list) => [...list, example]);
      timer = window.setTimeout(() => next(i + 1), 0);
    };
    timer = window.setTimeout(() => next(0), 30);
    return () => clearTimeout(timer);
    // snapshot is a new function each render; the examples depend only on the choices made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, presets, target]);

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
            <footer><button className="primary" onClick={() => setPage(2)}>Next: type ▶</button></footer>
          </section>
        )}

        {page === 2 && (
          <section>
            <p>Which way should the grain face?</p>
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

        {page === 3 && (
          <section>
            <p>
              Common {type === 'end' ? 'end-grain' : 'edge-grain'} boards, built as close to{' '}
              {inches(target.length)} × {inches(target.width)} × {inches(target.thickness)} as their block sizes allow.
              Pick one to start from; everything in it can be changed.
            </p>
            {examples.length < presets.length && <p className="note">Drawing examples… {examples.length} of {presets.length}</p>}
            <div className="wizard-examples">
              {examples.map((ex) => (
                <button key={ex.preset.key} disabled={!!ex.final.error} onClick={() => onCreate(ex.design)}>
                  {ex.image && <img src={ex.image} alt="" />}
                  <strong>{ex.preset.label}</strong>
                  <span>{ex.preset.blurb}</span>
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
