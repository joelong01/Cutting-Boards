// What to do about the Windows Start Menu entry, decided apart from the code that reads and writes
// it, so the decision can be tested without a shortcut file or a running app.
import * as path from 'node:path';

/** The file name of the installed program on Windows: the product name in electron-builder.json. */
export const INSTALLED_EXE = 'Cutting Boards.exe';

/** The parts of a shortcut that say where it points. */
export interface ShortcutTarget {
  target: string;
  args?: string;
  icon?: string;
}

/** What to do about the Start Menu entry: leave it, or write it new or over the one there. */
export type ShortcutAction = 'installer-owns' | 'present' | 'installed-copy' | 'create' | 'replace';

/**
 * Decide what a starting app does about the Start Menu entry, given the entry there now (`have`,
 * or null when there is none or it cannot be read) and the one this copy would write (`want`).
 *
 * - An installed copy (`packaged`) never writes one: its installer made the entry and its
 *   uninstaller removes it.
 * - An entry that already points at this copy is left as it is.
 * - An entry that points at an installed copy is left alone, so trying the source does not take
 *   over the Start Menu entry of the app someone installed.
 * - Otherwise the entry is created, or replaced when it points somewhere else (the project
 *   moved, Electron was upgraded).
 */
export function shortcutAction(have: ShortcutTarget | null, want: ShortcutTarget, packaged: boolean): ShortcutAction {
  if (packaged) return 'installer-owns';
  if (!have) return 'create';
  if (have.target === want.target && (have.args ?? '') === (want.args ?? '') && have.icon === want.icon) return 'present';
  // An installed copy is its own program, named for the app; Electron run from a project is not.
  // A shortcut read on Windows has Windows separators whatever system this runs on.
  if (path.win32.basename(have.target).toLowerCase() === INSTALLED_EXE.toLowerCase()) return 'installed-copy';
  return 'replace';
}
