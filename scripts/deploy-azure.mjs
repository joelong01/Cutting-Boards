#!/usr/bin/env node
/**
 * Run every check, and only if they all pass, publish the web version of Cutting Boards to the
 * Azure Static Web App `cuttingboard` (resource group `rg-cutting-boards`, Free plan), then check
 * that the live site serves exactly the files just built, by hash. A failing test or window
 * check stops it before anything is uploaded.
 *
 *   node scripts/deploy-azure.mjs                 test, build, deploy, verify
 *   node scripts/deploy-azure.mjs --bump=patch    the same, moving the version on first
 *   node scripts/deploy-azure.mjs --plan          say what it would do, change nothing
 *
 * The version is the one in package.json, which the About box shows. A deploy that changes what
 * people get moves it on, by how big the change is:
 *
 *   --bump=patch   a fix: something that was wrong now works (0.9 to 0.9.1)
 *   --bump=minor   something new: a design, a step, a setting, a tile (0.9 to 0.10)
 *   --bump=major   a break: saved designs open differently or not at all (0.9 to 1.0)
 *
 * Without --bump the version stays as it is, which is right for putting the same thing up again.
 * The bump is made before the checks, so the page that is tested and built carries the new
 * number; it is an edit to package.json and package-lock.json, to commit with the change.
 *
 * Needs the Azure CLI signed in (`az login`). The site is only files: `dist/` as built, uploaded
 * with Microsoft's Static Web Apps tool (`swa`, a development dependency). No server of ours
 * runs. `public/staticwebapp.config.json`, which the build copies into `dist/`, tells the host to
 * make phones re-check the page on every visit and to keep the hashed files under `assets/` for
 * a year; without the first, a phone keeps showing an old page after a deploy.
 *
 * The deployment token is read from Azure at deploy time, handed to the upload in its
 * environment, and never printed or written anywhere.
 *
 * The web version keeps designs in the browser's storage, not in files: it is for showing a
 * board (on a phone, say), not for keeping designs.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUP = 'rg-cutting-boards';
const APP = 'cuttingboard';
/** The host's own settings file. It is uploaded with the site and acted on, not served. */
const HOST_CONFIG = 'staticwebapp.config.json';
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const plan = process.argv.includes('--plan');
/** How far to move the version on before deploying: patch, minor or major, or nothing. */
const bump = process.argv.find((a) => a.startsWith('--bump='))?.slice('--bump='.length) ?? '';
if (bump && !['patch', 'minor', 'major'].includes(bump)) {
  console.error(`--bump takes patch, minor or major, not "${bump}".`);
  process.exit(2);
}
/** The version in package.json as it stands. */
const version = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
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
 * Run a command, inheriting the console unless `capture`; throw if it exits non-zero. `env` adds
 * to the environment the command sees. An error names the command and its first argument only,
 * so nothing passed to it (a token, say) can end up in a message.
 */
function run(cmd, args, { capture = false, cwd = root, env = {} } = {}) {
  const r = spawnSync(cmd, args, { cwd, shell: process.platform === 'win32', encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...env } });
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

/** The site's address, asked of Azure: a Static Web App's host name is given to it, not chosen. */
function siteUrl() {
  const host = run('az', ['staticwebapp', 'show', '-n', APP, '-g', GROUP, '--query', 'defaultHostname', '-o', 'tsv'], { capture: true });
  if (!host) throw new Error(`the Static Web App ${APP} in ${GROUP} has no host name: does it exist?`);
  return `https://${host}`;
}

/**
 * Check that the site serves every file in `dist/` byte for byte, but for the host's settings
 * file, which it keeps to itself. A deploy can report success a little before the new files are
 * the ones served, so retry for about a minute.
 */
async function verify(site) {
  const local = files(dist).filter((f) => f !== HOST_CONFIG).map((f) => [f, sha(readFileSync(join(dist, ...f.split('/'))))]);
  for (let attempt = 1; ; attempt++) {
    const bad = [];
    for (const [f, hash] of local) {
      try {
        const res = await fetch(`${site}/${f}?v=${Date.now()}`, { cache: 'no-store' });
        const got = res.ok ? sha(Buffer.from(await res.arrayBuffer())) : `HTTP ${res.status}`;
        if (got !== hash) bad.push(`${f} (${got.startsWith('HTTP') ? got : 'different bytes'})`);
      } catch (err) {
        bad.push(`${f} (${err.message})`);
      }
    }
    // The page must be re-checked on every visit, or a phone keeps showing an old one.
    if (!bad.length) {
      const cache = (await fetch(`${site}/?v=${Date.now()}`, { cache: 'no-store' })).headers.get('cache-control') ?? '';
      if (cache.includes('no-cache')) return console.log(`  all ${local.length} files match the build; the page is served no-cache`);
      bad.push(`the page is served with Cache-Control "${cache}", not no-cache`);
    }
    if (attempt === 12) throw new Error(`${site} does not match the build: ${bad.join(', ')}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Test and build, then upload and verify, printing a timing report at the end. */
async function main() {
  const site = siteUrl();
  console.log(`Target: Static Web App ${APP} in ${GROUP}, ${site}`);
  console.log(bump ? `Version: ${version()}, to be moved on by a ${bump} bump` : `Version: ${version()}, unchanged (no --bump)`);
  if (plan) {
    console.log('Plan: npm run check (model tests, then build and window checks), stopping on any failure; upload dist/ with swa deploy to the production environment; then fetch every file from the site and compare it with the build by SHA-256.');
    return;
  }
  // The version moves on first, so the page that is tested, built and uploaded carries the new
  // number in its About box. npm writes it to package.json and package-lock.json and makes no commit.
  if (bump) {
    await phase('version', () => run('npm', ['version', bump, '--no-git-tag-version'], { capture: true }));
    console.log(`Version: now ${version()}`);
  }
  // `check` runs the model tests, then builds dist/ and checks the real window against it, so
  // what is uploaded is exactly what was tested. Any failure throws here, before the upload.
  await phase('test and build', () => run('npm', ['run', 'check']));
  await phase('deploy', () => {
    // The token goes to the upload in its environment: not on its command line, not in any output.
    const token = run('az', ['staticwebapp', 'secrets', 'list', '-n', APP, '-g', GROUP, '--query', 'properties.apiKey', '-o', 'tsv'], { capture: true });
    if (!token) throw new Error('Azure gave no deployment token for the Static Web App.');
    run('npx', ['swa', 'deploy', '"./dist"', '--env', 'production', '--no-use-keychain'], { env: { SWA_CLI_DEPLOYMENT_TOKEN: token } });
  });
  await phase('verify', () => verify(site));
  console.log(`Deployed: ${site} (version ${version()})`);
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
