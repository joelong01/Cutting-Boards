// Smoke test of the built desktop app: one check for each feature that lives in the window and
// not in src/model, where the unit tests cannot reach it. Each check starts the app in its test
// profile (see TEST_RUN in electron/main.cts), runs one expression in the page and judges the
// answer. Run `npm run smoke`, which builds first. Exits 1 if any check fails.
//
// Two things keep it quick. The checks run several at a time, each launch in a profile of its own
// so they cannot disturb one another. And no launch waits a fixed time: it is given a `ready`
// expression and looks the moment that turns true (`--ready` in electron/main.cts).
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let launches = 0;

/** Start the app with the given arguments, in a test profile no other launch is using, and resolve to its exit code and everything it printed. */
function launch(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/run.mjs', `--profile=smoke-${launches++}`, ...args], { cwd: root });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 60000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** True in the page once the design is on screen and the 3D view has drawn a few frames. */
const DRAWN = `!!window.boardScene && window.boardScene.renderer.info.render.frame > 5 && !!document.querySelector('.overlay.info strong')`;

/**
 * Open the page with a query string, wait until `ready` is true in it, evaluate an expression,
 * and return the value, or throw with what the app printed.
 */
async function probe(query, expression, ready = DRAWN) {
  const { out } = await launch([`--query=${query}`, `--eval=${expression}`, `--ready=${ready}`]);
  const line = out.split(/\r?\n/).find((l) => l.startsWith('eval '));
  if (!line) throw new Error(`no answer from the page:\n${out.slice(-600)}`);
  return JSON.parse(line.slice(5));
}

/** An expression that resolves, after `ms`, to the value of `after`: for checks that click something first. */
const later = (before, after, ms = 300) =>
  `(async () => { ${before}; await new Promise((r) => setTimeout(r, ${ms})); return ${after}; })()`;

/** True once the wizard dialog is open. */
const WIZARD = `!!document.querySelector('.modal')`;
/** True once the wizard has drawn at least n example pictures. */
const examples = (n) => `document.querySelectorAll('.wizard-examples img').length >= ${n}`;
/** True once the illustrated sheet has a picture for each of the brick board's ten stages. */
const ALL_PICTURES = `document.querySelectorAll('.print-steps img').length >= 10`;

// The brick starter design has these stages: 0 first glue-up, 1 flatten, 2 trim, 3 cross cut,
// 4 turn, 5 offset, 6 glue up, 7 trim, 8 flatten, 9 finish.
const checks = [
  ['save, list, open and delete a design file, and refuse a path outside the designs folder', async () => {
    const { code, out } = await launch(['--selftest']);
    if (code !== 0) throw new Error(out.slice(-400));
  }],
  ['the window is titled Cutting Boards and draws the board in 3D', async () => {
    const r = await probe('preset=brick', `({ title: document.title, frames: window.boardScene.renderer.info.render.frame, tris: window.boardScene.renderer.info.render.triangles })`);
    if (r.title !== 'Cutting Boards' || !(r.frames > 5) || !(r.tris > 100)) throw new Error(JSON.stringify(r));
  }],
  ['the finished board is shown first, with no "later steps" notice and no edge tags', async () => {
    const r = await probe('preset=brick', `({ notice: !!document.querySelector('.not-final'), tags: window.boardScene.tagGroup.visible, heading: document.querySelector('.overlay.info strong').textContent })`);
    if (r.notice || r.tags || !/Finish/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['a Trim step tags the four sides, and Show finished board goes back to the end', async () => {
    const r = await probe('preset=brick&stage=7', later(
      `const before = { tags: window.boardScene.tagGroup.visible, notice: document.querySelector('.not-final')?.textContent ?? '' }; document.querySelector('.not-final button').click()`,
      `({ before, tags: window.boardScene.tagGroup.visible, notice: !!document.querySelector('.not-final'), heading: document.querySelector('.overlay.info strong').textContent })`));
    if (!r.before.tags || !/step 8 of 10/.test(r.before.notice) || r.tags || r.notice || !/Finish/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['a step that is not a Trim has the notice but no edge tags', async () => {
    const r = await probe('preset=brick&stage=8', `({ tags: window.boardScene.tagGroup.visible, notice: !!document.querySelector('.not-final') })`);
    if (r.tags || !r.notice) throw new Error(JSON.stringify(r));
  }],
  ['Add a step is on screen without scrolling and adds after the selected step', async () => {
    const r = await probe('preset=brick&stage=5', later(
      `const bar = document.querySelector('.add-step'); const box = bar.getBoundingClientRect(); const title = bar.querySelector('span').textContent; const cards = () => [...document.querySelectorAll('.step strong, .step-card strong, .steps strong')].length; const n = document.querySelectorAll('.overlay.stepper i').length; [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Insert accent strips').click()`,
      `({ title, visible: box.top >= 0 && box.bottom <= window.innerHeight + 1, before: n, after: document.querySelectorAll('.overlay.stepper i').length, heading: document.querySelector('.overlay.info strong').textContent })`));
    if (!/after 6\. Offset/i.test(r.title) || !r.visible || r.after !== r.before + 1 || !/7\. Insert accent strips/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['the splitter is there and the side panel has a width between its limits', async () => {
    const r = await probe('preset=brick', `({ splitter: !!document.querySelector('.splitter'), side: Math.round(document.querySelector('.splitter').getBoundingClientRect().left), width: window.innerWidth })`);
    if (!r.splitter || r.side < 200 || r.side > r.width - 200) throw new Error(JSON.stringify(r));
  }],
  ['the Cut list and steps tab lists stock and numbered instructions', async () => {
    const r = await probe('preset=maple-purpleheart&tab=cutlist', `({ text: document.querySelector('.cutlist').innerText })`);
    if (!/Hard maple/.test(r.text) || !/Purpleheart/.test(r.text) || !/Finish/.test(r.text) || !/board feet|bd ft|bf/i.test(r.text)) throw new Error(r.text.slice(0, 400));
  }],
  ['print preview shows the sheet with its Print and Save as PDF buttons', async () => {
    const r = await probe('preset=brick&preview', `({ bar: document.querySelector('.preview-bar')?.innerText ?? '', sheet: document.querySelector('.print-sheet')?.innerText ?? '' })`);
    if (!/Print/.test(r.bar) || !/Save as PDF/.test(r.bar) || /Open as PDF/.test(r.bar)) throw new Error(JSON.stringify(r.bar));
    if (!/Teak/.test(r.sheet) || !/Cross cut/.test(r.sheet)) throw new Error(r.sheet.slice(0, 300));
  }],
  ['Save as PDF writes a real PDF of the sheet, and with pictures on it shows every step', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cutting-boards-smoke-'));
    try {
      /** Write the sheet for a query to a PDF and return its bytes as text. */
      const pdf = async (name, query, ready) => {
        const file = join(dir, name);
        const { out } = await launch([`--query=${query}`, `--pdf=${file}`, `--ready=${ready}`]);
        if (!existsSync(file)) throw new Error(`no PDF written:\n${out.slice(-400)}`);
        return readFileSync(file, 'latin1');
      };
      const [plain, illustrated] = await Promise.all([
        pdf('plain.pdf', 'preset=brick&preview', DRAWN),
        pdf('pictures.pdf', 'preset=brick&preview&pictures', ALL_PICTURES),
      ]);
      const pages = (plain.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      if (!plain.startsWith('%PDF-') || !/%%EOF\s*$/.test(plain) || pages < 1 || plain.length < 5000) {
        throw new Error(`not a sound PDF: ${plain.length} bytes, ${pages} pages`);
      }
      // The sheet is text, not a picture of the window: it carries fonts and no images.
      const images = (text) => (text.match(/\/Subtype\s*\/Image/g) ?? []).length;
      if (!/\/Font/.test(plain) || images(plain) !== 0) throw new Error(`plain sheet: fonts ${/\/Font/.test(plain)}, images ${images(plain)}`);
      // With pictures: one for each of the brick board's ten stages, on more paper.
      const morePages = (illustrated.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      if (!illustrated.startsWith('%PDF-') || images(illustrated) < 10 || morePages <= pages) {
        throw new Error(`illustrated sheet: ${images(illustrated)} images on ${morePages} pages (plain has ${pages})`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }],
  ['Export offers a PDF, a PDF with a picture of each step, and the design file', async () => {
    const r = await probe('preset=brick', later(`[...document.querySelectorAll('.top button')].find((b) => b.textContent.startsWith('Export')).click()`,
      `({ items: [...document.querySelectorAll('.export-menu strong')].map((e) => e.textContent) })`));
    if (r.items.length !== 3 || !/^PDF: cut list/.test(r.items[0]) || !/picture of each step/.test(r.items[1]) || !/Design file/.test(r.items[2])) throw new Error(JSON.stringify(r));
  }],
  ['the illustrated sheet puts each step picture beside its instruction', async () => {
    const r = await probe('preset=brick&preview&pictures', `({ steps: [...document.querySelectorAll('.print-steps figure')].map((f) => ({ picture: !!f.querySelector('img')?.src.startsWith('data:image/png'), text: f.querySelector('figcaption').innerText })), plainList: !!document.querySelector('.print-sheet .cutlist ol') })`, ALL_PICTURES);
    const ok = r.steps.length === 10 && r.steps.every((s) => s.picture) && !r.plainList
      && /4\. Cross cut/.test(r.steps[3].text) && /13 slices/.test(r.steps[3].text) && /10\. Finish/.test(r.steps[9].text);
    if (!ok) throw new Error(JSON.stringify(r).slice(0, 700));
  }],
  ['the board wizard offers its sizes as a single-select list', async () => {
    const r = await probe('wizard', later(
      `const radios = () => [...document.querySelectorAll('.wizard-sizes [role=radio]')]; radios()[2].click()`,
      `({ count: radios().length, checked: radios().map((b) => b.getAttribute('aria-checked')) })`), WIZARD);
    if (r.count < 3 || r.checked.filter((c) => c === 'true').length !== 1 || r.checked[2] !== 'true') throw new Error(JSON.stringify(r));
  }],
  ['the board wizard shows end-grain examples, each with a picture', async () => {
    const r = await probe('wizard=end', `({ pictures: [...document.querySelectorAll('.wizard-examples img')].filter((i) => i.src.startsWith('data:image/png')).length })`, examples(4));
    if (r.pictures < 4) throw new Error(JSON.stringify(r));
  }],
  ['the board wizard offers Chess board as a type', async () => {
    const r = await probe('wizard', later(`document.querySelector('.modal footer button').click()`, `({ types: [...document.querySelectorAll('.wizard-types strong')].map((e) => e.textContent) })`), WIZARD);
    if (r.types.join('|') !== 'End grain|Edge grain|Chess board') throw new Error(JSON.stringify(r));
  }],
  ['the chess board page asks for two woods and a square, and draws both ways to build it', async () => {
    const r = await probe('wizard=chess', `({ woods: document.querySelectorAll('.wizard-chess select').length, fields: [...document.querySelectorAll('.wizard-chess .field > span:first-child')].map((e) => e.textContent), cards: [...document.querySelectorAll('.wizard-examples button')].map((b) => ({ label: b.querySelector('strong').textContent, size: b.querySelector('small').textContent, picture: !!b.querySelector('img')?.src.startsWith('data:image/png') })) })`, examples(2));
    const ok = r.woods === 2 && r.fields.includes('Square') && r.cards.length === 2
      && r.cards.every((c) => c.picture && /16″ × 16″/.test(c.size)) && /End-grain/.test(r.cards[0].label) && /Face-grain/.test(r.cards[1].label);
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['picking a chess board opens it: 64 blocks, named for its woods', async () => {
    const r = await probe('wizard=chess', later(`document.querySelector('.wizard-examples button').click()`,
      `({ wizard: !!document.querySelector('.modal'), name: document.querySelector('input[title^=\\'Design name\\']').value, info: document.querySelector('.overlay.info').innerText })`, 600), examples(2));
    if (r.wizard || r.name !== 'Black walnut and hard maple chess board' || !/16″ × 16″/.test(r.info)) throw new Error(JSON.stringify(r));
  }],
  ['the app icon files exist', async () => {
    const missing = ['assets/icon.ico', 'assets/icon.png', 'public/icon.png'].filter((f) => !existsSync(join(root, f)));
    if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
  }],
];

// Run the checks a few at a time and print the results in the order they are listed.
const results = new Array(checks.length);
let next = 0;
/** Take checks off the list until none are left, recording each one's failure message or null. */
async function worker() {
  while (next < checks.length) {
    const i = next++;
    try {
      await checks[i][1]();
      results[i] = null;
    } catch (e) {
      results[i] = String(e instanceof Error ? e.message : e);
    }
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: Math.min(6, Math.max(2, availableParallelism() - 2)) }, worker));

let failed = 0;
checks.forEach(([name], i) => {
  if (results[i] === null) console.log(`ok    ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}\n      ${results[i].replace(/\n/g, '\n      ')}`);
  }
});
console.log(`${checks.length - failed} of ${checks.length} smoke checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
