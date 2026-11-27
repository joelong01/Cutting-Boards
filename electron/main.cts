// Desktop shell. It owns the files: the page asks for designs through the narrow API in
// preload.cts and never touches the disk itself.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { shortcutAction } from './shortcut.cjs';

/** Value of a --name=value command-line argument, or undefined when absent. */
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * Value of a --name=value argument that only a copy run from the project obeys. An installed
 * copy ignores these: `--eval` runs code in the page, `--pdf` and `--screenshot` write a file
 * wherever they are told, and none of that belongs in a program on someone's computer.
 */
const devArg = (name: string): string | undefined => (app.isPackaged ? undefined : arg(name));

// Run from the project, designs live beside the source so they are versioned with it.
// A test run keeps its designs in its own throwaway settings folder: a check that saved into the
// real folder left its file there, and the next run stopped on a "replace it?" box on screen.
const designsDir = (): string => {
  if (TEST_RUN) return path.join(app.getPath('userData'), 'designs');
  return app.isPackaged ? path.join(app.getPath('documents'), 'Cutting Boards') : path.join(app.getAppPath(), 'designs');
};

const SUFFIX = '.board.json';

/** Accept a bare design file name only: no folders, no other extensions. */
function designPath(file: string): string {
  if (typeof file !== 'string' || path.basename(file) !== file || !file.endsWith(SUFFIX) || file.length <= SUFFIX.length) {
    throw new Error(`Not a design file name: ${String(file)}`);
  }
  return path.join(designsDir(), file);
}

