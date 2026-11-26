import { useState } from 'react';
import { dimensionsOf, isLocked, layupOf, milledStrips, sizingOf, withAlong, withLayup } from '../model/design';
import { changeStrip } from '../model/link';
import { blockSide } from '../model/blocks';
import { expandStrips } from '../model/pipeline';
import { newId } from '../model/presets';
import { speciesById } from '../model/species';
import type { Design, Layup, Species } from '../model/types';
import { Int, Len, SpeciesSelect } from './inputs';
import { useShow } from './show';

interface Props {
  design: Design;
  species: Species[];
  onChange: (d: Design) => void;
  /** Tell the user about a change they did not make directly. */
  onNotice: (text: string) => void;
  /** Whether the 3D view is showing this step's result, the first glue-up. */
  selected: boolean;
  /** Show the first glue-up in the 3D view. */
  onSelect: () => void;
  /** What is wrong with the strips as they stand, if anything: a strip thinner than the minimum, say. */
  warning?: string;
}

/**
 * Step 1 of the recipe, milling the strips for the first glue-up: stock size, the strip pattern,
 * custom woods, and a preview of the panel's width. Clicking its heading shows the glued panel in
 * the 3D view; editing the strips leaves the view where it is.
 *
 * A 3D board has a different card here, since its strips are ripped to a diamond section and are
 * all one size: the thickness of the boards they are ripped from, which sets the size of the
 * blocks, how long they are, and the three woods.
 */
export function LayupEditor({ design, species, onChange, onNotice, selected, onSelect, warning }: Props) {
  const layup = layupOf(design);
  const { len: inches, text } = useShow();
  /** Change some of the first step's settings, leaving the rest of the design alone. */
  const set = (patch: Partial<Layup>) => onChange(withLayup(design, patch));
  // While the board size is held, the repeat count and stock length are worked out, not typed.
  const held = design.autoFit !== false;
  // The preview and the sizes in the note are the strips as milled, which a fit may have narrowed.
  const sizing = sizingOf(design);
  const milled = milledStrips(layup, sizing.grid);
  const strips = expandStrips({ ...layup, strips: milled });
  /** What the fit changed from the sizes asked for, in words, or nothing when it changed nothing. */
  const fitNote = [
    Math.abs(sizing.scale - 1) > 1e-6
      ? `To finish at the target size, mill ${layup.strips.map((s, i) => (isLocked(s) ? '' : `${speciesById(species, s.species).name} ${inches(milled[i].width)} wide`)).filter((t, i, all) => t && all.indexOf(t) === i).join(', ')}.`
      : '',
    sizing.alongOn === 'thickness' && Math.abs(sizing.along) > 1e-6 ? `Mill the strips ${inches(withAlong(layup.thickness, sizing))} thick.` : '',
    sizing.alongOn === 'crosscut' && Math.abs(sizing.along) > 1e-6 ? `Cross cut the slices ${inches(withAlong(sizing.cut, sizing))} wide.` : '',
  ].filter(Boolean).join(' ');
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

  if (layup.blocks) {
    const pieces = layup.blocks.along * layup.blocks.across;
    return (
      <section className={`step first${selected ? ' selected' : ''}`}>
        <header onClick={onSelect} title="Show the strips, ripped and ready to glue into logs"><em>1</em><strong>Rip the strips</strong></header>
        <div className="row">
          {layup.blocks.flat ? (
            <Len
              label="Strip width"
              value={layup.strips[0]?.width ?? 1}
              min={0.5}
              title="How wide the two face woods are ripped, which sets the size of the diamonds. The top wood's width follows from it."
              onChange={(width) => set({ strips: layup.strips.map((s, i) => (i % 2 ? s : { ...s, width })) })}
            />
          ) : (
            <Len
              label="Board thickness"
              value={layup.thickness}
              min={0.5}
              title="The boards the strips are ripped from. Thicker boards make bigger blocks."
              onChange={(thickness) => set({ thickness })}
            />
          )}
          {layup.blocks.flat && (
            <Len
              label="Thickness"
              value={layup.thickness}
              min={0.25}
              disabled={held}
              title={held ? 'Set from the target thickness and the flattening. Untick "Keep the board at this size" to enter it yourself.' : undefined}
              onChange={(thickness) => set({ thickness })}
            />
          )}
          <Len
            label="Strip length"
            value={layup.length}
            min={1}
            disabled={held}
            title={held ? 'Set from the target board size. Untick "Keep the board at this size" to enter it yourself.' : undefined}
            onChange={(length) => set({ length })}
          />
        </div>
        <div className="strips">
          {layup.strips.slice(0, 3).map((s, i) => (
            <div className="strip-row" key={s.id}>
              {layup.blocks?.flat ? (
                // The top wood is two of the four strips in the pattern: both change together.
                <SpeciesSelect value={s.species} species={species} onChange={(id) => set({ strips: layup.strips.map((x, n) => (x.id === s.id || (i === 1 && n === 3) ? { ...x, species: id } : x)) })} />
              ) : (
                <SpeciesSelect value={s.species} species={species} onChange={(id) => editStrip(s.id, { species: id })} />
              )}
              <small>{(layup.blocks?.flat ? ['left face', 'top', 'right face'] : ['first face', 'second face', 'third face'])[i]} of every block</small>
            </div>
          ))}
        </div>
        <div className="row">
          <Int label={(layup.blocks.flat ? 'Repeats of the pattern' : 'Strips of each wood') + (held ? ' (from target)' : '')} value={layup.repeat} min={1} max={40} disabled={held} onChange={(repeat) => set({ repeat })} />
        </div>
        <p className="note">
          {layup.blocks.flat
            ? `Flat strips, ripped square, in the order left, top, right, top: the two faces ${inches(layup.strips[0]?.width ?? 1)} wide and the top ${inches(layup.strips[1]?.width ?? 0.5)}. ${layup.repeat} repeats make a panel ${inches(layup.strips.reduce((t, x) => t + x.width, 0) * layup.repeat)} wide, which the steps below cut and flip twice into ${layup.blocks.across} rows of blocks, ${layup.blocks.along} slices wide. Nothing smaller than a slice is handled.`
            : `One board of each wood, ripped next with the blade tilted 30° into strips about ${inches(blockSide(layup.thickness))} on every side. ${layup.repeat} of each wood make ${layup.repeat} hexagonal log${layup.repeat > 1 ? 's' : ''}, cut into the ${pieces} pieces of the block: ${layup.blocks.across} rows of ${layup.blocks.along}.`}
        </p>
        {warning && <p className="warning">{text(warning)}</p>}
      </section>
    );
  }

  return (
    <section className={`step first${selected ? ' selected' : ''}`}>
      <header onClick={onSelect} title="Show the strips, ripped and ready to glue"><em>1</em><strong>Rip the strips</strong></header>
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
              min={Math.max(0.03125, dimensionsOf(design).minWidth)}
              title={dimensionsOf(design).minWidth > 0 ? `Fractions work: 1 1/2, 3/4, 0.125. Nothing thinner than ${inches(dimensionsOf(design).minWidth)}, the minimum under Dimensions.` : undefined}
              onChange={(width) => editStrip(s.id, { width })}
            />
            {s.spacer && <small className="spacer-tag" title="This strip only holds a place: a later cross cut saws it out, so none of it is in the finished board. Use any cheap wood.">spacer</small>}
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
      {fitNote && <p className="note fit-note">{fitNote}</p>}
      {warning && <p className="warning">{text(warning)}</p>}
    </section>
  );
}
