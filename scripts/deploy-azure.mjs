#!/usr/bin/env node
/**
 * Run every check, and only if they all pass, publish the web version of Cutting Boards to the
 * Azure App Service `cuttingboard` (resource group `rg-cutting-boards`),
 * https://cuttingboard.azurewebsites.net, then check that the live site serves exactly the files
 * just built, by hash. A failing test or window check stops it before anything is uploaded.
 *
 *   node scripts/deploy-azure.mjs          test, build, deploy, verify
 *   node scripts/deploy-azure.mjs --plan   say what it would do, change nothing
 *
 * Needs the Azure CLI signed in (`az login`). The site gets a zip of `dist/` plus
 * `scripts/azure-server.cjs` as `server.cjs`, with the old files cleaned out, and the App Service
 * is set to start that server. It tells phones to re-check the page on every visit (`pm2 serve`
 * sent no caching header, so phones kept showing an old page after a deploy).
 *
 * The web version keeps designs in the browser's storage, not in files: it is for showing a
 * board (on a phone, say), not for keeping designs.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUP = 'rg-cutting-boards';
const APP = 'cuttingboard';
const SITE = `https://${APP}.azurewebsites.net`;
/** How the App Service starts the site: the zero-dependency server shipped beside the page. */
const STARTUP = 'node /home/site/wwwroot/server.cjs';
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
    // The page must be re-checked on every visit, or a phone keeps showing an old one.
    if (!bad.length) {
      const cache = (await fetch(`${SITE}/?v=${Date.now()}`, { cache: 'no-store' })).headers.get('cache-control') ?? '';
      if (cache.includes('no-cache')) return console.log(`  all ${local.length} files match the build; the page is served no-cache`);
      bad.push(`the page is served with Cache-Control "${cache}", not no-cache`);
    }
    if (attempt === 12) throw new Error(`${SITE} does not match the build: ${bad.join(', ')}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Test and build, then zip, deploy and verify, printing a timing report at the end. */
async function main() {
  console.log(`Target: App Service ${APP} in ${GROUP}, ${SITE}`);
  if (plan) {
    console.log('Plan: npm run check (model tests, then build and window checks), stopping on any failure; zip dist/ with server.cjs; set the startup command if it differs; az webapp deploy --type zip --clean true; compare every file with the live site by SHA-256.');
    return;
  }
  // `check` runs the model tests, then builds dist/ and checks the real window against it, so
  // what is uploaded is exactly what was tested. Any failure throws here, before the upload.
  await phase('test and build', () => run('npm', ['run', 'check']));
  const dir = mkdtempSync(join(tmpdir(), 'cutting-boards-'));
  const zip = join(dir, 'dist.zip');
  const site = join(dir, 'site');
  try {
    cpSync(dist, site, { recursive: true });
    copyFileSync(join(root, 'scripts', 'azure-server.cjs'), join(site, 'server.cjs'));
    // Windows' own tar (bsdtar) writes a zip with -a. Named by full path: Git's GNU tar is often
    // first on the PATH and cannot write zips.
    const tar = process.platform === 'win32' ? `"${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')}"` : 'bsdtar';
    await phase('zip', () => run(tar, ['-a', '-c', '-f', `"${zip}"`, '*'], { cwd: site }));
    // Point the App Service at the server once; later deploys find it already set.
    await phase('startup', () => {
      const now = run('az', ['webapp', 'config', 'show', '-n', APP, '-g', GROUP, '--query', 'appCommandLine', '-o', 'tsv'], { capture: true });
      if (now === STARTUP) return;
      run('az', ['webapp', 'config', 'set', '-n', APP, '-g', GROUP, '--startup-file', `"${STARTUP}"`, '-o', 'none']);
      const after = run('az', ['webapp', 'config', 'show', '-n', APP, '-g', GROUP, '--query', 'appCommandLine', '-o', 'tsv'], { capture: true });
      if (after !== STARTUP) throw new Error(`startup command is "${after}", not "${STARTUP}"`);
      console.log(`  startup command was "${now}", now "${STARTUP}"`);
    });
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