/** Every design file in the designs folder, newest first, with the name stored inside it. An unreadable file is listed and marked, not hidden. */
async function listDesigns() {
  await fs.mkdir(designsDir(), { recursive: true });
  const out: { file: string; name: string; modified: number }[] = [];
  for (const file of await fs.readdir(designsDir())) {
    if (!file.endsWith(SUFFIX)) continue;
    const full = path.join(designsDir(), file);
    let name = file.slice(0, -SUFFIX.length);
    try {
      const parsed = JSON.parse(await fs.readFile(full, 'utf8')) as { name?: unknown };
      if (typeof parsed.name === 'string' && parsed.name) name = parsed.name;
    } catch {
      name += ' (unreadable)';
    }
    out.push({ file, name, modified: (await fs.stat(full)).mtimeMs });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/**
 * Write the page as it prints (the cut list and order of operations, by the page's print styles)
 * to a PDF file, and return the path. Save as PDF and the `--pdf` test flag both come through
 * here, so the automated check exercises the same code the button does, less the file dialog.
 */
async function writeSheetPdf(contents: Electron.WebContents, file: string): Promise<string> {
  await fs.writeFile(file, await contents.printToPDF({ printBackground: true, pageSize: 'Letter' }));
  return file;
}

/** Register the handlers behind the page API in preload.cts. Every file name from the page goes through designPath. */
function registerIpc() {
  ipcMain.handle('designs:dir', () => designsDir());
  ipcMain.handle('designs:list', () => listDesigns());
  ipcMain.handle('designs:read', (_e, file: string) => fs.readFile(designPath(file), 'utf8'));
  ipcMain.handle('designs:write', async (_e, file: string, text: string) => {
    const full = designPath(file);
    await fs.mkdir(designsDir(), { recursive: true });
    // Write beside the target and rename, so a crash cannot leave half a design.
    const tmp = `${full}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, full);
    return full;
  });
  // To the recycle bin, not gone: a mis-click must be recoverable.
  // A test run deletes outright: its file is in a throwaway folder, and sending it to the recycle
  // bin would leave one more item there after every run.
  ipcMain.handle('designs:delete', (_e, file: string) => (TEST_RUN ? fs.rm(designPath(file)) : shell.trashItem(designPath(file))));
  ipcMain.handle('designs:reveal', async () => {
    await fs.mkdir(designsDir(), { recursive: true });
    return shell.openPath(designsDir());
  });
  ipcMain.handle('pdf:save', async (e, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const pick = await dialog.showSaveDialog(win, {
      defaultPath: path.join(designsDir(), `${defaultName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (pick.canceled || !pick.filePath) return null;
    return writeSheetPdf(e.sender, pick.filePath);
  });
}

/**
 * Give the page time to settle before a test looks at it. With `--ready=<expression>` that is as
 * soon as the expression is true in the page, checked every 50 ms, and `--wait` is only the
 * longest to wait; without it, the whole of `--wait` (or `fallback` milliseconds).
 */
async function settle(win: BrowserWindow, fallback: number): Promise<void> {
  const ready = devArg('ready');
  const wait = Number(devArg('wait') ?? (ready ? 15000 : fallback));
  if (!ready) {
    await new Promise((r) => setTimeout(r, wait));
    return;
  }
  const until = Date.now() + wait;
  while (Date.now() < until) {
    if (await win.webContents.executeJavaScript(`(() => { try { return !!(${ready}); } catch { return false; } })()`)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** True when a test run was asked to put its window where it can be watched. */
const ON_SCREEN = process.argv.includes('--show');

/** Open the app window and load the page. With --selftest or --screenshot, run that check and exit instead of staying open. */
async function createWindow() {
  const shot = devArg('screenshot');
  const win = new BrowserWindow({
    width: Number(devArg('width') ?? 1500),
    height: Number(devArg('height') ?? 950),
    // A test run's window is never on a screen, so it cannot land on top of someone's work: it
    // is placed far outside every monitor and kept out of the taskbar. It is still a shown
    // window, because a hidden one draws too slowly for the checks. `--show` puts it on screen
    // to watch it.
    show: !TEST_RUN,
    ...(TEST_RUN && !ON_SCREEN ? { x: -32000, y: -32000, skipTaskbar: true, focusable: false } : {}),
    title: 'Cutting Boards',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // A hidden or covered window pauses animation frames, which leaves a test run with a
      // half-drawn or empty 3D view. Keep frames running for test runs only.
      backgroundThrottling: !TEST_RUN,
    },
  });
  // Links in the page open in the real browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (shot || devArg('eval') || devArg('pdf')) {
    win.showInactive();
    // Registered before the page loads, so errors thrown during start-up are reported too.
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error(`[page] ${message}`);
    });
  }

  const query = devArg('query') ?? '';
  // The address of a development server is taken from the environment only when run from the
  // project: an installed copy loads its own page and nothing else.
  const dev = app.isPackaged ? undefined : process.env.CB_DEV_URL;
  if (dev) await win.loadURL(dev + (query ? `?${query}` : ''));
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { search: query });

  if (process.argv.includes('--selftest')) {
    // Round-trip a design through the bridge the page uses, then delete the file; and wait for
    // the page to draw a board, so a copy whose page is missing or broken fails here too.
    const result = await win.webContents.executeJavaScript(`(async () => {
      const drawn = await new Promise((done) => {
        const t0 = performance.now();
        const check = () => {
          const frames = window.boardScene ? window.boardScene.renderer.info.render.frame : 0;
          const cards = document.querySelectorAll('.card').length;
          if (frames > 5 && cards > 0) done(true);
          else if (performance.now() - t0 > 15000) done(false);
          else setTimeout(check, 100);
        };
        check();
      });
      const file = 'zz-selftest.board.json';
      const text = JSON.stringify({ version: 1, name: 'Self test', layup: { strips: [] }, steps: [] });
      const where = await window.boards.write(file, text);
      const listed = (await window.boards.list()).some((e) => e.file === file && e.name === 'Self test');
      const same = (await window.boards.read(file)) === text;
      await window.boards.remove(file);
      const gone = !(await window.boards.list()).some((e) => e.file === file);
      let rejected = false;
      try { await window.boards.write('../escape.board.json', text); } catch { rejected = true; }
      return { where, listed, same, gone, rejected, drawn };
    })()`);
    console.log(`selftest ${JSON.stringify(result)}`);
    const ok = result.listed && result.same && result.gone && result.rejected && result.drawn;
    app.exit(ok ? 0 : 1);
    return;
  }

  const probe = devArg('eval');
  if (probe) {
    // Diagnostic: run one expression in the page after it settles and print the result.
    await settle(win, 2500);
    console.log(`eval ${JSON.stringify(await win.webContents.executeJavaScript(probe))}`);
    // A probe on its own is a one-shot check; with --screenshot the capture below ends the run.
    if (!shot) app.quit();
  }

  const pdfOut = devArg('pdf');
  if (pdfOut) {
    // Smoke test: `--pdf=out.pdf` does what Save as PDF does once the file has been chosen, and exits.
    await settle(win, 1500);
    console.log(`pdf written: ${await writeSheetPdf(win.webContents, pdfOut)}`);
    app.quit();
    return;
  }

  if (shot) {
    // Smoke test: `--screenshot=out.png --query=preset=brick` renders the page and exits.
    await new Promise((r) => setTimeout(r, Number(devArg('wait') ?? 2500)));
    // A window that is not in front draws slowly at first; wait until the 3D view has drawn
    // enough frames to have settled, or ten seconds, before taking the picture.
    await win.webContents.executeJavaScript(`new Promise((done) => {
      const t0 = performance.now();
      const check = () => {
        const frames = window.boardScene ? window.boardScene.renderer.info.render.frame : 0;
        if (frames > 40 || performance.now() - t0 > 10000) done(frames);
        else setTimeout(check, 100);
      };
      check();
    })`);
    const image = await win.webContents.capturePage();
    await fs.writeFile(shot, image.toPNG());
    console.log(`screenshot written: ${shot}`);
    app.quit();
  }
}

// The installer is built with this same identity (`appId` in electron-builder.json), so the
// installed app's window groups under the Start Menu entry the installer makes.
const APP_ID = 'Shop.CuttingBoards';
// The name Windows shows for the app, in the print dialog's title among other places. Changing
// the name would also move the folder Electron keeps the app's settings in, and with it the
// design left open last time, so that folder is pinned to where it has always been.
app.setName('Cutting Boards');
// Test runs get a settings folder of their own. Sharing the real one let a smoke test replace the
// design the user had left open with whichever starter design the test loaded. `--profile=<name>`
// picks a separate one again, so several test runs can be open at the same time.
// An installed copy has one test left to it, `--selftest`, which the installer's build runs: it
// touches only a throwaway folder. The other test switches are a project copy's alone (`devArg`).
const TEST_RUN = process.argv.includes('--selftest')
  || ['screenshot', 'eval', 'pdf'].some((name) => devArg(name) !== undefined);
app.setPath('userData', TEST_RUN
  ? path.join(app.getPath('temp'), `cutting-boards-test${arg('profile') ? `-${arg('profile')}` : ''}`)
  : path.join(app.getPath('appData'), 'cutting-boards'));
// Windows stops drawing a window that another covers completely. The smoke checks open several
// test windows on top of one another, so some never drew a frame and their check timed out.
// In a test run, keep every window drawing whether or not it can be seen.
if (TEST_RUN) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}
// Its own taskbar identity on Windows, matching the Start Menu shortcut, so the window shows
// this app's icon and does not group under the generic Electron one.
app.setAppUserModelId(APP_ID);

