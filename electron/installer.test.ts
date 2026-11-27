import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSTALLED_EXE, shortcutAction } from './shortcut.cts';

interface BuilderConfig {
  appId: string;
  productName: string;
  files: string[];
  directories: { output: string };
  electronFuses: Record<string, boolean>;
  nsis: { perMachine: boolean; deleteAppDataOnUninstall: boolean; artifactName: string; uninstallDisplayName: string };
}

/** A file of the project as text, wherever the tests were started from. */
const project = (file: string): string => readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');

/** The installer's settings, the app's package file and the desktop shell's source, as they are on disk. */
const config = JSON.parse(project('electron-builder.json')) as BuilderConfig;
const pkg = JSON.parse(project('package.json')) as { main: string; productName: string; author?: string; scripts: Record<string, string> };
const shell = project('electron/main.cts');

describe('the Windows installer\'s settings', () => {
  it('builds under the identity the app gives itself, so the installed window groups under the installer\'s Start Menu entry', () => {
    expect(shell).toContain(`const APP_ID = '${config.appId}';`);
  });

  it('names the program what the app takes an installed copy to be called', () => {
    expect(config.productName).toBe(pkg.productName);
    expect(INSTALLED_EXE).toBe(`${config.productName}.exe`);
    expect(config.nsis.uninstallDisplayName).toBe(config.productName);
  });

  it('asks for the built page, the built shell and the icon, and nothing from node_modules', () => {
    // What is really packed is checked against the package itself by scripts/make-installer.mjs.
    expect(config.files).toEqual(expect.arrayContaining(['dist/**', 'electron-dist/**', 'assets/**', 'package.json']));
    expect(pkg.main.startsWith('electron-dist/')).toBe(true);
    expect(config.files).toContain('!**/node_modules/**');
    expect(config.files).toContain('!dist/staticwebapp.config.json');
  });

  it('installs for one user, without administrator rights, and keeps their settings when uninstalled', () => {
    expect(config.nsis.perMachine).toBe(false);
    // Settings, with the board left open, are in the app's data folder. Designs are in Documents,
    // which no uninstaller touches.
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false);
  });

  it('turns off the ways an installed Electron can be made to run other code', () => {
    expect(config.electronFuses.runAsNode).toBe(false);
    expect(config.electronFuses.enableNodeOptionsEnvironmentVariable).toBe(false);
    expect(config.electronFuses.enableNodeCliInspectArguments).toBe(false);
    expect(config.electronFuses.onlyLoadAppFromAsar).toBe(true);
    expect(config.electronFuses.enableEmbeddedAsarIntegrityValidation).toBe(true);
  });

  it('puts the version in the installer\'s file name, in a folder git ignores', () => {
    expect(config.nsis.artifactName).toContain('${version}');
    expect(project('.gitignore').split(/\r?\n/)).toContain(`${config.directories.output}/`);
  });

  it('has an author, which the installer shows as the publisher', () => {
    expect(pkg.author).toBeTruthy();
  });

  it('is made by npm run installer', () => {
    expect(pkg.scripts.installer).toBe('node scripts/make-installer.mjs');
  });
});

describe('the Start Menu entry', () => {
  const source = { target: 'D:\\proj\\node_modules\\electron\\dist\\electron.exe', args: '"D:\\proj"', icon: 'D:\\proj\\assets\\icon.ico' };
  const installed = { target: 'C:\\Users\\someone\\AppData\\Local\\Programs\\Cutting Boards\\Cutting Boards.exe', args: '', icon: '' };

  it('is never written by an installed copy, whatever is there', () => {
    expect(shortcutAction(null, installed, true)).toBe('installer-owns');
    expect(shortcutAction(source, installed, true)).toBe('installer-owns');
    expect(shortcutAction(installed, installed, true)).toBe('installer-owns');
  });

  it('is created by a copy run from the project when there is none', () => {
    expect(shortcutAction(null, source, false)).toBe('create');
  });

  it('is left as it is when it already points at this copy', () => {
    expect(shortcutAction({ ...source }, source, false)).toBe('present');
    // No arguments and empty arguments are the same shortcut.
    expect(shortcutAction({ target: 'a.exe', icon: 'i' }, { target: 'a.exe', args: '', icon: 'i' }, false)).toBe('present');
  });

  it('is left alone by a copy run from the project when it belongs to an installed copy', () => {
    expect(shortcutAction(installed, source, false)).toBe('installed-copy');
    // Windows file names do not mind their case.
    expect(shortcutAction({ ...installed, target: installed.target.toUpperCase() }, source, false)).toBe('installed-copy');
  });

  it('is replaced when it points at another project copy: the project moved, or Electron was upgraded', () => {
    expect(shortcutAction({ ...source, target: 'E:\\old\\node_modules\\electron\\dist\\electron.exe' }, source, false)).toBe('replace');
    expect(shortcutAction({ ...source, args: '"E:\\old"' }, source, false)).toBe('replace');
    expect(shortcutAction({ ...source, icon: 'E:\\old\\assets\\icon.ico' }, source, false)).toBe('replace');
  });

  it('does not mistake a folder named like the program for the installed copy', () => {
    expect(shortcutAction({ ...source, target: 'D:\\Cutting Boards.exe\\electron.exe' }, source, false)).toBe('replace');
  });
});

describe('an installed copy', () => {
  it('obeys none of the switches that run code in the page or write a file where they are told', () => {
    // Each is read through devArg, which answers nothing in an installed copy.
    expect(shell).toContain('const devArg = (name: string): string | undefined => (app.isPackaged ? undefined : arg(name));');
    for (const name of ['eval', 'pdf', 'screenshot', 'query', 'ready', 'wait', 'width', 'height']) {
      expect(shell, name).toContain(`devArg('${name}')`);
      // ...and nowhere through plain arg, which an installed copy would obey.
      expect(shell, name).not.toMatch(new RegExp(`(^|[^A-Za-z])arg\\('${name}'\\)`, 'm'));
    }
  });

  it('loads its own page, never an address handed to it in the environment', () => {
    expect(shell).toContain('const dev = app.isPackaged ? undefined : process.env.CB_DEV_URL;');
  });
});
