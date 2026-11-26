import { useState, type ReactNode } from 'react';
import { accentStrips, patternPeriod, withAccentStrips } from '../model/accent';
import { dimensionsOf, layupOf, withLayup } from '../model/design';
import { FEET_TITLE, FINISH_STEPS, SAND_TITLE, stepTitle } from '../model/pipeline';
import { finishOf } from '../model/finish';
import { speciesById } from '../model/species';
import { newId } from '../model/presets';
import type { AccentStrip, Design, Finish, FinishPart, PatternStrip, Species, Stage, Step, StepType, StripSpec } from '../model/types';
import { Int, Len, SelectorEditor, SpeciesSelect } from './inputs';
import { useShow } from './show';

interface Props {
  design: Design;
  stages: Stage[];
  species: Species[];
  selected: number;
  onSelect: (stageIndex: number) => void;
  onChange: (d: Design) => void;
  /**
   * The number shown on a card: the numbers its operations have in the view and the written
   * instructions, as "8" or "8–9". Without it cards are numbered by their place in the list.
   */
  numberOf?: (card: number) => string;
}

/** The steps that can be added to a recipe, in the order the toolbar's Add step menu lists them, each with what it does. */
export const ADDABLE: { type: StepType; hint: string }[] = [
  { type: 'crosscut', hint: 'Cut the panel into slices, square or at an angle' },
  { type: 'rip', hint: 'Saw the panel lengthways into strips' },
  { type: 'turn', hint: 'Roll slices 90° so the end grain faces up' },
  { type: 'flip', hint: 'Turn slices end for end, or face down' },
  { type: 'shift', hint: 'Slide slices along their length (brick, steps)' },
  { type: 'insert', hint: 'Add thin accent strips between slices' },
  { type: 'glue', hint: 'Glue the slices into a new panel' },
  { type: 'trim', hint: 'Square up the edges' },
  { type: 'flatten', hint: 'Take a little off both faces' },
  { type: 'rotate', hint: 'Turn the panel 90° so the next cut is a rip' },
  { type: 'frame', hint: 'Glue a border round the panel, with a thin line inside it if you like' },
  { type: 'panel', hint: 'Set these slices aside and glue up a second panel, for a pattern one panel cannot make' },
  { type: 'combine', hint: 'Bring back the slices set aside and put a new slice after each' },
];


/**
 * The recipe from step 2 on as a list of cards: one per step and one for Finish, each with its
 * settings, result size and any error, plus the buttons that add steps. Step 1, milling and gluing
 * the strips, is the LayupEditor card above this list.
 */
