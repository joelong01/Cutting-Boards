#!/usr/bin/env node
/**
 * Build the Windows installer for the desktop app, and check the app inside it before saying it
 * is ready. Every test and window check runs first; a failure stops it before anything is packed.
 *
 *   node scripts/make-installer.mjs              check, build, pack, verify
 *   node scripts/make-installer.mjs --no-check   build, pack, verify: the checks were run elsewhere
 *   node scripts/make-installer.mjs --plan       say what it would do, change nothing
 *
 * `--no-check` is for the release workflow (.github/workflows/release.yml). The window checks
 * need a real desktop, which the machine a release is built on does not have, so there they are
 * run before a change is merged and not again; the packed app's own self test still runs.
 *
 * What comes out, in `release/` (generated, ignored by git):
 *
 *   Cutting-Boards-Setup-<version>.exe   the installer to hand to someone
 *   win-unpacked/                        the app exactly as the installer lays it down
 *
 * The installer is per user: it needs no administrator rights, puts the app under the user's
 * own programs folder, adds a Start Menu entry and an uninstaller. Installed, the app keeps
 * designs in Documents\Cutting Boards, which uninstalling leaves alone. The packing is
 * electron-builder's, set up in `electron-builder.json`.
 *
 * Two checks are made of what was packed, not of the source:
 *
 * - The package holds the built page, the built shell, the icon and package.json, and nothing
 *   else: no source, no tests, no node_modules, no settings of the web host.
 * - The packed app is run with `--selftest`, off the screen and in a throwaway folder that is
 *   deleted afterwards. It must draw a board, and save, list, read and delete a design. A packed
 *   app that does not finish in a minute is stopped and counted as failed.
 *
 * It does not run the installer, which would add a Start Menu entry and an uninstall record to
 * this machine.
 *
 * The installer is not code signed, so Windows shows a "Windows protected your PC" box the
 * first time it is run; More info, then Run anyway, gets past it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const release = join(root, 'release');
const plan = process.argv.includes('--plan');
/** Build without running the tests and window checks first: they were run before this. */
const unchecked = process.argv.includes('--no-check');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(root, 'electron-builder.json'), 'utf8'));
/** The installer's file name, as `artifactName` in electron-builder.json gives it. */
const installer = join(release, config.nsis.artifactName.replace('${version}', pkg.version).replace('${ext}', 'exe'));
/** The packed app's program, in the folder the installer is made from. */
const packed = join(release, 'win-unpacked', `${config.productName}.exe`);
/** The packed app's files, in one archive beside the program. */
const archive = join(release, 'win-unpacked', 'resources', 'app.asar');
/** The name of the self test's settings folder (see `--profile` in electron/main.cts), and where it is. */
const PROFILE = 'installer';
const profileDir = join(tmpdir(), `cutting-boards-test-${PROFILE}`);
/** How long the packed app has to finish its self test before it is stopped, in milliseconds. */
const SELF_TEST_LIMIT = 60000;
const timings = [];
const started = performance.now();

/** Run one named phase, timing it on a monotonic clock whether it passes or fails. */
async function phase(name, fn) {
  const t = performance.now();
  try {
    return await fn();
  } finally {
    const s = (performance.now() - t) / 1000;
    timings.push([name, s]);
    console.log(`  ${name}: ${s.toFixed(1)} s`);
  }
}

/**
 * Run a command and throw if it exits non-zero, cannot be started, or (given `timeout`
 * milliseconds) does not finish in time, in which case it is stopped. With `capture` its output
 * is returned instead of shown. Through a shell unless `direct`, which is for a program whose
 * path has spaces in it.
 */
