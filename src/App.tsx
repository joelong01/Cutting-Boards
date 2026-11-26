import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCutList } from './model/cutlist';
import { fitToTarget, withAutoFit } from './model/fit';
import { convertGrain, grainOf, withGrain, type Grain } from './model/grain';
import { withAutoName } from './model/naming';
import { DEFAULT_DIMENSIONS, dimensionsOf, layupOf } from './model/design';
import { matches, pieceCount, run, wholeSteps } from './model/pipeline';
import { PRESETS, catalog, defaultDesign, designs, offerOf } from './model/presets';
import { allSpecies, speciesById } from './model/species';
import {
  desktop, download, exportDesign, fileSafe, library as store, loadCurrent, saveCurrent, validateDesign, type LibraryEntry,
} from './model/storage';
import type { Design, Dimensions, Notation, Selector, Stage, Step } from './model/types';
import { BoardWizard } from './ui/BoardWizard';
import { CutListPanel } from './ui/CutListPanel';
import { ROUNDINGS, showLength, showSize, showText, unitsOf, usualRounding } from './model/units';
import { UnitsContext } from './ui/show';
import { Icon } from './ui/icons';
import { LayupEditor } from './ui/LayupEditor';
import { StepList } from './ui/StepList';
import { Len, toggle } from './ui/inputs';
import { Viewport, type ViewportHandle } from './view/Viewport';

const params = new URLSearchParams(location.search);

/** The design to open with: the preset named in the URL, else the one left open last time, else the default. */
/**
 * A design as it should open: with dimension settings (the usual ones, if it was saved before
 * there were any), fitted to its target when it holds its board size, and named from its woods
 * when the app still owns its name.
 */
const held = (d: Design): Design => {
  // One saved with some settings but not the newer ones gets those at their usual values.
  const set = { ...d, dimensions: { ...DEFAULT_DIMENSIONS, ...d.dimensions } };
  return withAutoName(set.autoFit === false ? set : fitToTarget(set), allSpecies(set));
};

