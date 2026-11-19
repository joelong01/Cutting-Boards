import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCutList } from './model/cutlist';
import { fitToTarget, withAutoFit } from './model/fit';
import { inches } from './model/fractions';
import { withAutoName } from './model/naming';
import { matches, pieceCount, run } from './model/pipeline';
import { PRESETS, defaultDesign, type BoardType } from './model/presets';
import { allSpecies, speciesById } from './model/species';
import {
  desktop, download, exportDesign, fileSafe, library as store, loadCurrent, saveCurrent, validateDesign, type LibraryEntry,
} from './model/storage';
import type { Design, Selector, Stage, Step } from './model/types';
import { BoardWizard } from './ui/BoardWizard';
import { CutListPanel } from './ui/CutListPanel';
import { LayupEditor } from './ui/LayupEditor';
import { StepList } from './ui/StepList';
import { Len, toggle } from './ui/inputs';
import { Viewport, type ViewportHandle } from './view/Viewport';

const params = new URLSearchParams(location.search);

/** The design to open with: the preset named in the URL, else the one left open last time, else the default. */
/**
 * A design as it should open: fitted to its target when it holds its board size, and named from
 * its woods when the app still owns its name.
 */
const held = (d: Design): Design => withAutoName(d.autoFit === false ? d : fitToTarget(d), allSpecies(d));

function initialDesign(): Design {
  const key = params.get('preset');
  const preset = key && PRESETS.find((p) => p.key === key);
  return held(preset ? preset.make() : loadCurrent() ?? defaultDesign());
}

const SIDE_KEY = 'cutting-boards.side-width.v1';
const SIDE_DEFAULT = 440;
const SIDE_MIN = 300;
/** The least room the 3D view keeps, however far the splitter is dragged. */
const STAGE_MIN = 320;

