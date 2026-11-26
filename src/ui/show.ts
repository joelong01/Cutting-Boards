import { createContext, useContext } from 'react';
import { IMPERIAL, showLength, showSize, showText, type Units } from '../model/units';

/**
 * How the open design writes its lengths: its notation and rounding (see `unitsOf`). The app
 * provides it; everything that shows a length reads it, so the whole window agrees.
 */
export const UnitsContext = createContext<Units>(IMPERIAL);

/**
 * The functions that write lengths the way the open design asks: `len` one length, `size`
 * several multiplied together, and `text` a sentence from the recipe, which is written in exact
 * inches and has each length in it rewritten.
 */
export function useShow() {
  const units = useContext(UnitsContext);
  return {
    units,
    len: (v: number) => showLength(v, units),
    size: (values: number[]) => showSize(values, units),
    text: (sentence: string) => showText(sentence, units),
  };
}
