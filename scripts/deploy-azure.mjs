#!/usr/bin/env node
/**
 * Build the web version of Cutting Boards and publish it to the Azure App Service `cuttingboard`
 * (resource group `rg-cutting-boards`), https://cuttingboard.azurewebsites.net, then check that the
 * live site serves exactly the files just built, by hash.
 *
 *   node scripts/deploy-azure.mjs          build, deploy, verify
 *   node scripts/deploy-azure.mjs --plan   say what it would do, change nothing
 *
 * Needs the Azure CLI signed in (`az login`). The site gets a zip of `dist/` with the old files
 * cleaned out, and serves them with `pm2 serve`.
 *
 * The web version keeps designs in the browser's storage, not in files: it is for showing a
 * board (on a phone, say), not for keeping designs.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUP = 'rg-cutting-boards';
const APP = 'cuttingboard';
const SITE = `https://${APP}.azurewebsites.net`;
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const plan = process.argv.includes('--plan');
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

/** Run a command, inheriting the console unless `capture`; throw if it exits non-zero. */
function run(cmd, args, { capture = false, cwd = root } = {}) {
  const r = spawnSync(cmd, args, { cwd, shell: process.platform === 'win32', encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} exited with ${r.status}${capture ? `: ${(r.stderr || '').trim().slice(-400)}` : ''}`);
  return capture ? r.stdout.trim() : '';
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full).map((f) => `${name}/${f}`) : [name];
  });
}

/** SHA-256 of some bytes, in hex. */
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Check that the site serves every file in `dist/` byte for byte. A deploy can report success and
 * still serve the old files while the App Service restarts, so retry for about a minute.
 */
async function verify() {
  const local = files(dist).map((f) => [f, sha(readFileSync(join(dist, ...f.split('/'))))]);
  for (let attempt = 1; ; attempt++) {
    const bad = [];
    for (const [f, hash] of local) {
      try {
        const res = await fetch(`${SITE}/${f}?v=${Date.now()}`, { cache: 'no-store' });
        const got = res.ok ? sha(Buffer.from(await res.arrayBuffer())) : `HTTP ${res.status}`;
        if (got !== hash) bad.push(`${f} (${got.startsWith('HTTP') ? got : 'different bytes'})`);
      } catch (err) {
        bad.push(`${f} (${err.message})`);
      }
    }
    if (!bad.length) return console.log(`  all ${local.length} files match the build`);
    if (attempt === 12) throw new Error(`${SITE} does not match the build: ${bad.join(', ')}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Build, zip, deploy and verify, printing a timing report at the end. */
async function main() {
  console.log(`Target: App Service ${APP} in ${GROUP}, ${SITE}`);
  if (plan) {
    console.log('Plan: npm run build; zip dist/; az webapp deploy --type zip --clean true; compare every file with the live site by SHA-256.');
    return;
  }
  await phase('build', () => run('npm', ['run', 'build']));
  const dir = mkdtempSync(join(tmpdir(), 'cutting-boards-'));
  const zip = join(dir, 'dist.zip');
  try {
    // Windows' own tar (bsdtar) writes a zip with -a. Named by full path: Git's GNU tar is often
    // first on the PATH and cannot write zips.
    const tar = process.platform === 'win32' ? `"${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')}"` : 'bsdtar';
    await phase('zip', () => run(tar, ['-a', '-c', '-f', `"${zip}"`, '*'], { cwd: dist }));
    await phase('deploy', () =>
      run('az', ['webapp', 'deploy', '-n', APP, '-g', GROUP, '--src-path', `"${zip}"`, '--type', 'zip', '--clean', 'true', '--restart', 'true']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await phase('verify', verify);
  console.log(`Deployed: ${SITE}`);
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
