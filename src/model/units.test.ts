import { describe, expect, it } from 'vitest';
import { buildCutList } from './cutlist';
import { parseLength } from './fractions';
import { run } from './pipeline';
import { PRESETS } from './presets';
import { IMPERIAL, millimetres, sensible, showBoardFeet, showLength, showSize, showText, type Units } from './units';

const METRIC: Units = { imperial: false, metric: true };
const BOTH: Units = { imperial: true, metric: true };

describe('units', () => {
  it('writes a length in inches, millimetres or both', () => {
    expect(showLength(1.5, IMPERIAL)).toBe('1 1/2″');
    expect(showLength(1.5, METRIC)).toBe('38.1 mm');
    expect(showLength(1.5, BOTH)).toBe('1 1/2″ (38.1 mm)');
  });

  it('gives millimetres to a tenth under 100 mm and whole from there up', () => {
    expect(millimetres(0.125)).toBe('3.2 mm');
    expect(millimetres(1)).toBe('25.4 mm');
    expect(millimetres(2.5)).toBe('63.5 mm');
    expect(millimetres(16)).toBe('406 mm');
    expect(millimetres(0)).toBe('0 mm');
  });

  it('writes a size as one run of numbers per unit', () => {
    expect(showSize([1, 2, 20], IMPERIAL)).toBe('1″ × 2″ × 20″');
    expect(showSize([1, 2, 20], METRIC)).toBe('25.4 × 50.8 × 508 mm');
    expect(showSize([1, 2, 20], BOTH)).toBe('1″ × 2″ × 20″ (25.4 × 50.8 × 508 mm)');
  });

  it('writes board feet as cubic metres in metric', () => {
    expect(showBoardFeet(10, IMPERIAL)).toBe('10.00 board feet');
    expect(showBoardFeet(10, METRIC)).toBe('0.0236 m³');
    expect(showBoardFeet(10, BOTH)).toBe('10.00 board feet (0.0236 m³)');
  });

  it('rewrites the lengths in an instruction and leaves angles and counts alone', () => {
    const text = 'Cross cut 13 slices 1 5/8″ wide with a 1/8″ kerf at 45°. Slide 2″ over, then 0.3″ more.';
    expect(showText(text, IMPERIAL)).toBe(text);
    expect(showText(text, METRIC)).toBe('Cross cut 13 slices 41.3 mm wide with a 3.2 mm kerf at 45°. Slide 50.8 mm over, then 7.6 mm more.');
    expect(showText(text, BOTH)).toBe('Cross cut 13 slices 1 5/8″ (41.3 mm) wide with a 1/8″ (3.2 mm) kerf at 45°. Slide 2″ (50.8 mm) over, then 0.3″ (7.6 mm) more.');
  });

  it('a length typed with an inch mark is read, whichever mark the keyboard gives', () => {
    for (const mark of ['"', '″', '”', '“', '′′', "''", ' in', 'in.', '']) {
      expect(parseLength(`1${mark}`), mark).toBe(1);
      expect(parseLength(`3/4${mark}`), mark).toBe(0.75);
      expect(parseLength(`1 1/2${mark}`), mark).toBe(1.5);
    }
    // A foot mark is not an inch mark, and words are not lengths.
    expect(parseLength("1'")).toBeNull();
    expect(parseLength('one')).toBeNull();
  });

  it('with neither unit on falls back to inches', () => {
    expect(sensible({ imperial: false, metric: false })).toEqual(IMPERIAL);
    expect(showLength(2, { imperial: false, metric: false })).toBe('2″');
  });

  it('leaves no inch mark in any starter design\'s instructions when metric alone is chosen', () => {
    for (const preset of PRESETS) {
      const list = buildCutList(run(preset.make()));
      // Most instructions give a length; a few, like turning the slices up, give none.
      expect(list.operations.filter((o) => /″/.test(o.text)).length, preset.key).toBeGreaterThan(2);
      for (const o of list.operations) {
        expect(showText(o.text, METRIC), `${preset.key}: ${o.title}`).not.toMatch(/″/);
      }
    }
  });
});
