import type { Design } from './types';

/** What the desktop shell exposes (electron/preload.cts). Absent when run in a plain browser. */
interface BoardsApi {
  dir(): Promise<string>;
  list(): Promise<{ file: string; name: string; modified: number }[]>;
  read(file: string): Promise<string>;
  write(file: string, text: string): Promise<string>;
  remove(file: string): Promise<void>;
  reveal(): Promise<string>;
  /** Ask where to save the print sheet as a PDF and write it there. Resolves to the path, or null if cancelled. */
  savePdf(defaultName: string): Promise<string | null>;
}

declare global {
  interface Window {
    boards?: BoardsApi;
  }
}

const LIBRARY_KEY = 'cutting-boards.library.v1';
const CURRENT_KEY = 'cutting-boards.current.v1';

export const desktop: BoardsApi | undefined = typeof window !== 'undefined' ? window.boards : undefined;

/** Throws with a readable message when the object is not a design this version can open. */
export function validateDesign(raw: unknown): Design {
  const d = raw as Partial<Design> | null;
  if (!d || typeof d !== 'object') throw new Error('Not a design file.');
  if (d.version !== 1) throw new Error(`Unsupported design version: ${String(d.version)}.`);
  if (!d.layup || !Array.isArray(d.layup.strips) || !Array.isArray(d.steps)) {
    throw new Error('The design is missing its layup or steps.');
  }
  return {
    version: 1,
    name: typeof d.name === 'string' && d.name ? d.name : 'Untitled board',
    style: typeof d.style === 'string' ? d.style : undefined,
    autoName: typeof d.autoName === 'boolean' ? d.autoName : undefined,
    target: d.target ?? { length: 16, width: 12, thickness: 1.25 },
    autoFit: d.autoFit !== false,
    allowance: d.allowance,
    finish: d.finish,
    layup: d.layup,
    steps: d.steps,
    customSpecies: Array.isArray(d.customSpecies) ? d.customSpecies : [],
  };
}

/** A design name reduced to characters safe in a file name. */
export const fileSafe = (name: string) => name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'board';
/** The file name a design saves under. */
const fileFor = (design: Design) => `${fileSafe(design.name)}.board.json`;
/** A design as indented JSON with a final newline, so saved files diff cleanly in git. */
const serialize = (design: Design) => JSON.stringify(design, null, 2) + '\n';

export interface LibraryEntry {
  /** File name on the desktop, design name in the browser. */
  key: string;
  name: string;
}

/** Saved designs from browser storage, unvalidated; empty when storage is missing or corrupt. */
function browserLibrary(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Saved designs: files in the designs folder on the desktop, browser storage otherwise. */
export const library = {
  /** Every saved design, newest first on the desktop. */
  async list(): Promise<LibraryEntry[]> {
    if (desktop) return (await desktop.list()).map((e) => ({ key: e.file, name: e.name }));
    return Object.keys(browserLibrary()).map((name) => ({ key: name, name }));
  },
  /** Read and validate one saved design. Rejects when it is missing or not a design. */
  async open(key: string): Promise<Design> {
    if (desktop) return validateDesign(JSON.parse(await desktop.read(key)));
    return validateDesign(browserLibrary()[key]);
  },
  /** Returns where it went, for the confirmation message. */
  async save(design: Design): Promise<string> {
    if (desktop) return desktop.write(fileFor(design), serialize(design));
    const lib = browserLibrary();
    lib[design.name] = design;
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
    return 'this browser';
  },
  /** Whether saving this design would replace one that is already saved. */
  async exists(design: Design): Promise<boolean> {
    const key = desktop ? fileFor(design) : design.name;
    return (await this.list()).some((e) => e.key === key);
  },
  /** Delete a saved design: to the recycle bin on the desktop, permanently in the browser. */
  async remove(key: string): Promise<void> {
    if (desktop) return desktop.remove(key);
    const lib = browserLibrary();
    delete lib[key];
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
  },
};

/** The design being worked on, kept between launches whether or not it was saved. */
export function loadCurrent(): Design | null {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? validateDesign(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Remember the design being worked on. Failure is ignored because the design is still in memory. */
export function saveCurrent(design: Design) {
  try {
    localStorage.setItem(CURRENT_KEY, serialize(design));
  } catch {
    // Storage full or blocked: the design is still in memory and can be saved to a file.
  }
}

/** Hand a file to the browser or the desktop shell to save, by clicking a temporary link. */
export function download(filename: string, href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Save a copy of the design to a place the user chooses. */
export function exportDesign(design: Design) {
  const url = URL.createObjectURL(new Blob([serialize(design)], { type: 'application/json' }));
  download(fileFor(design), url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