export function StepList({ design, stages, species, selected, onSelect, onChange, numberOf = (card) => String(card + 1) }: Props) {
  const { len: inches, text } = useShow();
  /** The blade's tilt for a rip: 0 is a square cut, and 30 rips the boards of a 3D board into diamond strips. */
  const tiltField = (step: Extract<Step, { type: 'rip' }>) => (
    <label className="field" title="How far the blade leans from upright. 0 is a square rip. 30° rips the boards of a 3D board into strips with a diamond cross-section.">
      <span>Blade tilt °</span>
      <input className="int" type="number" min={0} max={45} step={5} value={step.tilt ?? 0} onChange={(e) => setStep(step.id, { tilt: Number(e.target.value) || undefined })} />
    </label>
  );
  // With a saw kerf set under Dimensions every cut uses it, and the steps do not ask for their own.
  const ownKerf = dimensionsOf(design).kerf === undefined;
  // While the board size is held, counts are worked out, not typed.
  const held = design.autoFit !== false;
  /** A stage's size as length x width x thickness. */
  const sizeText = (s: Stage) => `${inches(s.size[0])} × ${inches(s.size[2])} × ${inches(s.size[1])}`;
  /** Change some fields of one step. */
  const setStep = (id: string, patch: Partial<Step>) =>
    onChange({ ...design, steps: design.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as Step) : s)) });
  /** Swap step i with its neighbour d places away and keep it selected. */
  const move = (i: number, d: number) => {
    const j = i + d;
    // The strips stay first: there is nothing to work on until they are made.
    if (j < 1 || j >= design.steps.length) return;
    const steps = [...design.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    onChange({ ...design, steps });
    onSelect(j);
  };
  // Which patterned strip has its panel open for editing, as "step id:strip number", or null.
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const finish = finishOf(design);
  /** Change part of the finishing options. */
  const setFinish = (patch: Partial<Finish>) => onChange({ ...design, finish: { ...finish, ...patch } });
  // The finishing steps, when the recipe ends in a panel, follow the last step: one for each
  // touch that is turned on, then the sanding.
  const firstFinish = design.steps.length;
  /** The number of the stage of a finishing step, or -1 when it is off or there is no panel to finish. */
  const finishAt = (part: Stage['finish']) => stages.findIndex((st, n) => n >= firstFinish && st.finish === part);
  const anyTouch = finish.groove.on || finish.chamfer.on || finish.corners.on || finish.roundover.on;
  /**
   * The card for one finishing touch: a tick to have it or not, and its sizes when it is on. A
   * touch that is on is a numbered step, and clicking its card shows the board as that cut leaves it.
   * The board on show always has the touch being worked on. Going into one of its size fields
   * moves the view to this touch's step when the step on show is an earlier one, which does not
   * have the cut yet. A later step, or the finished board, already shows it and is left alone:
   * moving back from there would take the later cuts off the board, as if the groove had been
   * lost by changing the chamfer.
   */
  const touchCard = (part: FinishPart, fields: ReactNode) => {
    const at = finishAt(part), st = at >= 0 ? stages[at] : undefined;
    const on = finish[part].on;
    const title = FINISH_STEPS.find((t) => t.part === part)!.title;
    return (
      <div key={part} className={`step touch${st && selected === at ? ' selected' : ''}${on ? '' : ' off'}`} onClick={() => st && onSelect(at)}>
        <header>
          {st && <em>{numberOf(at)}</em>}
          {/* Only the tick turns the touch on and off. The title is outside its label, so clicking
              the title selects the card like any other step's; a touch that is off has no step to
              select, so there its title works the tick instead. */}
          <label className="check" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" aria-label={title} checked={on} onChange={(e) => setFinish({ [part]: { ...finish[part], on: e.target.checked } })} />
            {!st && <strong>{title}</strong>}
          </label>
          {st && <strong>{title}</strong>}
        </header>
        {/* A click anywhere in the card selects it: on a label, on the space round the fields, or on a field, which takes the focus as well. Tabbing into a field selects it too. */}
        {on && <div className="params" onFocus={() => st && onSelect(at)}>{fields}</div>}
        {st?.warning && <p className="warning">{text(st.warning)}</p>}
      </div>
    );
  };
  return (
    <section className="steps">
      {design.steps.map((step, i) => {
        // The strips have a card of their own, above this list.
        if (step.type === 'strips') return null;
        const st = stages[i];
        const before = stages[i - 1];
        // Every step after the first can be moved or removed.
        const pinned = i < 1;
        return (
          <div key={step.id} className={`step${selected === i ? ' selected' : ''}${st.error ? ' broken' : ''}`} onClick={() => onSelect(i)}>
            <header>
              <em>{numberOf(i)}</em>
              <strong>{stepTitle(step)}</strong>
              <span className="icons" onClick={(e) => e.stopPropagation()} style={pinned ? { display: 'none' } : undefined}>
                <button title="Move earlier" disabled={i <= 1} onClick={() => move(i, -1)}>↑</button>
                <button title="Move later" disabled={i === design.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button
                  title="Remove step"
                  onClick={() => {
                    onChange({ ...design, steps: design.steps.filter((s) => s.id !== step.id) });
                    onSelect(Math.min(selected, design.steps.length - 2));
                  }}
                >✕</button>
              </span>
            </header>
            {/* Clicks are left to reach the card, which selects it; a field clicked takes the focus as well. */}
            <div className="params" onFocus={() => onSelect(i)}>
              {step.type === 'rip' && !step.tilt && (
                <div className="row">
                  <Len label="Strip width" value={step.width} min={0.125} onChange={(width) => setStep(step.id, { width })} />
                  {ownKerf && <Len label="Kerf" value={step.kerf} onChange={(kerf) => setStep(step.id, { kerf })} />}
                  {tiltField(step)}
                </div>
              )}
              {step.type === 'rip' && !!step.tilt && (
                <>
                  <div className="row">
                    {tiltField(step)}
                    <Int
                      label={held ? 'Strips from each board (from target)' : 'Strips from each board'}
                      value={layupOf(design).repeat} min={1} max={40} disabled={held}
                      onChange={(repeat) => onChange(withLayup(design, { repeat }))}
                    />
                  </div>
                  <p className="note">Blade tilted {step.tilt}°. Each strip is a diamond in cross-section, about {inches(step.width)} on every side.</p>
                </>
              )}
              {step.type === 'crosscut' && (
                <div className="row">
                  <Len label="Slice width" value={step.width} min={0.0625} onChange={(width) => setStep(step.id, { width })} />
                  {ownKerf && <Len label="Kerf" value={step.kerf} onChange={(kerf) => setStep(step.id, { kerf })} />}
                  <Len
                    label="Spacer sawn out"
                    value={step.spacer ?? 0}
                    min={0}
                    title="For a cut that saws out spacer strips: how wide they are. The cut takes that much between slices, in more than one pass if the blade is thinner. 0 for an ordinary cut."
                    onChange={(spacer) => setStep(step.id, { spacer: spacer > 0 ? spacer : undefined })}
                  />
                  <label className="field">
                    <span>Angle °</span>
                    <input className="int" type="number" min={-75} max={75} step={5} value={step.angle} onChange={(e) => setStep(step.id, { angle: Number(e.target.value) || 0 })} />
                  </label>
                </div>
              )}
              {(step.type === 'turn' || step.type === 'flip' || step.type === 'shift') && (
                <>
                  {step.type === 'flip' && (
                    <label className="field">
                      <span>How</span>
                      <select value={step.how} onChange={(e) => setStep(step.id, { how: e.target.value as 'end' | 'face' })}>
                        <option value="end">End for end</option>
                        <option value="face">Face down</option>
                      </select>
                    </label>
                  )}
                  {step.type === 'shift' && <Len label="Slide by" value={step.amount} min={-48} onChange={(amount) => setStep(step.id, { amount })} />}
                  <SelectorEditor sel={step.sel} count={before.kind === 'slices' ? before.slices.length : 0} onChange={(sel) => setStep(step.id, { sel })} />
                </>
              )}
              {step.type === 'insert' && (() => {
                const accents = accentStrips(step);
                /** Replace this step's strips with a new list. */
                const setAccents = (next: AccentStrip[]) =>
                  onChange({ ...design, steps: design.steps.map((s) => (s.id === step.id ? withAccentStrips(step, next) : s)) });
                /** Change the wood or thickness of strip k. */
                const edit = (k: number, patch: Partial<AccentStrip>) => setAccents(accents.map((a, n) => (n === k ? { ...a, ...patch } : a)));
                /** Swap strip k with its neighbour d places away, if there is one. */
                const swap = (k: number, d: number) => {
                  const next = [...accents];
                  [next[k], next[k + d]] = [next[k + d], next[k]];
                  setAccents(next);
                };
                return (
                  <>
                    <div className="strips accents">
                      {accents.map((a, k) => (
                        <div className="strip-row" key={k}>
                          {a.pattern ? (
                            <button
                              className="patterned"
                              title="A slice of another glue-up: these strips, repeated across a panel this thick. Click to change its strips."
                              onClick={() => setOpenPanel(openPanel === `${step.id}:${k}` ? null : `${step.id}:${k}`)}
                            >
                              <b>Panel {openPanel === `${step.id}:${k}` ? '▾' : '▸'}</b> {a.pattern.map((st) => `${speciesById(species, st.species).name} ${inches(st.width)}`).join(', ')}
                            </button>
                          ) : (
                            <SpeciesSelect value={a.species} species={species} onChange={(id) => edit(k, { species: id })} />
                          )}
                          <Len value={a.thickness} min={0.03125} onChange={(thickness) => edit(k, { thickness })} />
                          <span className="icons">
                            <button title="Move up" disabled={k === 0} onClick={() => swap(k, -1)}>↑</button>
                            <button title="Move down" disabled={k === accents.length - 1} onClick={() => swap(k, 1)}>↓</button>
                            <button title="Duplicate" onClick={() => setAccents([...accents.slice(0, k + 1), { ...a }, ...accents.slice(k + 1)])}>⧉</button>
                            <button title="Remove" disabled={accents.length === 1} onClick={() => setAccents(accents.filter((_, n) => n !== k))}>✕</button>
                          </span>
                        </div>
                      ))}
                    </div>
                    {accents.map((a, k) => {
                      if (!a.pattern || openPanel !== `${step.id}:${k}`) return null;
                      const pattern = a.pattern;
                      /** Replace this panel's strips. */
                      const setPattern = (next: PatternStrip[]) => edit(k, { pattern: next });
                      /** Change one strip of the panel. */
                      const editStrip = (n: number, patch: Partial<PatternStrip>) => setPattern(pattern.map((st, m) => (m === n ? { ...st, ...patch } : st)));
                      /** Swap panel strip n with its neighbour d places away. */
                      const swapStrip = (n: number, d: number) => {
                        const next = [...pattern];
                        [next[n], next[n + d]] = [next[n + d], next[n]];
                        setPattern(next);
                      };
                      return (
                        <div className="panel-editor" key={`panel-${k}`}>
                          <p className="note">This strip is a slice of a second glue-up. Its strips, in order across the panel, repeating every {inches(patternPeriod(a))}:</p>
                          {pattern.map((st, n) => (
                            <div className="panel-strip" key={n}>
                              <div className="strip-row">
                                <SpeciesSelect value={st.species} species={species} onChange={(id) => editStrip(n, { species: id })} />
                                <Len value={st.width} min={0.03125} onChange={(width) => editStrip(n, { width })} />
                                <span className="icons">
                                  <button title="Move up" disabled={n === 0} onClick={() => swapStrip(n, -1)}>↑</button>
                                  <button title="Move down" disabled={n === pattern.length - 1} onClick={() => swapStrip(n, 1)}>↓</button>
                                  <button title="Remove" disabled={pattern.length === 1} onClick={() => setPattern(pattern.filter((_, m) => m !== n))}>✕</button>
                                </span>
                              </div>
                              <div className="strip-row faced">
                                <label className="check" title="A plank with a layer of another wood glued to both faces before it goes into the panel. The plank and its two faces together are as thick as the panel.">
                                  <input
                                    type="checkbox"
                                    checked={!!st.faces}
                                    onChange={(e) => editStrip(n, { faces: e.target.checked ? { species: pattern.find((x) => x.species !== st.species)?.species ?? st.species, thickness: 0.125 } : undefined })}
                                  />
                                  Faced both sides
                                </label>
                                {st.faces && (
                                  <>
                                    <SpeciesSelect value={st.faces.species} species={species} onChange={(id) => editStrip(n, { faces: { ...st.faces!, species: id } })} />
                                    <Len value={st.faces.thickness} min={0.03125} onChange={(thickness) => editStrip(n, { faces: { ...st.faces!, thickness } })} />
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                          <div className="row">
                            <button onClick={() => setPattern([...pattern, { species: pattern[pattern.length - 1].species, width: pattern[pattern.length - 1].width }])}>+ Add panel strip</button>
                            <Len label="First strip starts, from edge A" value={a.offset ?? 0} onChange={(offset) => edit(k, { offset })} />
                          </div>
                        </div>
                      );
                    })}
                    <div className="row">
                      <button onClick={() => setAccents([...accents, { species: accents[accents.length - 1].species, thickness: accents[accents.length - 1].thickness }])}>+ Add strip</button>
                      <Int label="After every" value={step.every} min={1} max={50} onChange={(every) => setStep(step.id, { every })} />
                    </div>
                    {accents.some((a) => a.pattern) && (
                      <div className="row">
                        <Len
                          label="Slide every other one along by"
                          title="Patterned strips in every other gap are slid this far towards edge B, so two rows of a pattern alternate. 0 leaves them all alike."
                          value={step.stagger ?? 0}
                          onChange={(stagger) => setStep(step.id, { stagger })}
                        />
                      </div>
                    )}
                    <label className="check" title="Also puts the strips on the outside of the first and last slice, so the pattern is closed at both ends of the board.">
                      <input type="checkbox" checked={step.ends === true} onChange={(e) => setStep(step.id, { ends: e.target.checked })} />
                      Also on the outside of the first and last slice
                    </label>
                    {accents.length > 1 && (
                      <p className="note">
                        Each gap gets these {accents.length} strips together, in this order: {inches(accents.reduce((t, a) => t + a.thickness, 0))} in all.
                      </p>
                    )}
                  </>
                );
              })()}
              {step.type === 'trim' && (
                <>
                  <label className="check">
                    <input type="checkbox" checked={step.auto} onChange={(e) => setStep(step.id, { auto: e.target.checked })} />
                    Trim ragged long edges automatically
                  </label>
                  <div className="row">
                    <Len label="Extra off edge A" value={step.z0} onChange={(z0) => setStep(step.id, { z0 })} />
                    <Len label="Edge B" value={step.z1} onChange={(z1) => setStep(step.id, { z1 })} />
                    <Len label="End A" value={step.x0} onChange={(x0) => setStep(step.id, { x0 })} />
                    <Len label="End B" value={step.x1} onChange={(x1) => setStep(step.id, { x1 })} />
                  </div>
                </>
              )}
              {step.type === 'panel' && (() => {
                /** Replace this panel's strips. */
                const setStrips = (strips: StripSpec[]) => setStep(step.id, { strips });
                /** Change one strip of the panel. */
                const editStrip = (n: number, patch: Partial<StripSpec>) => setStrips(step.strips.map((st, m) => (m === n ? { ...st, ...patch } : st)));
                /** Swap strip n with its neighbour d places away. */
                const swapStrip = (n: number, d: number) => {
                  const next = [...step.strips];
                  [next[n], next[n + d]] = [next[n + d], next[n]];
                  setStrips(next);
                };
                const auto = step.repeat === undefined && step.length === undefined;
                const made = st.error ? null : st;
                return (
                  <>
                    <div className="row">
                      <Len label="Thickness" value={step.thickness} min={0.125} onChange={(thickness) => setStep(step.id, { thickness })} />
                      <Len
                        label="Extra width"
                        title="How much wider than the set-aside slices are long to make this panel, so its slices can be slid along later and still cover them."
                        value={step.extra}
                        onChange={(extra) => setStep(step.id, { extra })}
                      />
                    </div>
                    <div className="strips">
                      {step.strips.map((sp, n) => (
                        <div className="panel-strip" key={sp.id}>
                          <div className="strip-row">
                            <SpeciesSelect value={sp.species} species={species} onChange={(id) => editStrip(n, { species: id })} />
                            <Len value={sp.width} min={0.03125} onChange={(width) => editStrip(n, { width })} />
                            <span className="icons">
                              <button title="Move up" disabled={n === 0} onClick={() => swapStrip(n, -1)}>↑</button>
                              <button title="Move down" disabled={n === step.strips.length - 1} onClick={() => swapStrip(n, 1)}>↓</button>
                              <button title="Duplicate" onClick={() => setStrips([...step.strips.slice(0, n + 1), { ...sp, id: newId() }, ...step.strips.slice(n + 1)])}>⧉</button>
                              <button title="Remove" disabled={step.strips.length === 1} onClick={() => setStrips(step.strips.filter((_, m) => m !== n))}>✕</button>
                            </span>
                          </div>
                          <div className="strip-row faced">
                            <label className="check" title="A plank with a layer of another wood glued to both faces before it goes into the panel. The plank and its two faces together are as thick as the panel; flattening the panel thins the faces.">
                              <input
                                type="checkbox"
                                checked={!!sp.faces}
                                onChange={(e) => editStrip(n, { faces: e.target.checked ? { species: step.strips.find((x) => x.species !== sp.species)?.species ?? sp.species, thickness: 0.1875 } : undefined })}
                              />
                              Faced both sides
                            </label>
                            {sp.faces && (
                              <>
                                <SpeciesSelect value={sp.faces.species} species={species} onChange={(id) => editStrip(n, { faces: { ...sp.faces!, species: id } })} />
                                <Len value={sp.faces.thickness} min={0.03125} onChange={(thickness) => editStrip(n, { faces: { ...sp.faces!, thickness } })} />
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="row">
                      <button onClick={() => setStrips([...step.strips, { id: newId(), species: step.strips.at(-1)?.species ?? 'maple', width: 1 }])}>+ Add strip</button>
                    </div>
                    <label className="check" title="When on, the panel is made just wide enough and long enough for the slices set aside. Untick to enter the repeat count and stock length yourself.">
                      <input
                        type="checkbox"
                        checked={auto}
                        onChange={(e) => setStep(step.id, e.target.checked
                          ? { repeat: undefined, length: undefined }
                          : { repeat: Math.max(1, Math.round((made?.size[2] ?? 12) / Math.max(0.125, step.strips.reduce((w, x) => w + x.width, 0)))), length: made?.size[0] ?? 12 })}
                      />
                      Size it to the slices set aside
                    </label>
                    {!auto && (
                      <div className="row">
                        <Int label="Repeat pattern" value={step.repeat ?? 1} min={1} max={80} onChange={(repeat) => setStep(step.id, { repeat })} />
                        <Len label="Stock length" value={step.length ?? 12} min={1} onChange={(length) => setStep(step.id, { length })} />
                      </div>
                    )}
                  </>
                );
              })()}
              {step.type === 'frame' && (
                <>
                  <div className="row">
                    <label className="field"><span>Border</span>
                      <SpeciesSelect value={step.species} species={species} onChange={(id) => setStep(step.id, { species: id })} />
                    </label>
                    <Len label="Width" value={step.width} min={0.25} onChange={(width) => setStep(step.id, { width })} />
                    <Len label="Blocks about" title="On an end-grain board the border is made of blocks about this long, glued edge to edge." value={step.block} min={0.5} onChange={(block) => setStep(step.id, { block })} />
                  </div>
                  <div className="row">
                    <label className="field"><span>Line inside it</span>
                      <SpeciesSelect value={step.lineSpecies} species={species} onChange={(id) => setStep(step.id, { lineSpecies: id })} />
                    </label>
                    <Len label="Line (0 for none)" value={step.line} onChange={(line) => setStep(step.id, { line })} />
                  </div>
                </>
              )}
              {step.type === 'flatten' && (
                <div className="row">
                  <Len label="Off the top" value={step.top} onChange={(top) => setStep(step.id, { top })} />
                  <Len label="Off the bottom" value={step.bottom} onChange={(bottom) => setStep(step.id, { bottom })} />
                </div>
              )}
            </div>
            <input
              className="step-note"
              aria-label="Note"
              placeholder="Add a note to this step's instruction"
              title="Anything to add to this step's instruction that its sizes do not say: what to line a cut up with, say."
              value={step.note ?? ''}
              onChange={(e) => setStep(step.id, { note: e.target.value || undefined })}
            />
            {st.error && <p className="error">{text(st.error)}</p>}
            {st.warning && <p className="warning">{text(st.warning)}</p>}
            {!st.error && (
              <p className="result">
                {st.kind === 'slices' ? `${st.slices.length} slices · ` : ''}{sizeText(st)}{st.aside ? ` · ${st.aside.length} slices set aside` : ''}
              </p>
            )}
          </div>
        );
      })}
      <h3 className="finishing">Finishing</h3>
      {touchCard('corners', (
        <div className="row">
          <Len label="Corner radius" value={finish.corners.radius} min={0.0625} onChange={(radius) => setFinish({ corners: { ...finish.corners, radius } })} />
        </div>
      ))}
      {touchCard('chamfer', (
        <div className="row">
          <Len label="Chamfer" value={finish.chamfer.size} min={0.0625} onChange={(size) => setFinish({ chamfer: { ...finish.chamfer, size } })} />
        </div>
      ))}
      {touchCard('roundover', (
        <div className="row">
          <Len label="Roundover (bit)" value={finish.roundover.radius} min={0.03125} onChange={(radius) => setFinish({ roundover: { ...finish.roundover, radius } })} />
        </div>
      ))}
      {finish.groove.on && touchCard('template', (
        <>
          <div className="row">
            <Len label="Strip width" value={finish.template.stripWidth} min={0.5} onChange={(stripWidth) => setFinish({ template: { ...finish.template, stripWidth } })} />
            <Len label="Thickness" value={finish.template.thickness} min={0.125} onChange={(thickness) => setFinish({ template: { ...finish.template, thickness } })} />
          </div>
          <small className="hint">A frame stuck to the top, inside the groove. The router rests on it and the bit's bearing runs round its outside edge.</small>
        </>
      ))}
      {touchCard('groove', (
        <>
          <label className="check" title="Moves each side of the groove to the nearest place that sits evenly on the pattern: centred in a row of blocks or on an accent line.">
            <input type="checkbox" checked={finish.groove.align} onChange={(e) => setFinish({ groove: { ...finish.groove, align: e.target.checked } })} />
            Line the groove up with the pattern
          </label>
          <div className="row">
            <Len label={finish.groove.align ? 'About, from edge' : 'In from edge'} value={finish.groove.inset} onChange={(inset) => setFinish({ groove: { ...finish.groove, inset } })} />
            <Len label="Width (bit)" value={finish.groove.width} min={0.125} onChange={(width) => setFinish({ groove: { ...finish.groove, width } })} />
            <Len label="Depth" value={finish.groove.depth} min={0.0625} onChange={(depth) => setFinish({ groove: { ...finish.groove, depth } })} />
            <Len
              label="Path corner radius"
              value={finish.groove.cornerRadius}
              title="How tightly the centre of the bit turns each corner. 0 is a router guided by straight rails: the outside of the groove's corner takes the bit's own radius and the inside stays sharp."
              onChange={(cornerRadius) => setFinish({ groove: { ...finish.groove, cornerRadius } })}
            />
          </div>
        </>
      ))}
      {finishAt('sand') >= 0 && (
        <div className={`step touch${selected === finishAt('sand') ? ' selected' : ''}`} onClick={() => onSelect(finishAt('sand'))}>
          <header><em>{numberOf(finishAt('sand'))}</em><strong>{SAND_TITLE}</strong></header>
        </div>
      )}
      {(() => {
        // Feet are optional and go on last, after the sanding. The card works like a finishing touch's.
        const at = finishAt('feet'), st = at >= 0 ? stages[at] : undefined;
        const feet = finish.feet;
        return (
          <div className={`step touch${st && selected === at ? ' selected' : ''}${feet.on ? '' : ' off'}`} onClick={() => st && onSelect(at)}>
            <header>
              {st && <em>{numberOf(at)}</em>}
              <label className="check" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label={FEET_TITLE} checked={feet.on} onChange={(e) => setFinish({ feet: { ...feet, on: e.target.checked } })} />
                {!st && <strong>{FEET_TITLE}</strong>}
              </label>
              {st && <strong>{FEET_TITLE}</strong>}
            </header>
            {feet.on && (
              <div className="params" onFocus={() => st && onSelect(at)}>
                <div className="row">
                  <Len label="Diameter" value={feet.diameter} min={0.25} onChange={(diameter) => setFinish({ feet: { ...feet, diameter } })} />
                  <Len label="Height" value={feet.height} min={0.0625} onChange={(height) => setFinish({ feet: { ...feet, height } })} />
                  <Len label="In from edges" value={feet.inset} min={0.125} title="How far the centre of each foot is from both edges of its corner." onChange={(inset) => setFinish({ feet: { ...feet, inset } })} />
                </div>
                <small className="hint">One under each corner, screwed on after the board is oiled.</small>
              </div>
            )}
            {st?.warning && <p className="warning">{text(st.warning)}</p>}
          </div>
        );
      })()}
      {anyTouch && finishAt('sand') < 0 && (
        <p className="warning">Finishing needs a glued panel: end the steps with a Glue up.</p>
      )}
    </section>
  );
}
