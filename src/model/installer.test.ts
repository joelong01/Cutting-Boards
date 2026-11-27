import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface BuilderConfig {
  appId: string;
  productName: string;
  files: string[];
  directories: { output: string };
  nsis: { perMachine: boolean; deleteAppDataOnUninstall: boolean; artifactName: string };
}

/** The installer's settings, the app's package file and the desktop shell's source, as they are on disk. */
const config = JSON.parse(readFileSync('electron-builder.json', 'utf8')) as BuilderConfig;
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { main: string; productName: string; author?: string; scripts: Record<string, string> };
const shell = readFileSync('electron/main.cts', 'utf8');

describe('the Windows installer', () => {
  it('is built under the identity the app gives itself, so the installed window groups under the installer\'s Start Menu entry', () => {
    expect(shell).toContain(`const APP_ID = '${config.appId}';`);
  });

  it('names the program what the app expects an installed copy to be called', () => {
    expect(config.productName).toBe(pkg.productName);
    expect(shell).toContain(`const INSTALLED_EXE = '${config.productName}.exe';`);
  });

  it('packs the built page, the built shell and the icon, and nothing from node_modules', () => {
    // The shell loads ../dist/index.html and ../assets/icon.ico from beside electron-dist/.
    expect(config.files).toEqual(expect.arrayContaining(['dist/**', 'electron-dist/**', 'assets/**', 'package.json']));
    expect(pkg.main.startsWith('electron-dist/')).toBe(true);
    // The page is bundled by the build; shipping its libraries again would only make the installer bigger.
    expect(config.files).toContain('!**/node_modules/**');
    // The web host's settings file means nothing to the desktop app.
    expect(config.files).toContain('!dist/staticwebapp.config.json');
  });

  it('installs for one user, without administrator rights, and leaves their designs when uninstalled', () => {
    expect(config.nsis.perMachine).toBe(false);
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false);
  });

  it('puts the version in the installer\'s file name, in a folder git ignores', () => {
    expect(config.nsis.artifactName).toContain('${version}');
    expect(readFileSync('.gitignore', 'utf8').split(/\r?\n/)).toContain(`${config.directories.output}/`);
  });

  it('has an author, which the installer shows as the publisher', () => {
    expect(pkg.author).toBeTruthy();
  });

  it('is made by npm run installer', () => {
    expect(pkg.scripts.installer).toBe('node scripts/make-installer.mjs');
  });

  it('an installed copy does not write a Start Menu entry of its own, and a copy run from the project leaves the installed one alone', () => {
    expect(shell).toContain("if (app.isPackaged) return 'skipped: the installer made it';");
    expect(shell).toContain('belongs to the installed app');
  });
});
