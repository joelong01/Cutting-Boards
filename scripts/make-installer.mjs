#!/usr/bin/env node
/**
 * Build the Windows installer for the desktop app, and check the app inside it before saying it
 * is ready. Every test and window check runs first; a failure stops it before anything is packed.
 *
 *   node scripts/make-installer.mjs           check, build, pack, verify
 *   node scripts/make-installer.mjs --plan    say what it would do, change nothing
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
 * The check at the end runs the packed app itself, not the source: it saves, lists, reads and
 * deletes a design through it in a throwaway folder (`--selftest`). It does not run the
 * installer, which would add a Start Menu entry and an uninstall record to this machine.
 *
 * The installer is not code signed, so Windows shows a "Windows protected your PC" box the
 * first time it is run; More info, then Run anyway, gets past it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const release = join(root, 'release');
const plan = process.argv.includes('--plan');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(root, 'electron-builder.json'), 'utf8'));
/** The installer's file name, as `artifactName` in electron-builder.json gives it. */
const installer = join(release, config.nsis.artifactName.replace('${version}', pkg.version).replace('${ext}', 'exe'));
/** The packed app's program, in the folder the installer is made from. */
const packed = join(release, 'win-unpacked', `${config.productName}.exe`);
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
 * Run a command and throw if it exits non-zero. With `capture` its output is returned instead of
 * shown. Through a shell unless `direct`, which is for a program whose path has spaces in it.
 */
function run(cmd, args, { capture = false, direct = false, env = process.env } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root, encoding: 'utf8', env,
    shell: !direct && process.platform === 'win32',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (r.error) throw new Error(`${cmd} could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} exited with ${r.status}${capture ? `: ${`${r.stdout}${r.stderr}`.trim().slice(-400)}` : ''}`);
  return capture ? `${r.stdout}${r.stderr}` : '';
}

/**
 * Run the packed app's own self test: it saves a design, lists it, reads it back, deletes it and
 * is refused a file name outside the designs folder, all in a throwaway folder, off the screen.
 */
function selfTest() {
  // Editors built on Electron export this, and it makes Electron start as plain Node.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const out = run(packed, ['--selftest', '--profile=installer'], { capture: true, direct: true, env });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('selftest '));
  if (!line) throw new Error(`the packed app printed no self test result: ${out.trim().slice(-300)}`);
  const result = JSON.parse(line.slice('selftest '.length));
  for (const key of ['listed', 'same', 'gone', 'rejected']) {
    if (result[key] !== true) throw new Error(`the packed app failed its self test at "${key}": ${line}`);
  }
  console.log('  the packed app saved, listed, read and deleted a design, and refused a path outside its folder');
}

/** Check, build, pack and verify, printing where the installer is and its SHA-256. */
async function main() {
  if (process.platform !== 'win32') throw new Error('this builds the Windows installer, and has to be run on Windows.');
  console.log(`Installer: ${installer}`);
  console.log(`Version: ${pkg.version}`);
  if (plan) {
    console.log('Plan: npm run check (model tests, then build and window checks), stopping on any failure; empty release/; pack the build with electron-builder into a per-user NSIS installer; run the packed app\'s self test; print the installer\'s size and SHA-256. The installer itself is not run.');
    return;
  }
  // `check` builds dist/ and electron-dist/ and tests the window against them, so what is packed
  // is what was tested.
  await phase('test and build', () => run('npm', ['run', 'check']));
  await phase('pack', () => {
    // An installer left from another version would sit beside the new one and be mistaken for it.
    rmSync(release, { recursive: true, force: true });
    run('npx', ['electron-builder', '--win', '--config', 'electron-builder.json']);
    if (!existsSync(installer)) throw new Error(`electron-builder finished but ${installer} is not there.`);
    if (!existsSync(packed)) throw new Error(`electron-builder finished but ${packed} is not there.`);
  });
  await phase('verify', () => selfTest());
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
