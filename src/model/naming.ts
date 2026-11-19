import { speciesById } from './species';
import type { Design, Species } from './types';

/**
 * Names the starter designs were given before designs named themselves, with the pattern each
 * one is. A design still carrying one of these has not been named by its owner, so it is safe
 * to rename when its woods change.
 */
const LEGACY_NAMES: Record<string, string> = {
  'Maple end grain': 'end grain',
  'Walnut edge grain': 'edge grain',
  'Edge-grain stripes': 'stripes',
  'Maple blocks, purpleheart grid': 'grid',
  'Walnut and maple checkerboard': 'checkerboard',
  'Teak brick': 'brick',
  'Maple and wenge basket weave': 'basket weave',
  'Three-wood chevron': 'chevron',
};

const COUNT_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** The pattern a design is, for its name: stored on it, or recognised from an old starter name. */
export function styleOf(design: Pick<Design, 'style' | 'name'>): string | undefined {
  return design.style ?? LEGACY_NAMES[design.name];
}

/** Whether the app still owns this design's name, because the user has never typed one. */
export function isAutoNamed(design: Pick<Design, 'autoName' | 'name'>): boolean {
  return design.autoName ?? design.name in LEGACY_NAMES;
}

/**
 * The woods in a design, most used first: the strips of the first glue-up by total width, then
 * any accent wood that appears only in an "Insert accent strips" step.
 */
export function woodsOf(design: Pick<Design, 'layup' | 'steps'>): string[] {
  const width = new Map<string, number>();
  for (const s of design.layup.strips) width.set(s.species, (width.get(s.species) ?? 0) + s.width);
  const woods = [...width].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const step of design.steps) {
    if (step.type === 'insert' && !woods.includes(step.species)) woods.push(step.species);
  }
  return woods;
}

/**
 * A name that says what the board is made of and what pattern it is, such as "Hard maple and
 * black walnut grid". Up to three woods are named; more than that are counted ("Four-wood chevron").
 */
export function autoName(design: Pick<Design, 'layup' | 'steps' | 'style' | 'name'>, species: Species[]): string {
  const style = styleOf(design) ?? 'board';
  const names = woodsOf(design).map((id) => speciesById(species, id).name.toLowerCase());
  let woods: string;
  if (names.length === 0) woods = '';
  else if (names.length === 1) woods = names[0];
  else if (names.length <= 3) woods = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  else woods = `${COUNT_WORDS[names.length] ?? String(names.length)}-wood`;
  const text = `${woods} ${style}`.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The design with its name brought up to date, if the app still owns the name. A name the user
 * typed, or a design that has been saved to a file under its name, is left alone.
 */
export function withAutoName(design: Design, species: Species[]): Design {
  if (!isAutoNamed(design)) return design;
  const name = autoName(design, species);
  const style = styleOf(design);
  if (name === design.name && design.autoName === true && design.style === style) return design;
  return { ...design, name, style, autoName: true };
}
