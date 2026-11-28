import { dimensionsOf } from './design';
import { formatLength, hasInchMark, inches, parseLength, roundTo } from './fractions';
import type { Design, Notation } from './types';

/**
 * Which units the cut list and instructions are written in, and a bare number typed into a field
 * is read in. The design itself is always held in inches. At least one is always on.
 */
export interface Units {
  imperial: boolean;
  metric: boolean;
  /** Write inches as decimals, as a caliper does, and not as fractions. */
  decimal?: boolean;
  /** Round every length to the nearest multiple of this many inches before writing it. Absent or 0 writes it as it is. */
  step?: number;
}

/** Inches only: how everything was written before there was a choice. */
export const IMPERIAL: Units = { imperial: true, metric: false };

const MM_PER_INCH = 25.4;
/** Cubic metres in a board foot (144 cubic inches). */
const M3_PER_BOARD_FOOT = 144 * (MM_PER_INCH / 1000) ** 3;

/** The units to use when the saved choice has neither on: inches. */
export const sensible = (u: Units): Units => (u.imperial || u.metric ? u : IMPERIAL);

/** The rounding steps offered for each notation, finest first, each in inches with the words that name it. */
export const ROUNDINGS: Record<Notation, { step: number; label: string }[]> = {
  fraction: [{ step: 1 / 64, label: '1/64″' }, { step: 1 / 32, label: '1/32″' }, { step: 1 / 16, label: '1/16″' }, { step: 1 / 8, label: '1/8″' }],
  decimal: [{ step: 0.001, label: '0.001″' }, { step: 0.005, label: '0.005″' }, { step: 0.01, label: '0.01″' }],
  metric: [{ step: 0.1 / MM_PER_INCH, label: '0.1 mm' }, { step: 0.5 / MM_PER_INCH, label: '0.5 mm' }, { step: 1 / MM_PER_INCH, label: '1 mm' }],
};

/** The step a design starts with when it is switched to a notation: 1/16 inch, a hundredth of an inch, or half a millimetre. */
export const usualRounding = (notation: Notation): number => ROUNDINGS[notation][notation === 'fraction' ? 2 : notation === 'decimal' ? 2 : 1].step;

/** How a design's lengths are written: its notation and rounding as the units the writing functions take. */
export function unitsOf(design: Pick<Design, 'dimensions'>): Units {
  const d = dimensionsOf(design);
  return { imperial: d.notation !== 'metric', metric: d.notation === 'metric', decimal: d.notation === 'decimal', step: d.rounding || undefined };
}

/**
 * A length in inches written in millimetres. With a rounding step it is rounded to that step
 * (given in inches, as all lengths are) and written to a tenth when the step is finer than a
 * millimetre. Without one it is written to a tenth under 100 mm, where a tenth matters to a saw
 * fence or a planer, and to the whole millimetre from there up.
 */
export function millimetres(v: number, step?: number): string {
  const mm = v * MM_PER_INCH;
  if (step) {
    const by = step * MM_PER_INCH;
    const r = Math.round(mm / by) * by;
    return `${by < 0.999 ? r.toFixed(1).replace(/\.0$/, '') : String(Math.round(r))} mm`;
  }
  const text = Math.abs(mm) < 100 ? mm.toFixed(1).replace(/\.0$/, '') : String(Math.round(mm));
  return `${text} mm`;
}

/**
 * A length typed into a field, in inches, or null when it is not a length. A number with `mm` or
 * `cm` after it is metric and one with an inch mark is inches, whatever the units; a bare number
 * is in the units the design is written in. So `43mm` typed into an imperial design is 1.693
 * inches, and `3/4"` typed into a metric one is 19.05 mm.
 */
export function typedLength(text: string, units: Units): number | null {
  const t = text.trim();
  const metric = /^(.*\d)\s*(mm|cm)\.?$/i.exec(t);
  if (metric) {
    const v = parseLength(metric[1]);
    return v === null ? null : (v * (metric[2].toLowerCase() === 'cm' ? 10 : 1)) / MM_PER_INCH;
  }
  const v = parseLength(t);
  if (v === null) return null;
  return sensible(units).imperial || hasInchMark(t) ? v : v / MM_PER_INCH;
}

/**
 * A length in inches as a field shows it for editing, the number alone: a fraction, a decimal to
 * a thousandth of an inch, or millimetres to a thousandth, so that an eighth of an inch is 3.175
 * and not a rounding of it. It is not rounded to the design's step: a field shows the size held.
 */
