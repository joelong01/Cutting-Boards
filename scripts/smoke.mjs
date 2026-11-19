// Smoke test of the built desktop app: one check for each feature that lives in the window and
// not in src/model, where the unit tests cannot reach it. Each check starts the app in its test
// profile (see TEST_RUN in electron/main.cts), runs one expression in the page and judges the
// answer. Run `npm run smoke`, which builds first. Exits 1 if any check fails.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Start the app with the given arguments and return its exit code and everything it printed. */
function launch(args) {
  const r = spawnSync(process.execPath, ['scripts/run.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Open the page with a query string, evaluate an expression in it, and return the value, or throw with what the app printed. */
function probe(query, expression, wait = 2500) {
  const { out } = launch([`--query=${query}`, `--eval=${expression}`, `--wait=${wait}`]);
  const line = out.split(/\r?\n/).find((l) => l.startsWith('eval '));
  if (!line) throw new Error(`no answer from the page:\n${out.slice(-600)}`);
  return JSON.parse(line.slice(5));
}

/** An expression that resolves, after `ms`, to the value of `after`: for checks that click something first. */
const later = (before, after, ms = 500) =>
  `(async () => { ${before}; await new Promise((r) => setTimeout(r, ${ms})); return ${after}; })()`;

// The brick starter design has these stages: 0 first glue-up, 1 flatten, 2 trim, 3 cross cut,
// 4 turn, 5 offset, 6 glue up, 7 trim, 8 flatten, 9 finish.
const checks = [
  ['save, list, open and delete a design file, and refuse a path outside the designs folder', () => {
    const { code, out } = launch(['--selftest']);
    if (code !== 0) throw new Error(out.slice(-400));
  }],
  ['the window is titled Cutting Boards and draws the board in 3D', () => {
    const r = probe('preset=brick', `({ title: document.title, frames: window.boardScene.renderer.info.render.frame, tris: window.boardScene.renderer.info.render.triangles })`);
    if (r.title !== 'Cutting Boards' || !(r.frames > 5) || !(r.tris > 100)) throw new Error(JSON.stringify(r));
  }],
  ['the finished board is shown first, with no "later steps" notice and no edge tags', () => {
    const r = probe('preset=brick', `({ notice: !!document.querySelector('.not-final'), tags: window.boardScene.tagGroup.visible, heading: document.querySelector('.overlay.info strong').textContent })`);
    if (r.notice || r.tags || !/Finish/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['a Trim step tags the four sides, and Show finished board goes back to the end', () => {
    const r = probe('preset=brick&stage=7', later(
      `const before = { tags: window.boardScene.tagGroup.visible, notice: document.querySelector('.not-final')?.textContent ?? '' }; document.querySelector('.not-final button').click()`,
      `({ before, tags: window.boardScene.tagGroup.visible, notice: !!document.querySelector('.not-final'), heading: document.querySelector('.overlay.info strong').textContent })`));
    if (!r.before.tags || !/step 8 of 10/.test(r.before.notice) || r.tags || r.notice || !/Finish/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['a step that is not a Trim has the notice but no edge tags', () => {
    const r = probe('preset=brick&stage=8', `({ tags: window.boardScene.tagGroup.visible, notice: !!document.querySelector('.not-final') })`);
    if (r.tags || !r.notice) throw new Error(JSON.stringify(r));
  }],
  ['Add a step is on screen without scrolling and adds after the selected step', () => {
    const r = probe('preset=brick&stage=5', later(
      `const bar = document.querySelector('.add-step'); const box = bar.getBoundingClientRect(); const title = bar.querySelector('span').textContent; const cards = () => [...document.querySelectorAll('.step strong, .step-card strong, .steps strong')].length; const n = document.querySelectorAll('.overlay.stepper i').length; [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Insert accent strips').click()`,
      `({ title, visible: box.top >= 0 && box.bottom <= window.innerHeight + 1, before: n, after: document.querySelectorAll('.overlay.stepper i').length, heading: document.querySelector('.overlay.info strong').textContent })`));
    if (!/after 6\. Offset/i.test(r.title) || !r.visible || r.after !== r.before + 1 || !/7\. Insert accent strips/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['the splitter is there and the side panel has a width between its limits', () => {
    const r = probe('preset=brick', `({ splitter: !!document.querySelector('.splitter'), side: Math.round(document.querySelector('.splitter').getBoundingClientRect().left), width: window.innerWidth })`);
    if (!r.splitter || r.side < 200 || r.side > r.width - 200) throw new Error(JSON.stringify(r));
  }],
  ['the Cut list and steps tab lists stock and numbered instructions', () => {
    const r = probe('preset=maple-purpleheart&tab=cutlist', `({ text: document.querySelector('.cutlist').innerText })`);
    if (!/Hard maple/.test(r.text) || !/Purpleheart/.test(r.text) || !/Finish/.test(r.text) || !/board feet|bd ft|bf/i.test(r.text)) throw new Error(r.text.slice(0, 400));
  }],
  ['print preview shows the sheet with its Print and Save as PDF buttons', () => {
    const r = probe('preset=brick&preview', `({ bar: document.querySelector('.preview-bar')?.innerText ?? '', sheet: document.querySelector('.print-sheet')?.innerText ?? '' })`);
    if (!/Print/.test(r.bar) || !/Save as PDF/.test(r.bar) || /Open as PDF/.test(r.bar)) throw new Error(JSON.stringify(r.bar));
    if (!/Teak/.test(r.sheet) || !/Cross cut/.test(r.sheet)) throw new Error(r.sheet.slice(0, 300));
  }],
  ['Save as PDF writes a real PDF of the sheet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cutting-boards-smoke-'));
    try {
      /** Write the sheet for a query to a PDF and return its bytes as text. */
      const pdf = (name, query, wait) => {
        const file = join(dir, name);
        const { out } = launch([`--query=${query}`, `--pdf=${file}`, `--wait=${wait}`]);
        if (!existsSync(file)) throw new Error(`no PDF written:\n${out.slice(-400)}`);
        return readFileSync(file, 'latin1');
      };
      const plain = pdf('plain.pdf', 'preset=brick&preview', 2500);
      const pages = (plain.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      if (!plain.startsWith('%PDF-') || !/%%EOF\s*$/.test(plain) || pages < 1 || plain.length < 5000) {
        throw new Error(`not a sound PDF: ${plain.length} bytes, ${pages} pages`);
      }
      // The sheet is text, not a picture of the window: it carries fonts and no full-page image.
      if (!/\/Font/.test(plain)) throw new Error('the PDF has no text in it');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }],
  ['the board wizard offers its sizes as a single-select list', () => {
    const r = probe('wizard', later(
      `const radios = () => [...document.querySelectorAll('.wizard-sizes [role=radio]')]; radios()[2].click()`,
      `({ count: radios().length, checked: radios().map((b) => b.getAttribute('aria-checked')) })`));
    if (r.count < 3 || r.checked.filter((c) => c === 'true').length !== 1 || r.checked[2] !== 'true') throw new Error(JSON.stringify(r));
  }],
  ['the board wizard shows end-grain examples, each with a picture', () => {
    const r = probe('wizard=end', `({ pictures: [...document.querySelectorAll('.wizard-examples img')].filter((i) => i.src.startsWith('data:image/png')).length })`, 7000);
    if (r.pictures < 4) throw new Error(JSON.stringify(r));
  }],
  ['the app icon files exist', () => {
    const missing = ['assets/icon.ico', 'assets/icon.png', 'public/icon.png'].filter((f) => !existsSync(join(root, f)));
    if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(e instanceof Error ? e.message : e).replace(/\n/g, '\n      ')}`);
  }
}
console.log(`${checks.length - failed} of ${checks.length} smoke checks passed`);
process.exit(failed ? 1 : 0);
