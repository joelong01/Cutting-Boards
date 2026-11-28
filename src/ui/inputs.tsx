import { useContext, useEffect, useRef, useState } from 'react';
import { fieldLength, fieldMark, nudged, typedLength } from '../model/units';
import { UnitsContext } from './show';
import type { Selector, Species } from '../model/types';

interface LenProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  label?: string;
  title?: string;
  disabled?: boolean;
  /**
   * Take up what is typed only on Enter, on leaving the field or on a click anywhere else, and
   * not after a pause in typing. For a size whose half-typed value would do something that the
   * finished one does not undo: `1` on the way to `1 1/2` in a board's thickness re-mills the wood.
   */
  onLeave?: boolean;
}

/** How long after the last keystroke a typed length is taken up, without waiting for Enter or a click elsewhere. */
const TYPING_PAUSE = 600;

/**
 * Length field, in the units the open design is written in: fractions or decimals of an inch, or
 * millimetres. A number typed with the other unit's mark (`43mm` in an imperial design, `3/4"`
 * in a metric one) is converted to the design's units. Up/Down nudge by 1/16 inch or 1 mm; with
 * Shift, by 1/4 inch or 10 mm. What is typed takes effect on Enter, on leaving the field, or
 * after a short pause in typing: clicking or dragging the 3D view does not take the cursor out
 * of the field, so waiting to leave it could leave the board showing the old value. With
 * `onLeave` there is no pause: a press anywhere outside the field, the 3D view included, counts
 * as leaving it.
 */
export function Len({ value, onChange, min = 0, label, title, disabled, onLeave }: LenProps) {
  const units = useContext(UnitsContext);
  // One word for how the field writes its number, so the effects below run when that changes
  // and not on every new units object.
  const mode = fieldMark(units) === 'mm' ? 'metric' : units.decimal ? 'decimal' : 'fraction';
  const [text, setText] = useState(fieldLength(value, units));
  const [bad, setBad] = useState(false);
  // The newest text, value, units and handler, for the pause timer, which must not act on old ones.
  const live = useRef({ text, value, units, onChange });
  live.current = { text, value, units, onChange };
  const shownIn = useRef(mode);
  useEffect(() => {
    // Leave the text alone when it already says this value: the change came from this field's
    // own pause timer, and rewriting "0.75" as "3/4" would move the cursor mid-edit. A change of
    // units always rewrites it.
    const typed = typedLength(live.current.text, units);
    if (shownIn.current !== mode || typed === null || Math.abs(typed - value) > 1e-9) setText(fieldLength(value, units));
    shownIn.current = mode;
    setBad(false);
  }, [value, mode]);
  // After a pause in typing, take up what is there if it is a valid length that differs, and mark
  // the field if it is not a length at all. Typing again clears the mark. Text that is only the
  // held size as the field writes it is not typing: 1.59 mm shown for 1/16 inch must not become
  // the size.
  useEffect(() => {
    if (onLeave) return undefined;
    const timer = setTimeout(() => {
      const now = live.current;
      if (now.text === fieldLength(now.value, now.units)) return;
      const v = typedLength(now.text, now.units);
      if (v !== null && v >= min && Math.abs(v - now.value) > 1e-9) now.onChange(v);
      // Text that is not a length is marked, so it is plain why the board did not change.
      else if ((v === null || v < min) && now.text.trim()) setBad(true);
    }, TYPING_PAUSE);
    return () => clearTimeout(timer);
  }, [text, min, onLeave]);
  /** Read the typed text and pass it up, rewritten in the design's units; mark the field bad and keep the old value when it is not a valid length. */
  const commit = () => {
    if (text === fieldLength(value, units)) return;
    const v = typedLength(text, units);
    if (v === null || v < min) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(fieldLength(v, units));
    if (Math.abs(v - value) > 1e-9) onChange(v);
  };
  // A press outside an `onLeave` field takes up what was typed. The 3D view takes no focus, so
  // a click on it would not otherwise count as leaving the field.
  const box = useRef<HTMLSpanElement>(null);
  const leave = useRef(commit);
  leave.current = commit;
  useEffect(() => {
    if (!onLeave) return undefined;
    /** Take up the typed text when the press is outside this field. */
    const pressed = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) leave.current();
    };
    document.addEventListener('pointerdown', pressed, true);
    return () => document.removeEventListener('pointerdown', pressed, true);
  }, [onLeave]);
  const hint = mode === 'metric'
    ? 'Millimetres. For inches add the mark: 3/4". Up/Down arrows nudge by 1 mm.'
    : 'Fractions work: 1 1/2, 3/4, 0.125. For millimetres add mm: 43mm. Up/Down arrows nudge by 1/16.';
  const field = (
    <span ref={box} className={`len${bad ? ' bad' : ''}`} title={title ?? hint}>
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = typedLength(text, units) ?? value;
            onChange(Math.max(min, nudged(base, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey, units)));
          }
        }}
      />
      <i>{fieldMark(units)}</i>
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