function initialDesign(): Design {
  const key = params.get('preset');
  const preset = key && PRESETS.find((p) => p.key === key);
  const made = preset ? preset.make() : loadCurrent() ?? defaultDesign();
  // `rounding=0` opens the board with exact sizes, for checks of the fit itself.
  const rounding = params.get('rounding');
  return held(rounding === null ? made : { ...made, dimensions: { ...DEFAULT_DIMENSIONS, ...made.dimensions, rounding: Number(rounding) || 0 } });
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

const HIDDEN_KEY = 'cutting-boards.side-hidden.v1';
/** Below this window width (a phone) the side panel starts hidden unless it was shown last time. */
const NARROW = 700;

/** Whether the side panel starts hidden: as it was left last time, else hidden only on a narrow screen. */
function savedSideHidden(): boolean {
  try {
    const v = localStorage.getItem(HIDDEN_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    // No storage; fall through to the screen width.
  }
  return window.innerWidth < NARROW;
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
  // The open design under a second name, for functions whose own `design` parameter hides it.
  const current = design;
  // The open design's name, for the keyboard handler, which is set up once and would otherwise see an old one.
  const nameRef = useRef(design.name);
  nameRef.current = design.name;
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
    // The dimensions are in the list because the board is built from the rounded sizes and flags strips under the minimum.
    [design.steps, design.finish, design.dimensions, species], // eslint-disable-line react-hooks/exhaustive-deps
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
  const [menu, setMenu] = useState<'new' | 'open' | 'export' | null>(null);
  const wizardParam = params.get('wizard');
  const [wizard, setWizard] = useState(wizardParam !== null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string[]>([]);
  const [preview, setPreview] = useState(params.get('preview') !== null);
  const [withPictures, setWithPictures] = useState(params.get('pictures') !== null);
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
  // The name being typed in the Save as box, or null while the box is closed.
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [sideHidden, setSideHidden] = useState(savedSideHidden);
  /** Hide or show the side panel, so the board can have the whole window, and remember which. */
  const toggleSide = () =>
    setSideHidden((hidden) => {
      try {
        localStorage.setItem(HIDDEN_KEY, hidden ? '0' : '1');
      } catch {
        // Not remembered this time; the panel still hides.
      }
      return !hidden;
    });
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
    /** Keyboard shortcuts: undo, redo, save, save as, hide the side panel, and (outside form fields) arrows to step and Space to play. */
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) setSaveAs(nameRef.current);
        else void saveRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSide();
      } else if (e.key === 'Escape') {
        setPreview(false);
        setSaveAs(null);
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
  // The step cards show each step whole, while the view steps through every operation: these
  // go between a card's place in the list and a stage's.
  const cards = useMemo(() => {
    const whole = wholeSteps(design, stages);
    const steps = whole.filter((st) => st.step !== undefined).length;
    const firstTouch = stages.findIndex((st) => st.step === undefined);
    /** The stage that shows a card's result: the last operation of its step, or its finishing touch. */
    const stageOf = (card: number) => (card < steps ? stages.map((st) => st.step).lastIndexOf(card) : firstTouch + (card - steps));
    /** The card a stage belongs to. */
    const cardOf = (at: number) => stages[at].step ?? steps + (at - firstTouch);
    /** A card's number: the numbers of the operations it covers, as they are in the view and the instructions. */
    const numberOf = (card: number) => {
      const last = stageOf(card), first = card < steps ? stages.findIndex((st) => st.step === card) : last;
      return first === last ? String(last + 1) : `${first + 1}–${last + 1}`;
    };
    return { whole, stageOf, cardOf, numberOf };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages]);
  const step: Step | undefined = stages[index].step === undefined ? undefined : design.steps[stages[index].step!];
  // A card picked in the list shows its step's result: its last operation. The card is noted and
  // turned into a stage once the stages are those of the design as it now is, because picking a
  // card and changing the design (adding a step, say) can happen in one go.
  const [wantCard, setWantCard] = useState<number | null>(null);
  useEffect(() => {
    if (wantCard === null) return;
    setSelected(cards.stageOf(wantCard));
    setWantCard(null);
  }, [wantCard, cards]);
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
    // A board started here keeps the notation, rounding and minimum already in use; one opened from a file keeps its own.
    setHistory({ past: [], now: held(fromLibrary || d.dimensions ? d : { ...d, dimensions: design.dimensions }), future: [] });
    setSelected(9999);
    setMenu(null);
    setPlaying(false);
  };

  /**
   * Save a design, the open one unless another is given, under its name, asking before replacing
   * a different saved design of the same name.
   */
  const save = async (design = current) => {
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

  /**
   * Give the design the name typed in the Save as box and save it under that name. The name is
   * the user's from then on: it no longer follows the woods.
   */
  const confirmSaveAs = () => {
    const name = (saveAs ?? '').trim();
    if (!name) return;
    const renamed = { ...current, name, autoName: false };
    setSaveAs(null);
    setDesign(renamed);
    void save(renamed);
  };

  // The design's name is shown in the window's title bar (the browser tab, on the web).
  useEffect(() => {
    document.title = `${current.name} - Cutting Boards`;
  }, [current.name]);

  /** Draw a picture of every stage for the print sheet, as the design is now. */
  const drawSheet = () => {
    const v = viewport.current;
    if (v) setSheet(stages.map((s) => (s.error ? '' : v.snapshot(s, [900, 560]))));
  };

  // While the preview is open with pictures on, keep them in step with the design.
  useEffect(() => {
    if (preview && withPictures) drawSheet();
    // drawSheet is a new function each render; the pictures depend only on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, withPictures, stages]);

  /**
   * Open the print preview: the sheet exactly as it will print. The cut list and steps are always
   * on it; with pictures on, each step is shown beside its instruction.
   */
  const openPreview = () => {
    setPreview(true);
    setMenu(null);
  };

  /** Ask where to save the sheet as it stands and write it there as a PDF. Desktop app only. */
  const savePdf = () => {
    desktop?.savePdf(fileSafe(design.name)).then(
      (where) => where && setMessage(`PDF saved to ${where}`),
      (e) => setMessage(`PDF failed: ${String(e)}`),
    );
  };

  /** Send the sheet in the preview to the printer, or save it as a PDF. */
  const print = (toPdf: boolean) => {
    if (toPdf && desktop) savePdf();
    else window.print();
  };

  /**
   * Export the cut list and steps as a PDF, with or without a picture of each step. The sheet is
   * in the page even while the preview is closed, so it is set up, given a moment to draw and
   * load its pictures, and saved. In a plain browser there is no file dialog to call, so the
   * preview opens instead and the browser's own print dialog can save a PDF.
   */
  const exportPdf = (pictures: boolean) => {
    setMenu(null);
    setWithPictures(pictures);
    if (pictures) drawSheet();
    if (!desktop) {
      setPreview(true);
      return;
    }
    setTimeout(() => {
      const images = [...document.querySelectorAll<HTMLImageElement>('.print-sheet img')];
      void Promise.all(images.map((img) => img.decode().catch(() => undefined))).then(savePdf);
    }, 80);
  };

  const final = stages[stages.length - 1];
  const errors = stages.filter((s) => s.error).length;
  // Every length in the window is written the way the design's Dimensions say.
  const units = unitsOf(design);
  const dims = dimensionsOf(design);
  /** A length written that way. */
  const inches = (v: number) => showLength(v, units);
  /** Change some of the design's dimension settings. */
  const setDims = (patch: Partial<Dimensions>) => setDesign({ ...design, dimensions: { ...dims, ...patch } });
  const offers = catalog(design.target);
  const offer = offerOf(design);

  return (
    <UnitsContext.Provider value={units}>
    <div
      className={sideHidden ? 'app side-hidden' : 'app'}
      style={{ gridTemplateColumns: sideHidden ? '0 0 1fr' : `${Math.min(sideWidth, clampSide(sideWidth))}px 7px 1fr` }}
    >
      <header className="top">
        {/* The toolbar: groups of buttons with an icon over a label, each group named underneath,
            the way an Office ribbon is laid out. The design's name is in the window's title bar. */}
        <div className="group">
        <div>
        <div className="menu">
          <button className={`rb drop${menu === 'new' ? ' open' : ''}`} onClick={() => setMenu(menu === 'new' ? null : 'new')} title="Start a new board"><Icon name="new" /><span>New</span></button>
          {menu === 'new' && (
            <div className="dropdown">
              <button
                onClick={() => {
                  setMenu(null);
                  setWizard(true);
                }}
              ><strong>Board wizard…</strong><small>Choose a size and end or edge grain, then pick from the designs.</small></button>
              <hr />
              {designs().map((p) => (
                <button key={p.key} onClick={() => load(p.make())}>
                  <strong>{p.label}</strong><small>{p.blurb}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="menu">
          <button className={`rb drop${menu === 'open' ? ' open' : ''}`} onClick={() => setMenu(menu === 'open' ? null : 'open')} title="Open a saved design"><Icon name="open" /><span>Open</span></button>
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
        <button className="rb" onClick={() => void save()} title={desktop ? 'Save as a file in the designs folder (Ctrl+S)' : 'Save under this name in this browser (Ctrl+S)'}><Icon name="save" /><span>Save</span></button>
        <button className="rb" onClick={() => setSaveAs(design.name)} title="Save under a new name (Ctrl+Shift+S)"><Icon name="saveas" /><span>Save as</span></button>
        </div>
        <small>File</small>
        </div>
        <div className="group">
        <div>
        <button className="rb" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)"><Icon name="undo" /><span>Undo</span></button>
        <button className="rb" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Y)"><Icon name="redo" /><span>Redo</span></button>
        </div>
        <small>Edit</small>
        </div>
        <div className="group">
        <div>
        <div className="menu">
          <button className={`rb drop${menu === 'export' ? ' open' : ''}`} onClick={() => setMenu(menu === 'export' ? null : 'export')} title="Export a PDF or the design file"><Icon name="export" /><span>Export</span></button>
          {menu === 'export' && (
            <div className="dropdown export-menu">
              <button onClick={() => exportPdf(false)}>
                <strong>PDF: cut list and steps…</strong><small>The stock to mill and the written order of operations.</small>
              </button>
              <button onClick={() => exportPdf(true)}>
                <strong>PDF with a picture of each step…</strong><small>The same, with every step drawn beside its instruction.</small>
              </button>
              <hr />
              <button
                onClick={() => {
                  setMenu(null);
                  exportDesign(design);
                }}
              ><strong>Design file (.board.json)…</strong><small>A copy of this design to keep somewhere else or send to someone.</small></button>
            </div>
          )}
        </div>
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
        <button className="rb" onClick={openPreview} title="Preview and print the cut list and order of operations, or save them as a PDF (Ctrl+P)"><Icon name="print" /><span>Print</span></button>
        <button className="rb" onClick={() => download(`${fileSafe(design.name)}-step-${index + 1}.png`, viewport.current?.capture() ?? '')} title="Save the current 3D view as a PNG picture"><Icon name="picture" /><span>Picture</span></button>
        </div>
        <small>Share</small>
        </div>
        <div className="group">
        <div>
        <button
          className="rb side-toggle"
          onClick={toggleSide}
          aria-pressed={!sideHidden}
          title={sideHidden ? 'Show the side panel (Ctrl+B)' : 'Hide the side panel so the board has the whole window (Ctrl+B)'}
        ><Icon name="panel" /><span>{sideHidden ? 'Show panel' : 'Hide panel'}</span></button>
        </div>
        <small>View</small>
        </div>
      </header>

      <aside className="side">
        <nav className="tabs">
          <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>Design</button>
          <button className={tab === 'cutlist' ? 'on' : ''} onClick={() => setTab('cutlist')}>Cut list and steps</button>
        </nav>
        {tab === 'design' ? (
          <>
            <section className="card board-pick" onClick={() => setSelected(stages.length - 1)} title="Shows the finished board">
              <h3>Target board</h3>
              <label className="field">
                <span>Design</span>
                <select
                  aria-label="Design"
                  value={offer ?? ''}
                  title="Change the board to another design at the same size. Its strips and steps are replaced; Ctrl+Z brings the old board back."
                  onChange={(e) => {
                    const pick = offers.find((o) => o.key === e.target.value);
                    if (!pick) return;
                    setDesign({ ...pick.make(), dimensions: design.dimensions });
                    setSelected(9999);
                    setMessage(`Now ${pick.label}. Ctrl+Z brings the old board back.`);
                  }}
                >
                  {!offer && <option value="">Your own design</option>}
                  {offers.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </label>
              <div className="grain-switch" role="group" aria-label="Grain on top">
                {(['end', 'edge'] as Grain[]).map((g) => {
                  // Only whether it can be turned round, which is cheap; the refit runs on the click.
                  const can = convertGrain(design, g) !== null;
                  return (
                    <button
                      key={g}
                      className={grainOf(design) === g ? 'on' : ''}
                      aria-pressed={grainOf(design) === g}
                      disabled={!can}
                      title={!can
                        ? 'This recipe cannot be turned round: it is built from several panels or cut at an angle.'
                        : g === 'end'
                          ? 'End grain on top: the slices are cut and stood on end. Kinder to knives.'
                          : 'Edge grain on top: the slices lie flat and the stock is thinner. Block ends are glued to each other, so the joints are weaker and the board can crack as it moves.'}
                      onClick={() => {
                        const turned = withGrain(design, g);
                        if (!turned || turned === design) return;
                        setDesign(turned);
                        setMessage(g === 'end' ? 'Now end grain: the slices are turned up on end.' : 'Now edge grain: the slices lie flat and the stock is milled thinner.');
                      }}
                    >{g === 'end' ? 'End grain' : 'Edge grain'}</button>
                  );
                })}
              </div>
            </section>
            <section className="card target" onClick={() => setSelected(stages.length - 1)} title="Shows the finished board">
              <h3>Dimensions</h3>
              <div className="row">
                <Len label="Length" value={design.target.length} min={1} onChange={(length) => setDesign({ ...design, target: { ...design.target, length } })} />
                <Len label="Width" value={design.target.width} min={1} onChange={(width) => setDesign({ ...design, target: { ...design.target, width } })} />
                <Len label="Thickness" value={design.target.thickness} min={0.125} onChange={(thickness) => setDesign({ ...design, target: { ...design.target, thickness } })} />
              </div>
              <div className="row">
                <label className="field">
                  <span>Units</span>
                  <select
                    aria-label="Units"
                    value={dims.notation}
                    title="How every length is written, like the modes of a caliper. Lengths are still typed in inches."
                    onChange={(e) => {
                      const notation = e.target.value as Notation;
                      // The step follows the notation: 1/16 inch, a hundredth of an inch, half a millimetre.
                      setDims({ notation, rounding: dims.rounding > 0 ? usualRounding(notation) : 0 });
                    }}
                  >
                    <option value="fraction">Inches, fractions</option>
                    <option value="decimal">Inches, decimal</option>
                    <option value="metric">Millimetres</option>
                  </select>
                </label>
                <label className="field">
                  <span>Round to</span>
                  <select
                    aria-label="Round to"
                    value={String(dims.rounding)}
                    title="Every size is rounded to this, in the instructions and in the board drawn, so what you read is what you can cut. A coarse step moves the finished size off the target."
                    onChange={(e) => setDims({ rounding: Number(e.target.value) })}
                  >
                    <option value="0">Exact</option>
                    {ROUNDINGS[dims.notation].map((r) => <option key={r.label} value={String(r.step)}>{r.label}</option>)}
                    {dims.rounding > 0 && !ROUNDINGS[dims.notation].some((r) => Math.abs(r.step - dims.rounding) < 1e-9) && <option value={String(dims.rounding)}>{inches(dims.rounding)}</option>}
                  </select>
                </label>
                <Len
                  label="Saw kerf"
                  value={dims.kerf ?? 0.125}
                  min={0}
                  title="How thick your saw blade cuts. Every cut uses it, and the stock is sized to allow for the wood it turns to dust."
                  onChange={(kerf) => setDims({ kerf })}
                />
                <Len
                  label="Thinnest strip"
                  value={dims.minWidth}
                  min={0}
                  title="The thinnest strip your planer or sander can work. Anything thinner in the recipe is flagged. 0 turns the check off."
                  onChange={(minWidth) => setDims({ minWidth })}
                />
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
                    setMessage(fitted === design ? 'Already fits.' : `Now ${layupOf(fitted).repeat} repeats from ${inches(layupOf(fitted).length)} stock.`);
                  }}
                >Fit stock to target</button>
                <p className="note">
                  Finishes at {inches(Math.max(final.size[0], final.size[2]))} × {inches(Math.min(final.size[0], final.size[2]))} × {inches(final.size[1])}.
                </p>
              </div>
            </section>
            <LayupEditor warning={cards.whole[0]?.error ? undefined : cards.whole[0]?.warning} design={design} species={species} onChange={setDesign} onNotice={setMessage} selected={cards.cardOf(index) === 0} onSelect={() => setWantCard(0)} />
            <StepList design={design} stages={cards.whole} species={species} selected={cards.cardOf(index)} onSelect={setWantCard} onChange={setDesign} numberOf={cards.numberOf} />
          </>
        ) : (
          <CutListPanel design={design} cutList={cutList} species={species} onChange={setDesign} units={units} />
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

      {/* A tab on the screen's edge, big enough for a thumb, that hides or shows the side panel. It sits
          outside the 3D view so it stays on screen when a phone shows the panel across the whole width;
          there it becomes a bar along the bottom, where it covers none of the panel's controls. */}
      <button
        className="side-handle"
        style={{ left: sideHidden ? 0 : Math.min(sideWidth, clampSide(sideWidth)) + 7 }}
        onClick={toggleSide}
        aria-label={sideHidden ? 'Show the side panel' : 'Hide the side panel'}
        title={sideHidden ? 'Show the side panel (Ctrl+B)' : 'Hide the side panel (Ctrl+B)'}
      >
        {sideHidden ? (
          <><b>☰</b><small>Edit</small></>
        ) : (
          <><b className="wide">‹</b><small className="wide">Board</small><span className="narrow">Show the board ›</span></>
        )}
      </button>

      <main className="stage">
        <Viewport ref={viewport} stage={stage} from={from} species={species} gap={gap} lines={lines} highlights={highlights} onPick={onPick}
          // A Trim step names the sides it cuts, so the view names them too while one is selected.
          edgeLabels={step?.type === 'trim'}
        />
        <div className="overlay info">
          <strong>{index + 1}. {stage.title}</strong>
          <span>{inches(stage.size[0])} × {inches(stage.size[2])} × {inches(stage.size[1])} thick</span>
          <span>{stage.kind === 'slices' ? `${stage.slices.length} loose slices, ` : stage.kind === 'strips' ? `${stage.slices.length} loose strips, ` : ''}{pieceCount(stage)} pieces</span>
          {stage.error && <span className="error">{showText(stage.error, units)}</span>}
          {/* Selecting a step shows the board as that step leaves it, which looks as if the later steps were lost. */}
          {!playing && index < stages.length - 1 && (
            <span className="not-final">
              Showing step {index + 1} of {stages.length}. Later steps are not drawn here.
              <button onClick={() => setSelected(stages.length - 1)}>Show finished board</button>
            </span>
          )}
          {stage.warning && <span className="warning">{showText(stage.warning, units)}</span>}
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
        {stage.summary && <div className="overlay caption">{showText(stage.summary, units)}</div>}
        {message && <div className="overlay toast">{message}</div>}
      </main>

      {saveAs !== null && (
        <div className="modal-back" onClick={() => setSaveAs(null)}>
          <form
            className="modal save-as"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              confirmSaveAs();
            }}
          >
            <header><h2>Save as</h2></header>
            <label className="field">
              <span>Name for this design</span>
              <input autoFocus value={saveAs} onChange={(e) => setSaveAs(e.target.value)} onFocus={(e) => e.target.select()} />
            </label>
            <p className="note">{desktop ? 'Saved as a file of this name in the designs folder.' : 'Saved under this name in this browser.'} The name is shown in the title bar.</p>
            <footer>
              <button type="button" onClick={() => setSaveAs(null)}>Cancel</button>
              <button type="submit" className="primary" disabled={!saveAs.trim()}>Save</button>
            </footer>
          </form>
        </div>
      )}

      {wizard && (
        <BoardWizard
          initial={design.target}
          startAtDesigns={wizardParam === 'designs'}
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
            <input type="checkbox" checked={withPictures} onChange={(e) => setWithPictures(e.target.checked)} />
            Show a picture of each step
          </label>
          <span className="spacer" />
          <button className="primary" onClick={() => print(false)}>Print</button>
          {desktop && <button onClick={() => print(true)}>Save as PDF</button>}
          <button onClick={() => setPreview(false)} title="Close (Esc)">Close</button>
        </div>
        <div className="print-sheet" onClick={(e) => e.stopPropagation()}>
          <h1>{design.name}</h1>
          <CutListPanel design={design} cutList={cutList} species={species} steps={!withPictures} units={units} />
          {withPictures && (
            <div className="print-steps">
              <h3>Order of operations</h3>
              {stages.map((s, i) => (
                <figure key={i}>
                  {sheet[i] ? <img src={sheet[i]} alt="" /> : <div className="no-picture" />}
                  <figcaption>
                    <strong>{i + 1}. {s.title}</strong>
                    <span className="dim">{showSize([s.size[0], s.size[2], s.size[1]], units)} thick{s.kind === 'slices' ? `, ${s.slices.length} slices` : ''}</span>
                    <p>{showText(s.summary, units)}</p>
                    {(s.error ?? s.warning) && <p className="warning">Check: {showText(s.error ?? s.warning ?? '', units)}</p>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </UnitsContext.Provider>
  );
}
