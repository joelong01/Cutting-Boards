import { inches } from './fractions';

/**
 * Which units the cut list and instructions are written in. The design itself is always held and
 * entered in inches; this only changes how lengths are shown. At least one is always on.
 */
export interface Units {
  imperial: boolean;
  metric: boolean;
}

/** Inches only: how everything was written before there was a choice. */
export const IMPERIAL: Units = { imperial: true, metric: false };

const MM_PER_INCH = 25.4;
/** Cubic metres in a board foot (144 cubic inches). */
const M3_PER_BOARD_FOOT = 144 * (MM_PER_INCH / 1000) ** 3;

/** The units to use when the saved choice has neither on: inches. */
export const sensible = (u: Units): Units => (u.imperial || u.metric ? u : IMPERIAL);

/**
 * A length in inches written in millimetres: to a tenth under 100 mm, where a tenth matters to a
 * saw fence or a planer, and to the whole millimetre from there up.
 */
export function millimetres(v: number): string {
  const mm = v * MM_PER_INCH;
  const text = Math.abs(mm) < 100 ? mm.toFixed(1).replace(/\.0$/, '') : String(Math.round(mm));
  return `${text} mm`;
}

/** A length in the chosen units: `1 1/2″`, `38.1 mm`, or with both on `1 1/2″ (38.1 mm)`. */
export function showLength(v: number, units: Units): string {
  const u = sensible(units);
  if (!u.metric) return inches(v);
  return u.imperial ? `${inches(v)} (${millimetres(v)})` : millimetres(v);
}

/**
 * Several lengths multiplied together, as a size is written: `1″ × 2″ × 20″`. With both units on
 * the metric size follows as a whole, `1″ × 2″ × 20″ (25.4 × 50.8 × 508 mm)`, so the row of
 * numbers stays readable.
 */
export function showSize(values: number[], units: Units): string {
  const u = sensible(units);
  const imperial = values.map(inches).join(' × ');
  const metric = `${values.map((v) => millimetres(v).replace(' mm', '')).join(' × ')} mm`;
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
 * An instruction rewritten in the chosen units. The recipe writes its sentences in inches; this
 * finds each length in one and puts the millimetres after it, or in its place. Angles, counts and
 * everything else are left alone.
 */
export function showText(text: string, units: Units): string {
  const u = sensible(units);
  if (!u.metric) return text;
  return text.replace(INCH_LENGTH, (whole, number: string) => {
    const mm = millimetres(written(number));
    return u.imperial ? `${whole} (${mm})` : mm;
  });
}
