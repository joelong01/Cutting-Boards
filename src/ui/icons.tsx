import type { ReactNode } from 'react';

export type IconName = 'new' | 'open' | 'save' | 'saveas' | 'export' | 'undo' | 'redo' | 'print' | 'picture' | 'panel' | 'instructions' | 'design' | 'addstep' | 'about';

/**
 * The drawing for each toolbar icon on a 24 × 24 grid. Outlines take the button's text colour;
 * the one part marked `accent` (the plus, the arrow, the sheet of paper) takes the accent colour,
 * which is what tells the icons apart at a glance.
 */
const DRAWINGS: Record<IconName, ReactNode> = {
  // A circled i.
  about: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path className="accent" d="M12 11v6M12 7.5v.5" />
    </>
  ),
  // A list of steps with one more going in.
  addstep: (
    <>
      <path d="M4 6h10M4 11h7M4 16h7" />
      <path className="accent" d="M17 10.5v8M13 14.5h8" />
    </>
  ),
  new: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path className="accent" d="M12 11.5v6M9 14.5h6" />
    </>
  ),
  open: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path className="accent" d="M3.5 11.5h17" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M7.5 3v5h7.5V3" />
      <path className="accent" d="M7 21v-7h10v7" />
    </>
  ),
  saveas: (
    <>
      <path d="M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l4 4v4" />
      <path d="M7.5 3v5h7.5V3" />
      <path className="accent" d="M14 21l.6-3 5.6-5.6a1.5 1.5 0 0 1 2.2 2.2L16.8 20.2z" />
    </>
  ),
  export: (
    <>
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      <path className="accent" d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    </>
  ),
  undo: (
    <>
      <path className="accent" d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path className="accent" d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  print: (
    <>
      <path d="M7 8V3h10v5" />
      <path d="M7 17H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-3" />
      <path className="accent" d="M7 14h10v7H7z" />
    </>
  ),
  picture: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle className="accent" cx="8.5" cy="10" r="1.6" />
      <path className="accent" d="M21 16l-5-5-8 8" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
      <path className="accent" d="M5.4 8.5h2M5.4 12h2M5.4 15.5h2" />
    </>
  ),
  // A sheet of numbered instructions.
  instructions: (
    <>
      <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M11.5 8h4.5M11.5 12h4.5M11.5 16h4.5" />
      <path className="accent" d="M8 8h.5M8 12h.5M8 16h.5" />
    </>
  ),
  // A board being sized: a slab with a dimension line under it.
  design: (
    <>
      <rect x="4" y="5" width="16" height="9" rx="1.5" />
      <path d="M9.3 5v9M14.7 5v9" />
      <path className="accent" d="M4 18.5h16M4 17v3M20 17v3" />
    </>
  ),
};

/** One toolbar icon, drawn in lines so it stays sharp at any size and follows the text colour. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {DRAWINGS[name]}
    </svg>
  );
}