/** The side panel width to start with: the one saved last time if it is sensible, else the default. */
function savedSideWidth(): number {
  try {
    const v = Number(localStorage.getItem(SIDE_KEY));
    return Number.isFinite(v) && v >= SIDE_MIN ? v : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
}

interface History {
  past: Design[];
  now: Design;
  future: Design[];
}

/** The whole app: owns the design and its undo history, runs the recipe, and lays out the header, editors, 3D view and print sheet. */
export function App() {
  const [history, setHistory] = useState<History>(() => ({ past: [], now: initialDesign(), future: [] }));
  const design = history.now;
  /** Replace the design, pushing the old one onto the undo stack and clearing redo. */
  const setDesign = useCallback((next: Design) => {
    setHistory((h) => {
      if (next === h.now) return h;
      // Fit first, then name: the name describes the design as it ends up.
      return { past: [...h.past.slice(-99), h.now], now: withAutoName(withAutoFit(h.now, next), allSpecies(next)), future: [] };
    });
  }, []);
  /** Step back to the previous design, if there is one. */
  const undo = useCallback(() => setHistory((h) => (h.past.length
    ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1], future: [h.now, ...h.future] } : h)), []);
  /** Step forward again after an undo, if there is anything to redo. */
  const redo = useCallback(() => setHistory((h) => (h.future.length
    ? { past: [...h.past, h.now], now: h.future[0], future: h.future.slice(1) } : h)), []);

  const species = useMemo(() => allSpecies(design), [design.customSpecies]); // eslint-disable-line react-hooks/exhaustive-deps
  const stages = useMemo(
    () => run(design, (id) => speciesById(species, id).name),
    [design.layup, design.steps, design.finish, species], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const cutList = useMemo(() => buildCutList(stages, design), [stages, design.allowance]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selected, setSelected] = useState(() => Number(params.get('stage') ?? 9999));
  const index = Math.min(Math.max(0, selected), stages.length - 1);
  const [tab, setTab] = useState<'design' | 'cutlist'>(params.get('tab') === 'cutlist' ? 'cutlist' : 'design');
  const [gap, setGap] = useState(0.5);
  const [lines, setLines] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  /** Reload the list of saved designs, reporting a failure in the message bar. */
  const refreshLibrary = useCallback(() => store.list().then(setLibrary, (e) => setMessage(`Could not list saved designs: ${String(e)}`)), []);
  useEffect(() => void refreshLibrary(), [refreshLibrary]);
  const [menu, setMenu] = useState<'new' | 'open' | null>(null);
  const wizardParam = params.get('wizard');
  const [wizard, setWizard] = useState(wizardParam !== null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string[]>([]);
  const [preview, setPreview] = useState(params.get('preview') !== null);
  const [withPictures, setWithPictures] = useState(false);
  const [sideWidth, setSideWidth] = useState(savedSideWidth);
  const dragging = useRef(false);
  /** A side panel width kept between its minimum and what leaves the 3D view its minimum. */
  const clampSide = (w: number) => Math.round(Math.max(SIDE_MIN, Math.min(w, window.innerWidth - STAGE_MIN)));
  /** Set the side panel width and remember it for next time. */
  const resizeSide = (w: number) => {
    const width = clampSide(w);
    setSideWidth(width);
    try {
      localStorage.setItem(SIDE_KEY, String(width));
    } catch {
      // Not remembered this time; the panel still resizes.
    }
  };
  const viewport = useRef<ViewportHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveCurrent(design), [design]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  // Animate only when stepping forward one stage through an unchanged recipe.
  const last = useRef<{ stages: Stage[]; index: number }>({ stages, index });
  const from = last.current.stages === stages && index === last.current.index + 1 ? stages[index - 1] : null;
  useEffect(() => {
    last.current = { stages, index };
  });

  useEffect(() => {
    if (!playing) return;
    if (index >= stages.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setSelected(index + 1), 1500);
    return () => clearTimeout(t);
  }, [playing, index, stages.length]);

  useEffect(() => {
    /** Keyboard shortcuts: undo, redo, save, and (outside form fields) arrows to step and Space to play. */
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        setPreview(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        // The browser's own Ctrl+P would print the hidden sheet unseen; show it first.
        e.preventDefault();
        setPreview(true);
      } else if (!typing && e.key === 'ArrowRight') setSelected((s) => Math.min(Math.min(s, stages.length - 1) + 1, stages.length - 1));
      else if (!typing && e.key === 'ArrowLeft') setSelected((s) => Math.max(0, Math.min(s, stages.length - 1) - 1));
      else if (!typing && e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, stages.length]);

  // The step that produced the stage on screen; its selection is outlined and clickable.
  const step: Step | undefined = index > 0 ? design.steps[index - 1] : undefined;
  const sel: Selector | null = step && 'sel' in step ? step.sel : null;
  const stage = stages[index];
  const highlights = useMemo(
    () => (sel && sel.mode !== 'all' && stage.kind === 'slices' ? stage.slices.map((_, i) => i).filter((i) => matches(sel, i)) : []),
    [sel, stage],
  );
  /** Toggle a clicked slice in the selected step's selection, switching that step to hand-picked. */
  const onPick = (slice: number) => {
    if (!step || !sel) {
      setMessage('Select a Turn, Flip or Offset step to choose its slices by clicking.');
      return;
    }
    const current = stage.slices.map((_, i) => i).filter((i) => matches(sel, i));
    const next: Selector = { mode: 'pick', indices: toggle(current, slice) };
    setDesign({ ...design, steps: design.steps.map((s) => (s.id === step.id ? ({ ...s, sel: next } as Step) : s)) });
  };

  const savedAs = useRef<string | null>(null);
  /** Open a design, discarding undo history and showing its finished stage. fromLibrary marks it as already saved under its name. */
  const load = (d: Design, fromLibrary = false) => {
    savedAs.current = fromLibrary ? d.name : null;
    setHistory({ past: [], now: held(d), future: [] });
    setSelected(9999);
    setMenu(null);
    setPlaying(false);
  };

  /** Save the design under its name, asking before replacing a different saved design of the same name. */
  const save = async () => {
    try {
      // Saving under a name that is already on disk replaces that file, so ask first unless
      // it is the design that was opened or saved in this session.
      if (savedAs.current !== design.name && (await store.exists(design))
        && !confirm(`A saved design named “${design.name}” already exists. Replace it?`)) return;
      const where = await store.save(design);
      savedAs.current = design.name;
      // A saved design keeps its name: renaming it later would leave the old file behind.
      if (design.autoName !== false) setHistory((h) => ({ ...h, now: { ...h.now, autoName: false } }));
      setMessage(`Saved to ${where}`);
      await refreshLibrary();
    } catch (e) {
      setMessage(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /** Render a picture of every stage into the print sheet, then print it or save it as a PDF. */
  /**
   * Open the print preview: the sheet exactly as it will print. The cut list and steps are always
   * on it; pictures of each stage are added only when asked for.
   */
  const openPreview = () => {
    setPreview(true);
    setMenu(null);
  };

  /** Turn the stage pictures on the sheet on or off, drawing them the first time they are wanted. */
  const setPictures = (on: boolean) => {
    setWithPictures(on);
    const v = viewport.current;
    if (on && v) setSheet(stages.map((s) => (s.error ? '' : v.snapshot(s, [900, 560]))));
  };

  /** Send the sheet in the preview to the printer, or save it as a PDF. */
  const print = (toPdf: boolean) => {
    if (toPdf && desktop) {
      desktop.savePdf(fileSafe(design.name)).then(
        (where) => where && setMessage(`PDF saved to ${where}`),
        (e) => setMessage(`PDF failed: ${String(e)}`),
      );
    } else window.print();
  };

  const final = stages[stages.length - 1];
  const errors = stages.filter((s) => s.error).length;

  return (
    <div className="app" style={{ gridTemplateColumns: `${Math.min(sideWidth, clampSide(sideWidth))}px 7px 1fr` }}>
      <header className="top">
        <h1>Cutting Boards</h1>
        <input className="name" value={design.name} onChange={(e) => setDesign({ ...design, name: e.target.value, autoName: false })} title="Design name. It follows the woods until you type your own or save." />
        <div className="menu">
          <button onClick={() => setMenu(menu === 'new' ? null : 'new')}>New ▾</button>
          {menu === 'new' && (
            <div className="dropdown">
              <button
                onClick={() => {
                  setMenu(null);
                  setWizard(true);
                }}
              ><strong>Board wizard…</strong><small>Choose a size and a grain type, then pick from common designs.</small></button>
              <hr />
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => load(p.make())}>
                  <strong>{p.label}</strong><small>{p.blurb}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => void save()} title={desktop ? 'Save as a file in the designs folder (Ctrl+S)' : 'Save under this name in this browser (Ctrl+S)'}>Save</button>
        <div className="menu">
          <button onClick={() => setMenu(menu === 'open' ? null : 'open')}>Open ▾</button>
          {menu === 'open' && (
            <div className="dropdown">
              {library.length === 0 && <p>No saved designs yet.</p>}
              {library.map((entry) => (
                <div className="saved" key={entry.key}>
                  <button
                    onClick={() => store.open(entry.key).then((d) => load(d, true), (e) => setMessage(`Could not open ${entry.name}: ${e instanceof Error ? e.message : String(e)}`))}
                  ><strong>{entry.name}</strong></button>
                  <button
                    title={desktop ? 'Move this design to the recycle bin' : 'Delete this saved design'}
                    onClick={() => {
                      if (confirm(desktop ? `Move “${entry.name}” to the recycle bin?` : `Delete the saved design “${entry.name}”?`)) {
                        void store.remove(entry.key).then(refreshLibrary, (e) => setMessage(`Could not delete: ${String(e)}`));
                      }
                    }}
                  >✕</button>
                </div>
              ))}
              {desktop && <button onClick={() => void desktop?.reveal()}><strong>Show the designs folder…</strong></button>}
              <button onClick={() => fileInput.current?.click()}><strong>Import a .board.json file…</strong></button>
            </div>
          )}
        </div>
        <button onClick={() => exportDesign(design)} title="Save a copy of this design somewhere else">Export</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              load(validateDesign(JSON.parse(await file.text())));
            } catch (err) {
              setMessage(`Could not open ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }}
        />
        <span className="spacer" />
        <button onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Y)">↷</button>
        <button onClick={() => download(`${fileSafe(design.name)}-step-${index + 1}.png`, viewport.current?.capture() ?? '')} title="Save the current view as a picture">PNG</button>
        <button onClick={openPreview} title="Preview and print the cut list and order of operations, or save them as a PDF">Print…</button>
      </header>

      <aside className="side">
        <nav className="tabs">
          <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>Design</button>
          <button className={tab === 'cutlist' ? 'on' : ''} onClick={() => setTab('cutlist')}>Cut list and steps</button>
        </nav>
        {tab === 'design' ? (
          <>
            <section className="card">
              <h3>Target board</h3>
              <div className="row">
                <Len label="Length" value={design.target.length} min={1} onChange={(length) => setDesign({ ...design, target: { ...design.target, length } })} />
                <Len label="Width" value={design.target.width} min={1} onChange={(width) => setDesign({ ...design, target: { ...design.target, width } })} />
                <Len label="Thickness" value={design.target.thickness} min={0.125} onChange={(thickness) => setDesign({ ...design, target: { ...design.target, thickness } })} />
              </div>
              <label className="check" title="When on, changing strip sizes or steps changes how many strips and how much stock you need, not how big the board is.">
                <input type="checkbox" checked={design.autoFit !== false} onChange={(e) => setDesign({ ...design, autoFit: e.target.checked })} />
                Keep the board at this size
              </label>
              <div className="row">
                <button
                  disabled={errors > 0 || design.autoFit !== false}
                  title="Changes the pattern repeat and the stock length so the finished board is at least this long and wide"
                  onClick={() => {
                    const fitted = fitToTarget(design);
                    setDesign(fitted);
                    setMessage(fitted === design ? 'Already fits.' : `Now ${fitted.layup.repeat} repeats from ${inches(fitted.layup.length)} stock.`);
                  }}
                >Fit stock to target</button>
                <p className="note">
                  Finishes at {inches(Math.max(final.size[0], final.size[2]))} × {inches(Math.min(final.size[0], final.size[2]))} × {inches(final.size[1])}.
                </p>
              </div>
            </section>
            <LayupEditor design={design} species={species} onChange={setDesign} onNotice={setMessage} />
            <StepList design={design} stages={stages} species={species} selected={index} onSelect={setSelected} onChange={setDesign} />
          </>
        ) : (
          <CutListPanel design={design} cutList={cutList} species={species} onChange={setDesign} />
        )}
      </aside>

      <div
        className="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        tabIndex={0}
        title="Drag to resize. Double-click to reset. Arrow keys also work."
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current) resizeSide(e.clientX);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onDoubleClick={() => resizeSide(SIDE_DEFAULT)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            resizeSide(sideWidth + (e.key === 'ArrowRight' ? 24 : -24));
          }
        }}
      />

      <main className="stage">
        <Viewport ref={viewport} stage={stage} from={from} species={species} gap={gap} lines={lines} highlights={highlights} onPick={onPick}
          // A Trim step names the sides it cuts, so the view names them too while one is selected.
          edgeLabels={index > 0 && design.steps[index - 1]?.type === 'trim'}
        />
        <div className="overlay info">
          <strong>{index + 1}. {stage.title}</strong>
          <span>{inches(stage.size[0])} × {inches(stage.size[2])} × {inches(stage.size[1])} thick</span>
          <span>{stage.kind === 'slices' ? `${stage.slices.length} loose slices, ` : ''}{pieceCount(stage)} pieces</span>
          {stage.error && <span className="error">{stage.error}</span>}
          {/* Selecting a step shows the board as that step leaves it, which looks as if the later steps were lost. */}
          {!playing && index < stages.length - 1 && (
            <span className="not-final">
              Showing step {index + 1} of {stages.length}. Later steps are not drawn here.
              <button onClick={() => setSelected(stages.length - 1)}>Show finished board</button>
            </span>
          )}
          {stage.warning && <span className="warning">{stage.warning}</span>}
        </div>
        <div className="overlay tools">
          <button onClick={() => viewport.current?.view('iso')}>3D</button>
          <button onClick={() => viewport.current?.view('top')}>Top</button>
          <button onClick={() => viewport.current?.view('front')}>Side</button>
          <button onClick={() => viewport.current?.view('end')}>End</button>
          <label className="check"><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />Glue lines</label>
          <label className="slider" title="Space between loose slices">
            Spread
            <input type="range" min={0} max={2} step={0.05} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
          </label>
        </div>
        <div className="overlay stepper">
          <button onClick={() => setSelected(0)} disabled={index === 0} title="First stage">⏮</button>
          <button onClick={() => setSelected(index - 1)} disabled={index === 0} title="Previous (←)">◀</button>
          <button
            className="play"
            onClick={() => {
              if (!playing && index >= stages.length - 1) setSelected(0);
              setPlaying(!playing);
            }}
            title="Play the build (Space)"
          >{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <button onClick={() => setSelected(index + 1)} disabled={index >= stages.length - 1} title="Next (→)">▶</button>
          <button onClick={() => setSelected(stages.length - 1)} disabled={index >= stages.length - 1} title="Finished board">⏭</button>
          <span className="dots">
            {stages.map((s, i) => (
              <i key={i} className={`${i === index ? 'on' : ''}${s.error ? ' bad' : ''}`} title={`${i + 1}. ${s.title}`} onClick={() => setSelected(i)} />
            ))}
          </span>
        </div>
        {stage.summary && <div className="overlay caption">{stage.summary}</div>}
        {message && <div className="overlay toast">{message}</div>}
      </main>

      {wizard && (
        <BoardWizard
          initial={design.target}
          startType={wizardParam === 'end' || wizardParam === 'edge' ? (wizardParam as BoardType) : undefined}
          snapshot={(s) => viewport.current?.snapshot(s, [560, 340]) ?? ''}
          onClose={() => setWizard(false)}
          onCreate={(d) => {
            load(d);
            setWizard(false);
          }}
        />
      )}

      <div className={`preview${preview ? ' open' : ''}`} onClick={() => setPreview(false)}>
        <div className="preview-bar" onClick={(e) => e.stopPropagation()}>
          <strong>Print preview</strong>
          <label className="check">
            <input type="checkbox" checked={withPictures} onChange={(e) => setPictures(e.target.checked)} />
            Include a picture of each stage
          </label>
          <span className="spacer" />
          <button className="primary" onClick={() => print(false)}>Print</button>
          {desktop && <button onClick={() => print(true)}>Save as PDF</button>}
          <button onClick={() => setPreview(false)} title="Close (Esc)">Close</button>
        </div>
        <div className="print-sheet" onClick={(e) => e.stopPropagation()}>
          <h1>{design.name}</h1>
          {withPictures && (
            <div className="print-stages">
              {stages.map((s, i) => (
                <figure key={i}>
                  {sheet[i] && <img src={sheet[i]} alt="" />}
                  <figcaption><strong>{i + 1}. {s.title}</strong></figcaption>
                </figure>
              ))}
            </div>
          )}
          <CutListPanel design={design} cutList={cutList} species={species} />
        </div>
      </div>
    </div>
  );
}
