// Desktop shell. It owns the files: the page asks for designs through the narrow API in
// preload.cts and never touches the disk itself.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Value of a --name=value command-line argument, or undefined when absent. */
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// Run from the project, designs live beside the source so they are versioned with it.
const designsDir = (): string =>
  (app.isPackaged ? path.join(app.getPath('documents'), 'Cutting Boards') : path.join(app.getAppPath(), 'designs'));

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
  ipcMain.handle('designs:delete', (_e, file: string) => shell.trashItem(designPath(file)));
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
  const ready = arg('ready');
  const wait = Number(arg('wait') ?? (ready ? 15000 : fallback));
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

/** Open the app window and load the page. With --selftest or --screenshot, run that check and exit instead of staying open. */
async function createWindow() {
  const shot = arg('screenshot');
  const win = new BrowserWindow({
    width: Number(arg('width') ?? 1500),
    height: Number(arg('height') ?? 950),
    show: !shot,
    title: 'Cutting Boards',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // A hidden window pauses animation frames, which leaves the smoke-test screenshot
      // with a half-drawn or empty 3D view. Keep frames running for that case only.
      backgroundThrottling: !shot,
    },
  });
  // Links in the page open in the real browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (shot || arg('eval') || arg('pdf')) {
    // Shown but not focused: a hidden window draws too few frames for the 3D view to settle.
    win.showInactive();
    // Registered before the page loads, so errors thrown during start-up are reported too.
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error(`[page] ${message}`);
    });
  }

  const query = arg('query') ?? '';
  const dev = process.env.CB_DEV_URL;
  if (dev) await win.loadURL(dev + (query ? `?${query}` : ''));
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { search: query });

  if (process.argv.includes('--selftest')) {
    // Round-trip a design through the bridge the page uses, then put the file in the recycle bin.
    const result = await win.webContents.executeJavaScript(`(async () => {
      const file = 'zz-selftest.board.json';
      const text = JSON.stringify({ version: 1, name: 'Self test', layup: { strips: [] }, steps: [] });
      const where = await window.boards.write(file, text);
      const listed = (await window.boards.list()).some((e) => e.file === file && e.name === 'Self test');
      const same = (await window.boards.read(file)) === text;
      await window.boards.remove(file);
      const gone = !(await window.boards.list()).some((e) => e.file === file);
      let rejected = false;
      try { await window.boards.write('../escape.board.json', text); } catch { rejected = true; }
      return { where, listed, same, gone, rejected };
    })()`);
    console.log(`selftest ${JSON.stringify(result)}`);
    const ok = result.listed && result.same && result.gone && result.rejected;
    app.exit(ok ? 0 : 1);
    return;
  }

  const probe = arg('eval');
  if (probe) {
    // Diagnostic: run one expression in the page after it settles and print the result.
    await settle(win, 2500);
    console.log(`eval ${JSON.stringify(await win.webContents.executeJavaScript(probe))}`);
    // A probe on its own is a one-shot check; with --screenshot the capture below ends the run.
    if (!shot) app.quit();
  }

  const pdfOut = arg('pdf');
  if (pdfOut) {
    // Smoke test: `--pdf=out.pdf` does what Save as PDF does once the file has been chosen, and exits.
    await settle(win, 1500);
    console.log(`pdf written: ${await writeSheetPdf(win.webContents, pdfOut)}`);
    app.quit();
    return;
  }

  if (shot) {
    // Smoke test: `--screenshot=out.png --query=preset=brick` renders the page and exits.
    await new Promise((r) => setTimeout(r, Number(arg('wait') ?? 2500)));
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

const APP_ID = 'Shop.CuttingBoards';
// The name Windows shows for the app, in the print dialog's title among other places. Changing
// the name would also move the folder Electron keeps the app's settings in, and with it the
// design left open last time, so that folder is pinned to where it has always been.
app.setName('Cutting Boards');
// Test runs get a settings folder of their own. Sharing the real one let a smoke test replace the
// design the user had left open with whichever starter design the test loaded. `--profile=<name>`
// picks a separate one again, so several test runs can be open at the same time.
const TEST_RUN = process.argv.includes('--selftest')
  || ['screenshot', 'eval', 'pdf'].some((name) => process.argv.some((a) => a.startsWith(`--${name}=`)));
app.setPath('userData', TEST_RUN
  ? path.join(app.getPath('temp'), `cutting-boards-test${arg('profile') ? `-${arg('profile')}` : ''}`)
  : path.join(app.getPath('appData'), 'cutting-boards'));
// Its own taskbar identity on Windows, matching the Start Menu shortcut, so the window shows
// this app's icon and does not group under the generic Electron one.
app.setAppUserModelId(APP_ID);

/**
 * Make sure Windows has a Start Menu entry for this app, and return what was done. The shortcut
 * starts this same Electron with this same project folder, so it opens whatever was last built.
 * It is rewritten only when missing or pointing somewhere else (the project moved, Electron was
 * upgraded), so a normal start touches nothing. Does nothing on other systems.
 */
function ensureStartMenuShortcut(): string {
  if (process.platform !== 'win32') return 'skipped: not Windows';
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Cutting Boards.lnk');
  const root = app.getAppPath();
  const want = {
    target: process.execPath,
    // A packaged app is its own program; run from the project, Electron needs the folder to load.
    args: app.isPackaged ? '' : `"${root}"`,
    cwd: root,
    description: 'Model a cutting board through its glue-ups',
    icon: path.join(root, 'assets', 'icon.ico'),
    iconIndex: 0,
    appUserModelId: APP_ID,
  };
  let have: Electron.ShortcutDetails | null = null;
  try {
    have = shell.readShortcutLink(link);
  } catch {
    // No shortcut yet, or one that cannot be read: write a fresh one.
  }
  if (have && have.target === want.target && (have.args ?? '') === want.args && have.icon === want.icon) {
    return `already present: ${link}`;
  }
  const ok = shell.writeShortcutLink(link, have ? 'replace' : 'create', want);
  return ok ? `${have ? 'updated' : 'created'}: ${link}` : `failed to write: ${link}`;
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
  void createWindow();
});
app.on('window-all-closed', () => app.quit());
