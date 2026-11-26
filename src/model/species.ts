import type { Design, Species } from './types';

// Colours are approximations of oiled wood, chosen by eye. They are a guide, not a match.
export const BUILTIN_SPECIES: Species[] = [
  { id: 'maple', name: 'Hard maple', color: '#e9d4aa' },
  { id: 'walnut', name: 'Black walnut', color: '#5a3a28' },
  { id: 'cherry', name: 'Cherry', color: '#b46a3f' },
  { id: 'purpleheart', name: 'Purpleheart', color: '#7a3b69' },
  { id: 'padauk', name: 'Padauk', color: '#b5411f' },
  { id: 'yellowheart', name: 'Yellowheart', color: '#e2bb3e' },
  { id: 'white-oak', name: 'White oak', color: '#c7a56c' },
  { id: 'sapele', name: 'Sapele', color: '#8b4c2e' },
  { id: 'ash', name: 'Ash', color: '#dccaa4' },
  { id: 'hickory', name: 'Hickory', color: '#c59f72' },
  { id: 'teak', name: 'Teak', color: '#a5773f' },
  { id: 'bloodwood', name: 'Bloodwood', color: '#8d2a22' },
  { id: 'wenge', name: 'Wenge', color: '#3c2b23' },
  { id: 'beech', name: 'Beech', color: '#d9b78d' },
  { id: 'poplar', name: 'Poplar', color: '#cdc795' },
];

/** The built-in woods followed by the design's own custom woods. */
export function allSpecies(design: Design): Species[] {
  return [...BUILTIN_SPECIES, ...design.customSpecies];
}

/** What a routing template is made of. Not a wood of the board: it is in no picker, name or cut list. */
export const TEMPLATE_WOOD = 'template';
const TEMPLATE: Species = { id: TEMPLATE_WOOD, name: 'Template (MDF or plywood)', color: '#b79f7b' };

/** Look a wood up by id. A missing id gets a grey placeholder so a design with a deleted custom wood still draws. */
export function speciesById(list: Species[], id: string): Species {
  return list.find((s) => s.id === id) ?? (id === TEMPLATE_WOOD ? TEMPLATE : { id, name: id, color: '#999999' });
}