/**
 * Make sure Windows has a Start Menu entry for this app, and return what was done. The shortcut
 * starts this same Electron with this same project folder, so it opens whatever was last built.
 * It is rewritten only when missing or pointing somewhere else (the project moved, Electron was
 * upgraded), so a normal start touches nothing. Does nothing on other systems.
 *
 * An installed copy does nothing here: its installer made the entry and its uninstaller removes
 * it. A copy run from the project leaves an installed copy's entry alone, so trying the source
 * does not take over the Start Menu entry of the app someone installed. Which of these applies
 * is decided by `shortcutAction` in shortcut.cts.
 */
function ensureStartMenuShortcut(): string {
  if (process.platform !== 'win32') return 'skipped: not Windows';
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Cutting Boards.lnk');
  const root = app.getAppPath();
  const want = {
    target: process.execPath,
    // Run from the project, Electron needs the folder to load.
    args: `"${root}"`,
    cwd: root,
    description: 'Model a cutting board through its glue-ups',
    icon: path.join(root, 'assets', 'icon.ico'),
    iconIndex: 0,
    appUserModelId: APP_ID,
  };
  let have: Electron.ShortcutDetails | null = null;
  // An installed copy never reads the entry: it is not its to change.
  if (!app.isPackaged) {
    try {
      have = shell.readShortcutLink(link);
    } catch {
      // No shortcut yet, or one that cannot be read: write a fresh one.
    }
  }
  const action = shortcutAction(have, want, app.isPackaged);
  if (action === 'installer-owns') return 'skipped: the installer made it';
  if (action === 'present') return `already present: ${link}`;
  if (action === 'installed-copy') return `left alone: ${link} belongs to the installed app`;
  const ok = shell.writeShortcutLink(link, action, want);
  return ok ? `${action === 'replace' ? 'updated' : 'created'}: ${link}` : `failed to write: ${link}`;
}

app.whenReady().then(() => {
  if (process.argv.includes('--shortcut-only')) {
    // Add the Start Menu entry without opening the app; `npm run shortcut` uses this.
    console.log(`start menu ${ensureStartMenuShortcut()}`);
    app.quit();
    return;
  }
  // Test runs must not change anything outside the project.
  if (!TEST_RUN) console.log(`start menu ${ensureStartMenuShortcut()}`);
  registerIpc();
  createWindow().catch((err: unknown) => {
    // A page or preload that is missing leaves no window and nothing to close, so a test run
    // would wait for ever: say what went wrong and stop.
    console.error(`could not open the window: ${err instanceof Error ? err.message : String(err)}`);
    if (TEST_RUN) app.exit(1);
  });
});
app.on('window-all-closed', () => app.quit());