function run(cmd, args, { capture = false, direct = false, env = process.env, timeout = 0 } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root, encoding: 'utf8', env,
    shell: !direct && process.platform === 'win32',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...(timeout ? { timeout, killSignal: 'SIGKILL' } : {}),
  });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${cmd} did not finish in ${timeout / 1000} s and was stopped`);
  if (r.error) throw new Error(`${cmd} could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} exited with ${r.status}${capture ? `: ${`${r.stdout}${r.stderr}`.trim().slice(-400)}` : ''}`);
  return capture ? `${r.stdout}${r.stderr}` : '';
}

/**
 * Check what is in the packed app's archive: everything the app loads is there, and nothing is
 * there but the built page, the built shell, the icon and package.json.
 */
async function checkContents() {
  // electron-builder's own archive reader, which comes with it.
  const { listPackage } = await import('@electron/asar');
  const files = listPackage(archive).map((f) => f.replaceAll('\\', '/').replace(/^\//, '')).filter((f) => /\.[a-z0-9]+$/i.test(f));
  const needed = ['package.json', 'dist/index.html', 'electron-dist/main.cjs', 'electron-dist/preload.cjs', 'electron-dist/shortcut.cjs', 'assets/icon.ico'];
  const missing = needed.filter((f) => !files.includes(f));
  if (missing.length) throw new Error(`the package is missing ${missing.join(', ')}`);
  if (!files.some((f) => /^dist\/assets\/[^/]+\.js$/.test(f))) throw new Error('the package has no page script under dist/assets/');
  const allowed = [/^package\.json$/, /^dist\/index\.html$/, /^dist\/icon\.png$/, /^dist\/assets\/[^/]+\.(js|css)$/, /^electron-dist\/[^/]+\.cjs$/, /^assets\/icon\.(ico|png)$/];
  const extra = files.filter((f) => !allowed.some((a) => a.test(f)));
  if (extra.length) throw new Error(`the package holds files it should not: ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? `, and ${extra.length - 8} more` : ''}`);
  console.log(`  the package holds ${files.length} files: the page, the shell, the icon and package.json, and nothing else`);
}

/**
 * Run the packed app's own self test: it draws a board, saves a design, lists it, reads it back,
 * deletes it and is refused a file name outside the designs folder, all in a throwaway folder,
 * off the screen. The folder is deleted afterwards, pass or fail.
 */
function selfTest() {
  // Editors built on Electron export this, and it makes Electron start as plain Node.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const out = run(packed, ['--selftest', `--profile=${PROFILE}`], { capture: true, direct: true, env, timeout: SELF_TEST_LIMIT });
    const line = out.split(/\r?\n/).find((l) => l.startsWith('selftest '));
    if (!line) throw new Error(`the packed app printed no self test result: ${out.trim().slice(-300)}`);
    const result = JSON.parse(line.slice('selftest '.length));
    for (const key of ['drawn', 'listed', 'same', 'gone', 'rejected']) {
      if (result[key] !== true) throw new Error(`the packed app failed its self test at "${key}": ${line}`);
    }
    // The design must have gone to the throwaway folder, not to anyone's Documents.
    if (!resolve(String(result.where)).toLowerCase().startsWith(`${resolve(profileDir)}${sep}`.toLowerCase())) {
      throw new Error(`the packed app's self test wrote outside its throwaway folder: ${result.where}`);
    }
    console.log('  the packed app drew a board, saved, listed, read and deleted a design, and refused a path outside its folder');
  } finally {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** Check (unless `--no-check`), build, pack and verify, printing where the installer is and its SHA-256. */
async function main() {
  if (process.platform !== 'win32') throw new Error('this builds the Windows installer, and has to be run on Windows.');
  console.log(`Installer: ${installer}`);
  console.log(`Version: ${pkg.version}`);
  if (plan) {
    console.log(`Plan: ${unchecked ? 'npm run build, with no tests or window checks' : 'npm run check (model tests, then build and window checks), stopping on any failure'}; empty release/; pack the build with electron-builder into a per-user NSIS installer; check the package holds the page, the shell and the icon and nothing else; run the packed app's self test in a throwaway folder and delete the folder; print the installer's size and SHA-256. The installer itself is not run.`);
    return;
  }
  // `check` builds dist/ and electron-dist/ and tests the window against them, so what is packed
  // is what was tested. Without it they are only built.
  if (unchecked) await phase('build', () => run('npm', ['run', 'build']));
  else await phase('test and build', () => run('npm', ['run', 'check']));
  await phase('pack', () => {
    // An installer left from another version would sit beside the new one and be mistaken for it.
    rmSync(release, { recursive: true, force: true });
    run('npx', ['electron-builder', '--win', '--config', 'electron-builder.json']);
    for (const made of [installer, packed, archive]) {
      if (!existsSync(made)) throw new Error(`electron-builder finished but ${made} is not there.`);
    }
  });
  await phase('verify', async () => {
    await checkContents();
    selfTest();
  });
  const bytes = readFileSync(installer);
  console.log(`Built: ${installer}`);
  console.log(`  ${(statSync(installer).size / 1048576).toFixed(1)} MB, SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`);
}

main()
  .catch((err) => {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    const total = (performance.now() - started) / 1000;
    console.log(`Total: ${total.toFixed(1)} s${timings.length ? ` (${timings.map(([n, s]) => `${n} ${s.toFixed(1)}`).join(', ')})` : ''}`);
  });
