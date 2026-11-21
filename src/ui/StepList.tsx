import { useState } from 'react';
import { accentStrips, patternPeriod, withAccentStrips } from '../model/accent';
import { inches } from '../model/fractions';
import { STEP_TITLES, stepNeeds } from '../model/pipeline';
import { finishOf } from '../model/finish';
import { speciesById } from '../model/species';
import { insertStep, newStep } from '../model/presets';
import { newId } from '../model/presets';
import type { AccentStrip, Design, Finish, PatternStrip, Species, Stage, Step, StepType, StripSpec } from '../model/types';
import { Int, Len, SelectorEditor, SpeciesSelect } from './inputs';

interface Props {
  design: Design;
  stages: Stage[];
  species: Species[];
  selected: number;
  onSelect: (stageIndex: number) => void;
  onChange: (d: Design) => void;
}

const ADDABLE: { type: StepType; hint: string }[] = [
  { type: 'crosscut', hint: 'Cut the panel into slices, square or at an angle' },
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

/** A stage's size as length x width x thickness. */
const sizeText = (s: Stage) => `${inches(s.size[0])} × ${inches(s.size[2])} × ${inches(s.size[1])}`;

/**
 * The recipe from step 2 on as a list of cards: one per step and one for Finish, each with its
 * settings, result size and any error, plus the buttons that add steps. Step 1, milling and gluing
 * the strips, is the LayupEditor card above this list.
 */
export function StepList({ design, stages, species, selected, onSelect, onChange }: Props) {
  /** Change some fields of one step. */
  const setStep = (id: string, patch: Partial<Step>) =>
    onChange({ ...design, steps: design.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as Step) : s)) });
  /** Swap step i with its neighbour d places away and keep it selected. */
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= design.steps.length) return;
    const steps = [...design.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    onChange({ ...design, steps });
    onSelect(j + 1);
  };
  // Which patterned strip has its panel open for editing, as "step id:strip number", or null.
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const finish = finishOf(design);
  /** Change part of the finishing options. */
  const setFinish = (patch: Partial<Finish>) => onChange({ ...design, finish: { ...finish, ...patch } });
  // The Finish stage, when there is one, follows the last step.
  const finishIndex = design.steps.length + 1;
  const finishStage: Stage | undefined = stages[finishIndex];
  // A new step goes straight after the stage that is selected, so a step can be put in the middle
  // of the recipe: an accent strip between the cross cut and the glue-up, say. With the Finish
  // stage selected it goes at the end of the steps.
  const addAt = Math.min(selected, design.steps.length);
  const addKind = stages[addAt].kind;
  const addAfter = addAt === 0 ? 'First glue-up' : STEP_TITLES[design.steps[addAt - 1].type];

  return (
    <section className="steps">
      {design.steps.map((step, i) => {
        const st = stages[i + 1];
        const before = stages[i];
        return (
          <div key={step.id} className={`step${selected === i + 1 ? ' selected' : ''}${st.error ? ' broken' : ''}`} onClick={() => onSelect(i + 1)}>
            <header>
              <em>{i + 2}</em>
              <strong>{STEP_TITLES[step.type]}</strong>
              <span className="icons" onClick={(e) => e.stopPropagation()}>
                <button title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button title="Move later" disabled={i === design.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button
                  title="Remove step"
                  onClick={() => {
                    onChange({ ...design, steps: design.steps.filter((s) => s.id !== step.id) });
                    onSelect(Math.min(selected, design.steps.length - 1));
                  }}
                >✕</button>
              </span>
            </header>
            <div className="params" onClick={(e) => e.stopPropagation()} onFocus={() => onSelect(i + 1)}>
              {step.type === 'crosscut' && (
                <div className="row">
                  <Len label="Slice width" value={step.width} min={0.0625} onChange={(width) => setStep(step.id, { width })} />
                  <Len label="Kerf" value={step.kerf} onChange={(kerf) => setStep(step.id, { kerf })} />
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
            {st.error && <p className="error">{st.error}</p>}
            {st.warning && <p className="warning">{st.warning}</p>}
            {!st.error && (
              <p className="result">
                {st.kind === 'slices' ? `${st.slices.length} slices · ` : ''}{sizeText(st)}{st.aside ? ` · ${st.aside.length} slices set aside` : ''}
              </p>
            )}
          </div>
        );
      })}
      <div
        className={`step${finishStage && selected === finishIndex ? ' selected' : ''}`}
        onClick={() => finishStage && onSelect(finishIndex)}
      >
        <header><em>{finishIndex + 1}</em><strong>Finish</strong></header>
        <div className="params finish" onClick={(e) => e.stopPropagation()}>
          <label className="check">
            <input type="checkbox" checked={finish.groove.on} onChange={(e) => setFinish({ groove: { ...finish.groove, on: e.target.checked } })} />
            Juice groove in the top
          </label>
          {finish.groove.on && (
            <label className="check sub" title="Moves each side of the groove to the nearest place that sits evenly on the pattern: centred in a row of blocks or on an accent line.">
              <input type="checkbox" checked={finish.groove.align} onChange={(e) => setFinish({ groove: { ...finish.groove, align: e.target.checked } })} />
              Line the groove up with the pattern
            </label>
          )}
          {finish.groove.on && (
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
          )}
          <label className="check">
            <input type="checkbox" checked={finish.corners.on} onChange={(e) => setFinish({ corners: { ...finish.corners, on: e.target.checked } })} />
            Round the corners
          </label>
          {finish.corners.on && (
            <div className="row">
              <Len label="Corner radius" value={finish.corners.radius} min={0.0625} onChange={(radius) => setFinish({ corners: { ...finish.corners, radius } })} />
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={finish.roundover.on} onChange={(e) => setFinish({ roundover: { ...finish.roundover, on: e.target.checked } })} />
            Round over the top edges
          </label>
          {finish.roundover.on && (
            <div className="row">
              <Len label="Roundover (bit)" value={finish.roundover.radius} min={0.03125} onChange={(radius) => setFinish({ roundover: { ...finish.roundover, radius } })} />
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={finish.chamfer.on} onChange={(e) => setFinish({ chamfer: { ...finish.chamfer, on: e.target.checked } })} />
            Chamfer the bottom edges
          </label>
          {finish.chamfer.on && (
            <div className="row">
              <Len label="Chamfer" value={finish.chamfer.size} min={0.0625} onChange={(size) => setFinish({ chamfer: { ...finish.chamfer, size } })} />
            </div>
          )}
        </div>
        {finishStage?.warning && <p className="warning">{finishStage.warning}</p>}
        {!finishStage && (finish.groove.on || finish.chamfer.on || finish.corners.on || finish.roundover.on) && (
          <p className="warning">Finishing needs a glued panel: end the steps with a Glue up.</p>
        )}
      </div>
      <div className="add-step">
        <span>Add a step after {addAt + 1}. {addAfter}</span>
        <div>
          {ADDABLE.map(({ type, hint }) => {
            const ok = stepNeeds(type) === addKind;
            const needs = stepNeeds(type) === 'panel'
              ? 'a glued panel: select a First glue-up, Glue up, Trim, Flatten or Add a border step to add it after'
              : 'loose slices: select a Cross cut, Turn, Flip, Offset, Insert or Interleave step to add it after';
            return (
              <button
                key={type}
                disabled={!ok}
                title={ok ? hint : `${hint}. Needs ${needs}.`}
                onClick={() => {
                  onChange(insertStep(design, addAt, newStep(type)));
                  onSelect(addAt + 1);
                }}
              >{STEP_TITLES[type]}</button>
            );
          })}
        </div>
        <small>Click a step above to choose where the new one goes.</small>
      </div>
    </section>
  );
}
