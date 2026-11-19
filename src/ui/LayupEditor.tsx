import { useState } from 'react';
import { inches } from '../model/fractions';
import { changeStrip } from '../model/link';
import { expandStrips } from '../model/pipeline';
import { newId } from '../model/presets';
import { speciesById } from '../model/species';
import type { Design, Layup, Species } from '../model/types';
import { Int, Len, SpeciesSelect } from './inputs';

interface Props {
  design: Design;
  species: Species[];
  onChange: (d: Design) => void;
  /** Tell the user about a change they did not make directly. */
  onNotice: (text: string) => void;
}

/** Editor for the first glue-up: stock size, the strip pattern, custom woods, and a preview of the panel's width. */
export function LayupEditor({ design, species, onChange, onNotice }: Props) {
  const { layup } = design;
  /** Change some layup fields, leaving the rest of the design alone. */
  const set = (patch: Partial<Layup>) => onChange({ ...design, layup: { ...layup, ...patch } });
  // While the board size is held, the repeat count and stock length are worked out, not typed.
  const held = design.autoFit !== false;
  const strips = expandStrips(layup);
  const width = strips.reduce((w, s) => w + s.width, 0);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#a06a3c');

  /**
   * Change one strip's wood or width through the model, which also updates matching inserted
   * accent strips, and tell the user when it did.
   */
  const editStrip = (stripId: string, patch: { species?: string; width?: number }) => {
    const { design: next, followed } = changeStrip(design, stripId, patch);
    onChange(next);
    if (followed.species || followed.width) {
      const what = [followed.species && 'wood', followed.width && 'thickness'].filter(Boolean).join(' and ');
      onNotice(`The inserted accent strips matched this strip, so their ${what} changed too. Undo with Ctrl+Z.`);
    }
  };

  /** Swap strip i with its neighbour d places away, if there is one. */
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= layup.strips.length) return;
    const next = [...layup.strips];
    [next[i], next[j]] = [next[j], next[i]];
    set({ strips: next });
  };

  return (
    <section className="card">
      <h3>Strips for the first glue-up</h3>
      <div className="row">
        <Len
          label="Stock length"
          value={layup.length}
          min={1}
          disabled={held}
          title={held ? 'Set from the target board size. Untick "Keep the board at this size" to enter it yourself.' : undefined}
          onChange={(length) => set({ length })}
        />
        <Len label="Thickness" value={layup.thickness} min={0.125} onChange={(thickness) => set({ thickness })} />
      </div>
      <div className="strips">
        {layup.strips.map((s, i) => (
          <div className="strip-row" key={s.id}>
            <SpeciesSelect
              value={s.species}
              species={species}
              onChange={(id) => editStrip(s.id, { species: id })}
            />
            <Len
              value={s.width}
              min={0.03125}
              onChange={(width) => editStrip(s.id, { width })}
            />
            <span className="icons">
              <button title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button title="Move down" disabled={i === layup.strips.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button title="Duplicate" onClick={() => set({ strips: [...layup.strips.slice(0, i + 1), { ...s, id: newId() }, ...layup.strips.slice(i + 1)] })}>⧉</button>
              <button title="Remove" disabled={layup.strips.length === 1} onClick={() => set({ strips: layup.strips.filter((x) => x.id !== s.id) })}>✕</button>
            </span>
          </div>
        ))}
      </div>
      <div className="row">
        <button onClick={() => set({ strips: [...layup.strips, { id: newId(), species: layup.strips.at(-1)?.species ?? 'maple', width: 1 }] })}>
          + Add strip
        </button>
        <button onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ Custom wood'}</button>
      </div>
      {adding && (
        <div className="row custom">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          <button
            disabled={!name.trim()}
            onClick={() => {
              onChange({ ...design, customSpecies: [...design.customSpecies, { id: `custom-${newId()}`, name: name.trim(), color, custom: true }] });
              setName('');
              setAdding(false);
            }}
          >Add</button>
        </div>
      )}
      {design.customSpecies.length > 0 && (
        <div className="chips">
          {design.customSpecies.map((s) => (
            <span key={s.id} className="chip">
              <b style={{ background: s.color }} />{s.name}
              <button title="Remove this wood" onClick={() => onChange({ ...design, customSpecies: design.customSpecies.filter((x) => x.id !== s.id) })}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <Int label={held ? 'Repeat (from target)' : 'Repeat pattern'} value={layup.repeat} min={1} max={80} disabled={held} onChange={(repeat) => set({ repeat })} />
        <label className="check" title="Adds the first strip once more at the far edge so the panel is symmetric.">
          <input type="checkbox" checked={layup.closeWithFirst} onChange={(e) => set({ closeWithFirst: e.target.checked })} />
          End with first strip
        </label>
      </div>
      <div className="strip-preview" title="The panel across its width">
        {strips.map((s, i) => (
          <i key={i} style={{ flex: s.width, background: speciesById(species, s.species).color }} />
        ))}
      </div>
      <p className="note">{strips.length} strips make a panel {inches(width)} wide × {inches(layup.length)} long.</p>
    </section>
  );
}
