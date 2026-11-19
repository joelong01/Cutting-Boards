import { useEffect, useState } from 'react';
import { formatLength, parseLength } from '../model/fractions';
import type { Selector, Species } from '../model/types';

interface LenProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  label?: string;
  title?: string;
  disabled?: boolean;
}

/** Length field that accepts shop fractions. Up/Down nudge by 1/16; with Shift, by 1/4. */
export function Len({ value, onChange, min = 0, label, title, disabled }: LenProps) {
  const [text, setText] = useState(formatLength(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(formatLength(value));
    setBad(false);
  }, [value]);
  /** Parse the typed text and pass it up; mark the field bad and keep the old value when it is not a valid length. */
  const commit = () => {
    const v = parseLength(text);
    if (v === null || v < min) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(formatLength(v));
    if (Math.abs(v - value) > 1e-9) onChange(v);
  };
  const field = (
    <span className={`len${bad ? ' bad' : ''}`} title={title ?? 'Fractions work: 1 1/2, 3/4, 0.125. Up/Down arrows nudge by 1/16.'}>
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = (e.shiftKey ? 0.25 : 0.0625) * (e.key === 'ArrowUp' ? 1 : -1);
            const base = parseLength(text) ?? value;
            onChange(Math.max(min, Math.round((base + step) * 64) / 64));
          }
        }}
      />
      <i>″</i>
    </span>
  );
  return label ? <label className="field"><span>{label}</span>{field}</label> : field;
}

interface IntProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  disabled?: boolean;
}

/** Whole-number field clamped to a range. */
export function Int({ value, onChange, min = 1, max = 999, label, disabled }: IntProps) {
  const field = (
    <input
      className="int"
      type="number"
      disabled={disabled}
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
    />
  );
  return label ? <label className="field"><span>{label}</span>{field}</label> : field;
}

/** Wood picker with a colour swatch. A wood that no longer exists is shown as missing rather than silently changed. */
export function SpeciesSelect({ value, species, onChange }: { value: string; species: Species[]; onChange: (id: string) => void }) {
  const current = species.find((s) => s.id === value);
  return (
    <span className="species-select">
      <b style={{ background: current?.color ?? '#999' }} />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!current && <option value={value}>{value} (missing)</option>}
        {species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </span>
  );
}

/** Editor for which slices a step applies to: all, every Nth, or hand-picked from numbered buttons. */
export function SelectorEditor({ sel, onChange, count }: { sel: Selector; onChange: (s: Selector) => void; count: number }) {
  return (
    <div className="selector">
      <label className="field">
        <span>Which slices</span>
        <select
          value={sel.mode}
          onChange={(e) => {
            const mode = e.target.value as Selector['mode'];
            if (mode === 'all') onChange({ mode });
            else if (mode === 'every') onChange({ mode, n: 2, offset: 1 });
            else onChange({ mode, indices: [] });
          }}
        >
          <option value="all">All</option>
          <option value="every">Every Nth</option>
          <option value="pick">Hand-picked</option>
        </select>
      </label>
      {sel.mode === 'every' && (
        <>
          <Int label="Every" value={sel.n} min={1} max={50} onChange={(n) => onChange({ ...sel, n })} />
          <Int label="Starting at slice" value={sel.offset + 1} min={1} max={Math.max(1, count)} onChange={(v) => onChange({ ...sel, offset: v - 1 })} />
        </>
      )}
      {sel.mode === 'pick' && (
        <div className="picks">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              className={sel.indices.includes(i) ? 'on' : ''}
              onClick={() => onChange({ mode: 'pick', indices: toggle(sel.indices, i) })}
            >{i + 1}</button>
          ))}
          <small>Or click slices in the 3D view.</small>
        </div>
      )}
    </div>
  );
}

/** Add a number to a sorted list, or remove it if already there. */
export const toggle = (list: number[], i: number) =>
  (list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort((a, b) => a - b));
