import { inches } from '../model/fractions';
import { STEP_TITLES, pieceCount, stepNeeds } from '../model/pipeline';
import { finishOf } from '../model/finish';
import { insertStep, newStep } from '../model/presets';
import type { Design, Finish, Species, Stage, Step, StepType } from '../model/types';
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
];

/** A stage's size as length x width x thickness. */
const sizeText = (s: Stage) => `${inches(s.size[0])} × ${inches(s.size[2])} × ${inches(s.size[1])}`;

/** The recipe as a list of cards: one per stage, each with its settings, result size and any error, plus the buttons that add steps. */
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
      <div className={`step${selected === 0 ? ' selected' : ''}`} onClick={() => onSelect(0)}>
        <header><em>1</em><strong>First glue-up</strong></header>
        <p className="result">{sizeText(stages[0])} · {pieceCount(stages[0])} strips</p>
      </div>
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
              {step.type === 'insert' && (
                <div className="row">
                  <SpeciesSelect value={step.species} species={species} onChange={(id) => setStep(step.id, { species: id })} />
                  <Len label="Thickness" value={step.thickness} min={0.03125} onChange={(thickness) => setStep(step.id, { thickness })} />
                  <Int label="After every" value={step.every} min={1} max={50} onChange={(every) => setStep(step.id, { every })} />
                </div>
              )}
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
                {st.kind === 'slices' ? `${st.slices.length} slices · ` : ''}{sizeText(st)}
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
        <div className="params" onClick={(e) => e.stopPropagation()}>
          <label className="check">
            <input type="checkbox" checked={finish.groove.on} onChange={(e) => setFinish({ groove: { ...finish.groove, on: e.target.checked } })} />
            Juice groove in the top
          </label>
          {finish.groove.on && (
            <label className="check" title="Moves each side of the groove to the nearest place that sits evenly on the pattern: centred in a row of blocks or on an accent line.">
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
              ? 'a glued panel: select a First glue-up, Glue up, Trim or Flatten step to add it after'
              : 'loose slices: select a Cross cut, Turn, Flip, Offset or Insert step to add it after';
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