export function fieldLength(v: number, units: Units): string {
  if (!isFinite(v)) return '?';
  const u = sensible(units);
  if (!u.imperial) return String(Number((v * MM_PER_INCH).toFixed(3)));
  return u.decimal ? String(Number(v.toFixed(3))) : formatLength(v);
}

/** The mark a field puts after its number: the inch mark, or mm. */
export const fieldMark = (units: Units): string => (sensible(units).imperial ? '″' : 'mm');

/**
 * A length moved one step up (`by` 1) or down (-1) by the arrow keys: 1/16 inch, or 1/4 when
 * `big`, kept on 64ths; in a metric design 1 mm, or 10 mm, kept on tenths of a millimetre.
 */
export function nudged(v: number, by: 1 | -1, big: boolean, units: Units): number {
  const [step, grid] = sensible(units).imperial
    ? [big ? 0.25 : 0.0625, 1 / 64]
    : [(big ? 10 : 1) / MM_PER_INCH, 0.1 / MM_PER_INCH];
  return Math.round((v + by * step) / grid) * grid;
}

/** A length in inches written in inches: a fraction, or a decimal when the units ask, rounded to their step first. */
export function inchText(v: number, units: Units): string {
  const r = roundTo(v, units.step);
  if (!units.decimal) return inches(r);
  // As many places as the step has, and three when there is none.
  const places = units.step ? Math.min(4, Math.max(0, Math.ceil(-Math.log10(units.step) - 1e-9))) : 3;
  return `${r.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}″`;
}

/** A length in the chosen units: `1 1/2″`, `1.5″`, `38.1 mm`, or with both on `1 1/2″ (38.1 mm)`. */
export function showLength(v: number, units: Units): string {
  const u = sensible(units);
  if (!u.metric) return inchText(v, u);
  return u.imperial ? `${inchText(v, u)} (${millimetres(v, u.step)})` : millimetres(v, u.step);
}

/**
 * Several lengths multiplied together, as a size is written: `1″ × 2″ × 20″`. With both units on
 * the metric size follows as a whole, `1″ × 2″ × 20″ (25.4 × 50.8 × 508 mm)`, so the row of
 * numbers stays readable.
 */
export function showSize(values: number[], units: Units): string {
  const u = sensible(units);
  const imperial = values.map((v) => inchText(v, u)).join(' × ');
  const metric = `${values.map((v) => millimetres(v, u.step).replace(' mm', '')).join(' × ')} mm`;
  if (!u.metric) return imperial;
  return u.imperial ? `${imperial} (${metric})` : metric;
}

/** Board feet as cubic metres, the number alone. */
export const cubicMetres = (bf: number): string => (bf * M3_PER_BOARD_FOOT).toFixed(4);

/** A volume of rough stock given in board feet, in the chosen units; metric is cubic metres. */
export function showBoardFeet(bf: number, units: Units): string {
  const u = sensible(units);
  const imperial = `${bf.toFixed(2)} board feet`;
  const metric = `${cubicMetres(bf)} m³`;
  if (!u.metric) return imperial;
  return u.imperial ? `${imperial} (${metric})` : metric;
}

/** Every length written in inches in a sentence: a whole number, fraction, mixed number or decimal, then the inch mark. */
const INCH_LENGTH = /(\d+ \d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)″/g;

/** The value of a length as the instructions write it: `1 1/2`, `3/4`, `16` or `0.3`. */
function written(text: string): number {
  const [first, second] = text.split(' ');
  /** One whole number, decimal or fraction. */
  const part = (t: string) => (t.includes('/') ? +t.split('/')[0] / +t.split('/')[1] : +t);
  return part(first) + (second ? part(second) : 0);
}

/**
 * An instruction rewritten in the chosen units. The recipe writes its sentences in inches, as
 * exact as it worked them out; this finds each length in one and writes it the way the units say:
 * rounded to their step, as a fraction or a decimal, with the millimetres after it or in its
 * place. Angles, counts and everything else are left alone.
 */
export function showText(text: string, units: Units): string {
  const u = sensible(units);
  // Fractions with no rounding are how the sentence is already written.
  if (!u.metric && !u.decimal && !u.step) return text;
  return text.replace(INCH_LENGTH, (_whole, number: string) => showLength(written(number), u));
}
