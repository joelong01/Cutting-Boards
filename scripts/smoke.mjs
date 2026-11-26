// Smoke test of the built desktop app: one check for each feature that lives in the window and
// not in src/model, where the unit tests cannot reach it. Each check starts the app in its test
// profile (see TEST_RUN in electron/main.cts), runs one expression in the page and judges the
// answer. Run `npm run smoke`, which builds first. Exits 1 if any check fails.
//
// Two things keep it quick. The checks run several at a time, each launch in a profile of its own
// so they cannot disturb one another. And no launch waits a fixed time: it is given a `ready`
// expression and looks the moment that turns true (`--ready` in electron/main.cts).
import { spawn, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let launches = 0;
/** The launches still running, so none is left behind when the run ends or is interrupted. */
const running = new Set();

/** End a launch and the app it started. On Windows a plain kill would stop the launcher and leave the app running. */
function stop(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

/** Leave nothing behind: stop any launch still running and delete every test profile folder, including ones from earlier runs. */
function cleanUp() {
  for (const child of running) stop(child);
  running.clear();
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('cutting-boards-test-smoke-')) continue;
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Still held by an app that is closing; the next run removes it.
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanUp();
    process.exit(1);
  });
}

/** Start the app, whose window a test run keeps off every screen, with the given arguments, in a test profile no other launch is using, and resolve to its exit code and everything it printed. */
function launch(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/run.mjs', `--profile=smoke-${launches++}`, ...args], { cwd: root });
    running.add(child);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => stop(child), 60000);
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(child);
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
  ['the window is titled with the design name and Cutting Boards, and draws the board in 3D', async () => {
    const r = await probe('preset=brick', `({ title: document.title, frames: window.boardScene.renderer.info.render.frame, tris: window.boardScene.renderer.info.render.triangles })`);
    if (r.title !== 'Teak brick - Cutting Boards' || !(r.frames > 5) || !(r.tris > 100)) throw new Error(JSON.stringify(r));
  }],
  ['the finished board is shown first, with no "later steps" notice and no edge tags', async () => {
    const r = await probe('preset=brick', `({ notice: !!document.querySelector('.not-final'), tags: window.boardScene.tagGroup.visible, heading: document.querySelector('.overlay.info strong').textContent })`);
    if (r.notice || r.tags || !/Sand and oil/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['a Trim step tags the four sides, and Show finished board goes back to the end', async () => {
    const r = await probe('preset=brick&stage=8', later(
      `const before = { tags: window.boardScene.tagGroup.visible, notice: document.querySelector('.not-final')?.textContent ?? '' }; document.querySelector('.not-final button').click()`,
      `({ before, tags: window.boardScene.tagGroup.visible, notice: !!document.querySelector('.not-final'), heading: document.querySelector('.overlay.info strong').textContent })`));
    if (!r.before.tags || !/step 9 of 15/.test(r.before.notice) || r.tags || r.notice || !/Sand and oil/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['going into the chamfer size shows the chamfer step, from the finished board or from an earlier step', async () => {
    const into = `[...document.querySelectorAll('.step.touch .field')].find((f) => f.querySelector('span')?.textContent === 'Chamfer').querySelector('input').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`;
    const seen = `({ heading: document.querySelector('.overlay.info strong').textContent, notice: !!document.querySelector('.not-final') })`;
    const end = await probe('preset=brick', later(into, seen));
    const early = await probe('preset=brick&stage=2', later(`const before = ${seen}; ${into}`, `({ before, after: ${seen} })`));
    if (!/Chamfer the bottom edges/.test(end.heading) || !/Flatten/.test(early.before.heading) || !/Chamfer the bottom edges/.test(early.after.heading)) throw new Error(JSON.stringify({ end, early }));
  }],
  ['a tile is selected by a click anywhere in it: its title, the space round its fields, a label, or a field, which also takes the focus', async () => {
    const card = `const card = (t) => [...document.querySelectorAll('.steps .step.touch')].find((c) => c.querySelector('strong').textContent === t); const info = () => document.querySelector('.overlay.info strong').textContent; const hit = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));`;
    const r = await probe('preset=brick', later(
      `${card} const seen = {}; const step = (t) => [...document.querySelectorAll('.steps .step:not(.touch)')].find((c) => c.querySelector('strong').textContent === t); hit(card('Juice groove').querySelector('header > strong')); setTimeout(() => { seen.title = info(); hit(card('Chamfer the bottom edges').querySelector('.params')); }, 300); setTimeout(() => { seen.space = info(); const field = card('Juice groove').querySelector('.params .field input'); field.focus(); hit(field); }, 600); setTimeout(() => { seen.field = info(); seen.focused = document.activeElement === card('Juice groove').querySelector('.params .field input'); hit(card('Round over the top edges').querySelector('.params .field span')); }, 900); setTimeout(() => { seen.label = info(); hit(step('Cross cut').querySelector('.params .field span, .params label span')); }, 1200); setTimeout(() => { seen.stepLabel = info(); hit(document.querySelector('.step.first .note')); }, 1500)`,
      `({ ...seen, first: info(), ticked: card('Juice groove').querySelector('input').checked })`, 1900));
    if (!/14\. Juice groove/.test(r.title) || !/Chamfer the bottom edges/.test(r.space) || !/Juice groove/.test(r.field) || !r.focused || !/Round over the top edges/.test(r.label)
      || !/Cross cut/.test(r.stepLabel) || !/^1\. Rip the strips/.test(r.first) || !r.ticked) throw new Error(JSON.stringify(r));
  }],
  ['ticking Juice groove template adds a step before the groove that draws the template on the board and says how to make it', async () => {
    const r = await probe('preset=brick', later(
      `const card = (t) => [...document.querySelectorAll('.steps .step.touch')].find((c) => c.querySelector('strong').textContent === t); const titles = () => [...document.querySelectorAll('.steps .step.touch')].map((c) => (c.querySelector('em')?.textContent ?? '-') + ' ' + c.querySelector('strong').textContent); const before = titles(); const drawn = () => Math.max(...window.boardScene.shown.nodes.map((n) => { const g = n.mesh.geometry; g.computeBoundingBox(); return g.boundingBox.max.y - g.boundingBox.min.y; })); const plain = drawn(); card('Juice groove template').querySelector('input').click(); setTimeout(() => card('Juice groove template').querySelector('header > strong').dispatchEvent(new MouseEvent('click', { bubbles: true })), 300)`,
      `({ before, after: titles(), heading: document.querySelector('.overlay.info strong').textContent, caption: document.querySelector('.overlay.caption').textContent, fields: [...card('Juice groove template').querySelectorAll('.field > span:first-child')].map((e) => e.textContent), plain, drawn: drawn() })`, 1500));
    const ok = r.before.includes('- Juice groove template') && r.after.includes('14 Juice groove template') && r.after.includes('15 Juice groove')
      && /14\. Juice groove template/.test(r.heading) && /^Make a template for the router to rest on and run round: a frame/.test(r.caption) && /bearing runs along that outside edge/.test(r.caption)
      && r.fields.join() === 'Strip width,Thickness' && Math.abs(r.drawn - r.plain - 0.5) < 1e-3;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['a step that is not a Trim has the notice but no edge tags', async () => {
    const r = await probe('preset=brick&stage=9', `({ tags: window.boardScene.tagGroup.visible, notice: !!document.querySelector('.not-final') })`);
    if (r.tags || !r.notice) throw new Error(JSON.stringify(r));
  }],
  ['Add step is in the toolbar: its menu says where the step will go, adds it after the selected step, and shows the new step\'s result', async () => {
    const r = await probe('preset=brick&stage=6', later(
      `const pinned = document.querySelectorAll('.add-step').length; [...document.querySelectorAll('.top .rb')].find((b) => b.textContent === 'Add step').click(); await new Promise((r) => setTimeout(r, 200)); const bar = document.querySelector('.add-menu'); const box = bar.getBoundingClientRect(); const title = bar.querySelector('.where').textContent; const off = [...bar.querySelectorAll('button:disabled strong')].map((e) => e.textContent); const n = document.querySelectorAll('.overlay.stepper i').length; [...bar.querySelectorAll('button')].find((b) => b.querySelector('strong').textContent === 'Insert accent strips').click()`,
      `({ title, pinned, off, open: !!document.querySelector('.add-menu'), visible: box.top >= 0 && box.bottom <= window.innerHeight + 1, before: n, after: document.querySelectorAll('.overlay.stepper i').length, heading: document.querySelector('.overlay.info strong').textContent })`));
    if (!/after 7\. Offset/i.test(r.title) || r.pinned || r.open || !r.off.includes('Cross cut') || r.off.includes('Glue up') || !r.visible || r.after !== r.before + 2 || !/9\. Insert accent strips/.test(r.heading)) throw new Error(JSON.stringify(r));
  }],
  ['the target board stays at the top of the side panel when the list is scrolled to the bottom', async () => {
    const r = await probe('preset=brick', later(
      `const side = document.querySelector('.side'); side.scrollTop = side.scrollHeight`,
      `({ scrolled: Math.round(side.scrollTop), top: Math.round(document.querySelector('.card.target').getBoundingClientRect().top - side.getBoundingClientRect().top), size: document.querySelector('.card.target .note').textContent, over: document.elementFromPoint(side.getBoundingClientRect().left + 40, side.getBoundingClientRect().top + 30)?.closest('.card.target') !== null })`));
    if (!(r.scrolled > 100) || r.top !== 10 || !r.over || !/Finishes at/.test(r.size)) throw new Error(JSON.stringify(r));
  }],
  ['the strips card is step 1, "Rip the strips", and selecting it shows the loose strips; gluing them up is step 2', async () => {
    const r = await probe('preset=brick', later(
      `const head = document.querySelector('.step.first header'); const label = head.innerText.replace(/\\s+/g, ' '); const numbers = [...document.querySelectorAll('.side .step header em')].map((e) => e.textContent).join(','); head.click()`,
      `({ label, numbers, second: document.querySelector('.steps .step header').innerText.replace(/\\s+/g, ' '), selected: document.querySelector('.step.first').classList.contains('selected'), heading: document.querySelector('.overlay.info strong').textContent, info: document.querySelector('.overlay.info').innerText, kind: window.boardScene.shown.kind, drawn: window.boardScene.shown.nodes.length })`, 900));
    if (r.label !== '1 Rip the strips' || r.second !== '2 Glue up ↑ ↓ ✕' || r.numbers !== '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15' || !r.selected || r.heading !== '1. Rip the strips' || !/7 loose strips/.test(r.info) || r.kind !== 'strips' || r.drawn !== 7) throw new Error(JSON.stringify(r));
  }],
  ['an accent step takes a second strip: Add strip puts another row in it and another piece in every gap', async () => {
    const r = await probe('preset=maple-purpleheart&stage=5', later(
      `const card = () => [...document.querySelectorAll('.steps .step')].find((c) => c.querySelector('header strong').textContent === 'Insert accent strips'); const rows = () => card().querySelectorAll('.accents .strip-row').length; const before = { rows: rows(), heading: document.querySelector('.overlay.info').innerText }; [...card().querySelectorAll('button')].find((b) => b.textContent === '+ Add strip').click()`,
      `({ before, rows: rows(), note: card().querySelector('.note')?.textContent ?? '', broken: !!document.querySelector('.step.broken'), heading: document.querySelector('.overlay.info').innerText })`, 500));
    // The board is held at its size, so the extra strip changes the count of slices and pieces.
    if (r.before.rows !== 1 || r.rows !== 2 || !/these 2 strips together/.test(r.note) || r.broken || r.heading === r.before.heading) throw new Error(JSON.stringify(r));
  }],
  ['what is added can be removed: a strip with its ✕, and a custom wood with the ✕ on its chip', async () => {
    const r = await probe('preset=maple-purpleheart', later(
      `const rows = () => document.querySelector('.strips').querySelectorAll(':scope > .strip-row').length; const before = rows(); document.querySelector('.strips').querySelectorAll(':scope > .strip-row')[1].querySelector('button[title="Remove"]').click(); const custom = () => document.querySelectorAll('.chips .chip').length; [...document.querySelectorAll('button')].find((b) => b.textContent === '+ Custom wood').click()`,
      `(async () => { const afterStrip = rows(); const name = document.querySelector('.row.custom input[placeholder="Name"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Zebrawood'); name.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); [...document.querySelectorAll('.row.custom button')].find((b) => b.textContent === 'Add').click(); await new Promise((r) => setTimeout(r, 200)); const added = custom(); document.querySelector('.chips .chip button[title="Remove this wood"]').click(); await new Promise((r) => setTimeout(r, 200)); return { before, afterStrip, added, removed: custom() }; })()`));
    if (r.before !== 2 || r.afterStrip !== 1 || r.added !== 1 || r.removed !== 0) throw new Error(JSON.stringify(r));
  }],
  ['the grain switch turns the open end-grain grid to edge grain: the turn step goes and Edge grain is on', async () => {
    const r = await probe('preset=maple-purpleheart', later(
      `const titles = () => [...document.querySelectorAll('.steps .step header strong')].map((t) => t.textContent); const before = titles(); [...document.querySelectorAll('.grain-switch button')].find((b) => b.textContent === 'Edge grain').click()`,
      `({ before, after: titles(), on: document.querySelector('.grain-switch button.on')?.textContent, broken: !!document.querySelector('.step.broken') })`, 1500));
    if (!r.before.includes('Turn to end grain') || r.after.includes('Turn to end grain') || r.on !== 'Edge grain' || r.broken) throw new Error(JSON.stringify(r));
  }],
  ['the panel toggle hides the side panel so the board has the whole width, and the tab on the edge of the board shows it again', async () => {
    const r = await probe('preset=brick', later(
      `localStorage.removeItem('cutting-boards.side-hidden.v1'); document.querySelector('.side-toggle').click()`,
      `(async () => { const hidden = { side: getComputedStyle(document.querySelector('.side')).display, stage: Math.round(document.querySelector('.stage').getBoundingClientRect().width), width: window.innerWidth, canvas: Math.round(document.querySelector('.viewport canvas').getBoundingClientRect().width), handle: document.querySelector('.side-handle')?.getBoundingClientRect().width ?? 0 }; document.querySelector('.side-handle').click(); await new Promise((r) => setTimeout(r, 300)); const shown = getComputedStyle(document.querySelector('.side')).display; localStorage.removeItem('cutting-boards.side-hidden.v1'); return { hidden, shown }; })()`));
    const h = r.hidden;
    if (h.side !== 'none' || h.stage < h.width - 2 || h.canvas < h.width - 2 || h.handle < 30 || r.shown === 'none') throw new Error(JSON.stringify(r));
  }],
  ['at phone width the board comes first, and the shown panel has a bar along the bottom that covers none of its buttons', async () => {
    const expression = later(
      `const start = { side: getComputedStyle(document.querySelector('.side')).display, tab: document.querySelector('.side-handle').innerText.replace(/\\s+/g, ' ') }; document.querySelector('.side-handle').click()`,
      `(() => { const bar = document.querySelector('.side-handle').getBoundingClientRect(); const side = document.querySelector('.side'); return { start, bar: [Math.round(bar.left), Math.round(window.innerHeight - bar.bottom), Math.round(window.innerWidth - bar.right)], text: document.querySelector('.side-handle').innerText.trim(), stage: getComputedStyle(document.querySelector('.stage')).display, pinned: getComputedStyle(document.querySelector('.card.target')).position, room: Math.round(parseFloat(getComputedStyle(side).paddingBottom) - bar.height), icons: [...side.querySelectorAll('.icons button')].filter((b) => { const r = b.getBoundingClientRect(); return r.right > bar.left && r.left < bar.right && r.bottom > bar.top && r.top < bar.bottom && side.scrollTop + side.clientHeight >= side.scrollHeight; }).length }; })()`);
    const { out } = await launch(['--width=400', '--height=820', '--query=preset=brick', `--eval=${expression}`, `--ready=${DRAWN}`]);
    const line = out.split(/\r?\n/).find((l) => l.startsWith('eval '));
    if (!line) throw new Error(out.slice(-600));
    const r = JSON.parse(line.slice(5));
    const ok = r.start.side === 'none' && /Edit/.test(r.start.tab) && r.bar.every((n) => Math.abs(n) <= 1) && /Show the board/.test(r.text)
      && r.stage === 'none' && r.pinned === 'static' && r.room > 0 && r.icons === 0;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['the toolbar has twelve buttons in six named groups, each an icon over its label', async () => {
    const r = await probe('preset=brick', `({ groups: [...document.querySelectorAll('.top .group > small')].map((e) => e.textContent), buttons: [...document.querySelectorAll('.top .rb')].map((b) => { const icon = b.querySelector('svg.icon').getBoundingClientRect(), label = b.querySelector('span').getBoundingClientRect(); return { text: b.textContent, icon: Math.round(icon.width), above: icon.bottom <= label.top + 1 }; }) })`);
    const ok = r.groups.join('|') === 'File|Edit|Steps|Share|View|Help' && r.buttons.map((b) => b.text).join('|') === 'New|Open|Save|Save as|Undo|Redo|Add step|Export|Print|Picture|Hide panel|About'
      && r.buttons.every((b) => b.icon >= 20 && b.above);
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['Save as asks for a name, puts it in the title bar and saves the design under it', async () => {
    const r = await probe('preset=brick', later(
      `[...document.querySelectorAll('.top .rb')].find((b) => b.textContent === 'Save as').click(); await new Promise((r) => setTimeout(r, 150)); const box = document.querySelector('.save-as input'); const offered = box.value; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'Smoke test board'); box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); document.querySelector('.save-as .primary').click()`,
      `(async () => { [...document.querySelectorAll('.top .rb')].find((b) => b.textContent === 'Open').click(); await new Promise((r) => setTimeout(r, 200)); return { offered, title: document.title, open: !!document.querySelector('.save-as'), saved: [...document.querySelectorAll('.dropdown .saved strong')].map((e) => e.textContent) }; })()`, 600));
    if (r.offered !== 'Teak brick' || r.title !== 'Smoke test board - Cutting Boards' || r.open || !r.saved.includes('Smoke test board')) throw new Error(JSON.stringify(r));
  }],
  ['the basket weave lists its second panel as ordinary steps, with the strips editable and a border step', async () => {
    const r = await probe('preset=basket-weave', later(
      `[...document.querySelectorAll('.top .rb')].find((b) => b.textContent === 'Add step').click(); await new Promise((r) => setTimeout(r, 200)); const ADDED = [...document.querySelectorAll('.add-menu button strong')].map((b) => b.textContent); [...document.querySelectorAll('.top .rb')].find((b) => b.textContent === 'Add step').click(); const titles = [...document.querySelectorAll('.side .step header strong')].map((e) => e.textContent); const card = (name) => [...document.querySelectorAll('.steps .step')].find((c) => c.querySelector('header strong').textContent === name); const info = () => document.querySelector('.overlay.info').innerText; const before = info(); const panel = card('Start another panel'); const page = { strips: panel.querySelectorAll('.panel-strip').length, faced: [...panel.querySelectorAll('.faced input[type=checkbox]')].map((c) => c.checked), auto: [...panel.querySelectorAll('label.check')].at(-1).querySelector('input').checked, aside: panel.querySelector('.result').textContent, border: [...card('Add a border').querySelectorAll('.field > span')].map((e) => e.textContent), addable: ADDED }; panel.querySelector('.faced input[type=checkbox]').click()`,
      `({ titles, page, before, after: info(), broken: document.querySelectorAll('.step.broken').length })`, 700));
    const ok = r.titles.join('|') === 'Rip the strips|Glue up|Flatten|Trim|Cross cut|Turn to end grain|Start another panel|Flatten|Trim|Cross cut|Turn to end grain|Interleave the slices|Offset|Glue up|Flatten|Trim|Add a border|Flatten|Round the corners|Chamfer the bottom edges|Round over the top edges|Juice groove template|Juice groove|Sand and oil|Add the feet'
      && r.page.strips === 4 && r.page.faced.join() === 'true,false,false,false' && r.page.auto && /slices set aside/.test(r.page.aside)
      && r.page.border.includes('Border') && r.page.border.includes('Line inside it')
      && ['Start another panel', 'Interleave the slices', 'Add a border'].every((t) => r.page.addable.includes(t)) && r.before !== r.after && r.broken === 0;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['while the second panel is worked, the 3D view draws the slices set aside beside it', async () => {
    const r = await probe('preset=basket-weave&stage=11', `({ heading: document.querySelector('.overlay.info strong').textContent, work: window.boardScene.shown.nodes.length, aside: window.boardScene.shown.aside.length, drawn: window.boardScene.shown.aside.every((n) => n.group.parent === window.boardScene.root), past: window.boardScene.shown.asideZ > window.boardScene.shown.sizeZ })`);
    if (!/^12\. Cross cut/.test(r.heading) || r.aside < 2 || r.work < 1 || !r.drawn || !r.past) throw new Error(JSON.stringify(r));
  }],
  ['typing a corner radius of 3/4 and then 1 redraws the board each time, without Enter or leaving the field', async () => {
    const r = await probe('preset=brick&stage=10', later(
      `const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const field = () => [...document.querySelectorAll('.field')].find((f) => f.querySelector('span')?.textContent === 'Corner radius').querySelector('input'); const caption = () => /to a (.*?) radius/.exec(document.querySelector('.overlay.caption').textContent)?.[1]; const mesh = () => { let sum = 0; for (const node of window.boardScene.shown.nodes) { const p = node.mesh.geometry.attributes.position; for (let i = 0; i < p.count; i++) sum += p.getX(i) + 2 * p.getZ(i); } return Math.round(sum * 100); }; const type = async (v) => { const el = field(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); await wait(1300); return { shown: field().value, caption: caption(), mesh: mesh() }; }; const start = { caption: caption(), mesh: mesh() }; const a = await type('3/4'); const b = await type('1')`,
      `({ start, a, b })`, 50));
    const ok = r.start.caption === '1/2″' && r.a.caption === '3/4″' && r.b.caption === '1″' && r.a.shown === '3/4' && r.b.shown === '1'
      && new Set([r.start.mesh, r.a.mesh, r.b.mesh]).size === 3;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['each finishing touch is a card and a step of its own: ticking one off takes its step out, and selecting one shows that cut alone', async () => {
    const r = await probe('preset=brick', later(
      `const cards = () => [...document.querySelectorAll('.steps .step.touch')].map((c) => ({ title: c.querySelector('strong').textContent, number: c.querySelector('em')?.textContent ?? '', on: c.querySelector('input')?.checked ?? null, fields: [...c.querySelectorAll('.field > span:first-child')].map((e) => e.textContent) })); const dots = () => document.querySelectorAll('.overlay.stepper i').length; const info = () => document.querySelector('.overlay.info strong').textContent; const caption = () => document.querySelector('.overlay.caption').textContent; const card = (t) => [...document.querySelectorAll('.steps .step.touch')].find((c) => c.querySelector('strong').textContent === t); const before = { cards: cards(), dots: dots() }; card('Chamfer the bottom edges').click(); setTimeout(() => { before.chamfer = { info: info(), caption: caption() }; card('Chamfer the bottom edges').querySelector('input').click(); }, 400)`,
      `({ before, after: { cards: cards(), dots: dots() } })`, 1200));
    const b = r.before.cards, a = r.after.cards;
    const ok = b.map((c) => c.title).join('|') === 'Round the corners|Chamfer the bottom edges|Round over the top edges|Juice groove template|Juice groove|Sand and oil|Add the feet'
      && b.map((c) => c.number).join() === '11,12,13,,14,15,' && b.slice(0, 3).every((c) => c.on === true) && b[4].on === true
      && b[0].fields.join() === 'Corner radius' && b[1].fields.join() === 'Chamfer' && b[2].fields.join() === 'Roundover (bit)' && b[3].fields.length === 0 && b[3].on === false && b[4].fields.length === 4 && b[5].fields.length === 0
      && r.before.chamfer.info === '12. Chamfer the bottom edges' && /^Chamfer the bottom edges 1\/4″ at 45°/.test(r.before.chamfer.caption) && !/groove|corners|Sand/.test(r.before.chamfer.caption)
      // Ticked off: the chamfer keeps its card, without a number or fields, and the steps after it move up one.
      && a[1].on === false && a[1].number === '' && a[1].fields.length === 0 && a.map((c) => c.number).join() === '11,,12,,13,14,' && r.after.dots === r.before.dots - 1;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['Rip the panel is a step that can be added after a glue-up, and leaves strips to work as slices', async () => {
    const r = await probe('preset=single-edge-grain&stage=1', later(
      `[...document.querySelectorAll('.top .rb')].find((b) => b.textContent === 'Add step').click(); await new Promise((r) => setTimeout(r, 200)); const bar = document.querySelector('.add-menu'); const button = [...bar.querySelectorAll('button')].find((b) => b.querySelector('strong').textContent === 'Rip the panel'); const enabled = !button.disabled; button.click()`,
      `({ enabled, heading: document.querySelector('.overlay.info strong').textContent, info: document.querySelector('.overlay.info').innerText, caption: document.querySelector('.overlay.caption').textContent, fields: [...document.querySelectorAll('.steps .step.selected .field > span:first-child')].map((e) => e.textContent) })`, 600));
    if (!r.enabled || r.heading !== '3. Rip the panel' || !/8 loose slices/.test(r.info) || !/^Rip the panel lengthways into 8 strips, each 1 1\/4″ wide/.test(r.caption) || r.fields.join() !== 'Strip width,Blade tilt °') throw new Error(JSON.stringify(r));
  }],
  ['with rounding set to Exact a board finishes at exactly the target size: the grid opens at 16 x 12, says what its strips are milled to, and stays on target in edge grain', async () => {
    const r = await probe('preset=maple-purpleheart&rounding=0', later(
      `const note = () => document.querySelector('.card.target .note').textContent; const strips = () => ({ asked: [...document.querySelectorAll('.step.first .strip-row input')].map((i) => i.value).filter((v) => /^[0-9 /.]+$/.test(v)), fit: document.querySelector('.step.first .fit-note')?.textContent ?? '' }); const before = { note: note(), ...strips() }; [...document.querySelectorAll('.grain-switch button')].find((b) => b.textContent === 'Edge grain').click()`,
      `({ before, after: { note: note(), ...strips() }, broken: document.querySelectorAll('.step.broken').length })`, 1800));
    const ok = /Finishes at 16″ × 12″ × 1 1\/8″/.test(r.before.note) && /Finishes at 16″ × 12″ × 1 1\/8″/.test(r.after.note)
      // The widths asked for are still shown; the note gives what the maple is milled to, a little under 1.
      && r.before.asked.includes('1') && r.before.asked.includes('1/8') && /Hard maple 0\.9\d+″ wide/.test(r.before.fit) && /Mill the strips/.test(r.before.fit)
      && /Hard maple 0\.9\d+″ wide/.test(r.after.fit) && r.broken === 0;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['the splitter is there and the side panel has a width between its limits', async () => {
    const r = await probe('preset=brick', `({ splitter: !!document.querySelector('.splitter'), side: Math.round(document.querySelector('.splitter').getBoundingClientRect().left), width: window.innerWidth })`);
    if (!r.splitter || r.side < 200 || r.side > r.width - 200) throw new Error(JSON.stringify(r));
  }],
  ['the Cut list and steps tab lists stock and numbered instructions', async () => {
    const r = await probe('preset=maple-purpleheart&tab=cutlist', `({ text: document.querySelector('.cutlist').innerText })`);
    if (!/Hard maple/.test(r.text) || !/Purpleheart/.test(r.text) || !/Rip the strips/.test(r.text) || !/Juice groove/.test(r.text) || !/Sand and oil/.test(r.text) || !/board feet|bd ft|bf/i.test(r.text)) throw new Error(r.text.slice(0, 400));
  }],
  ['the Dimensions tile writes every length like a caliper does: fractions, decimal inches or millimetres, in the tile, the steps and the view', async () => {
    const r = await probe('preset=tumbling-blocks', `(async () => { const pick = (label, value) => { const el = document.querySelector('select[aria-label="' + label + '"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); }; const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const read = () => ({ note: document.querySelector('.card.target .note').textContent, first: document.querySelector('.steps .step .note').textContent, info: document.querySelector('.overlay.info').innerText, units: document.querySelector('select[aria-label="Units"]').value, round: document.querySelector('select[aria-label="Round to"]').selectedOptions[0].textContent }); const fraction = read(); pick('Units', 'decimal'); await wait(500); const decimal = read(); pick('Units', 'metric'); await wait(500); const metric = read(); return { fraction, decimal, metric, cutlistUnits: document.querySelectorAll('.cutlist .units').length }; })()`);
    const ok = r.fraction.units === 'fraction' && r.fraction.round === '1/16″' && /Finishes at 16″ × 12″ × 1 1\/2″/.test(r.fraction.note) && /about 1 7\/16″/.test(r.fraction.first)
      && r.decimal.round === '0.01″' && /Finishes at 16″ × 12″ × 1\.5″/.test(r.decimal.note) && /about 1\.44″/.test(r.decimal.first) && !/\d\/\d/.test(r.decimal.note + r.decimal.info)
      && r.metric.round === '0.5 mm' && /Finishes at 406\.5 mm × 305 mm × 38 mm/.test(r.metric.note) && / mm/.test(r.metric.first) && !/″/.test(r.metric.note + r.metric.first + r.metric.info)
      && r.cutlistUnits === 0;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['rounding is in the board and not only the words: at 1/16 the grid is built from sixteenths and finishes where they put it, and the cut list says the same', async () => {
    const r = await probe('preset=maple-purpleheart', `(async () => { const pick = (label, value) => { const el = document.querySelector('select[aria-label="' + label + '"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); }; const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const read = () => ({ note: document.querySelector('.card.target .note').textContent, fit: document.querySelector('.step.first .fit-note')?.textContent ?? '', info: document.querySelector('.overlay.info').innerText }); const sixteenth = read(); pick('Round to', '0'); await wait(900); const exact = read(); pick('Round to', '0.125'); await wait(900); const eighth = read(); [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === 'Cut list and steps').click(); await wait(400); const list = document.querySelector('.cutlist').innerText; return { sixteenth, exact, eighth, list: list.slice(0, 1500) }; })()`);
    /** Every inch length in a text is a whole number of `den`ths. */
    const onGrid = (text, den) => [...text.matchAll(/(\d+ \d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)″/g)].every(([, n]) => { const [a, b] = n.split(' '); const part = (t) => (t.includes('/') ? +t.split('/')[0] / +t.split('/')[1] : +t); const v = (part(a) + (b ? part(b) : 0)) * den; return Math.abs(v - Math.round(v)) < 1e-6; });
    const ok = onGrid(r.sixteenth.note + r.sixteenth.fit + r.sixteenth.info, 16) && !/\d\.\d/.test(r.sixteenth.note + r.sixteenth.fit)
      && /Finishes at 16″ × 12″/.test(r.exact.note) && /Hard maple 0\.9\d+″ wide/.test(r.exact.fit)
      && onGrid(r.eighth.note + r.eighth.fit + r.eighth.info, 8) && onGrid(r.list.split('Rough extra')[0], 8) && r.eighth.note !== r.exact.note;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['the Target board tile lists every design and changes the board to the one picked at the same size, and holds the grain switch', async () => {
    const r = await probe('preset=brick', `(async () => { const pick = (label, value) => { const el = document.querySelector('select[aria-label="' + label + '"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); }; const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const sel = () => document.querySelector('.card.board-pick select[aria-label="Design"]'); const before = { value: sel().value, options: [...sel().options].map((o) => o.textContent), groups: [...sel().querySelectorAll('optgroup')].map((g) => g.label), grain: !!document.querySelector('.card.board-pick .grain-switch'), heads: [...document.querySelectorAll('.side .card h3')].slice(0, 2).map((h) => h.textContent), note: document.querySelector('.card.target .note').textContent }; pick('Design', 'checkerboard'); await wait(1200); return { before, after: { value: sel().value, name: document.title.replace(' - Cutting Boards', ''), note: document.querySelector('.card.target .note').textContent, broken: document.querySelectorAll('.step.broken').length, round: document.querySelector('select[aria-label="Round to"]').value } }; })()`);
    const ok = r.before.value === 'brick' && r.before.options.length === 11 && r.before.options.at(0) === 'Single wood' && r.before.options.at(-1) === '3D Board' && r.before.groups.join('|') === 'Beginner|Intermediate|Advanced' && r.before.grain
      && r.before.heads.join('|').toLowerCase() === 'target board|dimensions'
      && r.after.value === 'checkerboard' && r.after.name === 'Black walnut and hard maple checkerboard' && !r.after.broken && r.after.round === '0.0625'
      && /Finishes at/.test(r.after.note);
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['the saw kerf is set once, under Dimensions: the cutting steps have no kerf field of their own, and a thicker blade takes longer stock', async () => {
    const r = await probe('preset=brick', `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const labels = () => [...document.querySelectorAll('.steps .step .field > span:first-child, .steps .step label > span:first-child')].map((e) => e.textContent); const stock = () => [...document.querySelectorAll('.step.first .row input')].map((i) => i.value)[0]; const field = [...document.querySelectorAll('.card.target input')].find((i) => /Saw kerf/.test(i.closest('label')?.textContent ?? '')); const before = { was: field.value, stock: stock(), kerfFields: labels().filter((t) => t === 'Kerf').length }; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '1/4'); field.dispatchEvent(new Event('input', { bubbles: true })); await wait(1800); [...document.querySelectorAll('.steps .step header')].find((h) => h.querySelector('strong').textContent === 'Cross cut').click(); await wait(900); return { before, after: { stock: stock(), caption: document.querySelector('.overlay.caption').textContent } }; })()`);
    /** A length as the fields write it, in inches. */
    const inches = (t) => t.split(' ').reduce((v, part) => v + (part.includes('/') ? +part.split('/')[0] / +part.split('/')[1] : +part), 0);
    if (r.before.was !== '1/8' || r.before.kerfFields !== 0 || !(inches(r.after.stock) > inches(r.before.stock)) || !/\(kerf 1\/4″\)/.test(r.after.caption)) throw new Error(JSON.stringify(r));
  }],
  ['the Target board and Dimensions tiles show the finished board when clicked', async () => {
    const r = await probe('preset=brick&stage=2', later(
      `const head = () => document.querySelector('.overlay.info strong').textContent; const before = head(); document.querySelector('.card.target h3').click()`,
      `({ before, after: head(), last: document.querySelectorAll('.overlay.stepper i').length })`, 700));
    if (!/^3\. /.test(r.before) || !new RegExp('^' + r.last + '\\. Sand and oil').test(r.after)) throw new Error(JSON.stringify(r));
  }],
  ['a strip thinner than the minimum under Dimensions is flagged on the step that mills it', async () => {
    const r = await probe('preset=maple-purpleheart', `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const before = document.querySelectorAll('.step.first .warning').length; const field = [...document.querySelectorAll('.card.target .field, .card.target label')].find((f) => /Thinnest strip/.test(f.textContent)).querySelector('input'); const was = field.value; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '1/4'); field.dispatchEvent(new Event('input', { bubbles: true })); await wait(1500); return { before, was, warning: document.querySelector('.step.first .warning')?.textContent ?? '' }; })()`);
    if (r.before !== 0 || r.was !== '1/8' || !/Thinner than the 1\/4″ minimum: Purpleheart at 1\/8″/.test(r.warning)) throw new Error(JSON.stringify(r));
  }],
  ['the print preview page is as tall as its text, and the preview scrolls to reach the end of it', async () => {
    const r = await probe('preset=brick&preview', `(() => { const sheet = document.querySelector('.print-sheet'), view = document.querySelector('.preview'); const last = sheet.querySelector('.cutlist ol li:last-child').getBoundingClientRect(); const page = sheet.getBoundingClientRect(); return { spill: sheet.scrollHeight - sheet.clientHeight, lastInside: last.bottom <= page.bottom + 1, scrolls: view.scrollHeight > view.clientHeight + 1 && getComputedStyle(view).overflowY === 'auto', window: innerHeight, page: Math.round(page.height) }; })()`);
    if (r.spill > 1 || !r.lastInside || !r.scrolls || r.page <= r.window) throw new Error(JSON.stringify(r));
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
    const ok = r.steps.length === 15 && r.steps.every((s) => s.picture) && !r.plainList
      && /1\. Rip the strips/.test(r.steps[0].text) && /^Mill 7 Teak strips 2″ wide, /m.test(r.steps[0].text) && /2\. Glue up/.test(r.steps[1].text) && /^Glue them edge to edge/m.test(r.steps[1].text)
      && /5\. Cross cut/.test(r.steps[4].text) && /13 slices/.test(r.steps[4].text) && /11\. Round the corners/.test(r.steps[10].text) && /14\. Juice groove/.test(r.steps[13].text) && /15\. Sand and oil/.test(r.steps[14].text);
    if (!ok) throw new Error(JSON.stringify(r).slice(0, 700));
  }],
  ['the board wizard offers its sizes as a single-select list', async () => {
    const r = await probe('wizard', later(
      `const radios = () => [...document.querySelectorAll('.wizard-sizes [role=radio]')]; radios()[2].click()`,
      `({ count: radios().length, checked: radios().map((b) => b.getAttribute('aria-checked')) })`), WIZARD);
    if (r.count < 3 || r.checked.filter((c) => c === 'true').length !== 1 || r.checked[2] !== 'true') throw new Error(JSON.stringify(r));
  }],
  ['the board wizard draws a picture for each design', async () => {
    const r = await probe('wizard=designs', `({ pictures: [...document.querySelectorAll('.wizard-examples img')].filter((i) => i.src.startsWith('data:image/png')).length })`, examples(4));
    if (r.pictures < 4) throw new Error(JSON.stringify(r));
  }],
  ['the board wizard has two pages, size then design: each design is offered once, easiest first under Beginner, Intermediate and Advanced, and no name or description says which grain', async () => {
    const r = await probe('wizard', later(
      `const first = { crumbs: [...document.querySelectorAll('.crumbs li')].map((e) => e.textContent), grains: document.querySelectorAll('.wizard-types').length }; document.querySelector('.modal footer button.primary').click()`,
      `({ first, levels: [...document.querySelectorAll('.wizard-level h3')].map((e) => e.textContent), labels: [...document.querySelectorAll('.wizard-examples strong')].map((e) => e.textContent), blurbs: [...document.querySelectorAll('.wizard-examples span')].map((e) => e.textContent), options: document.querySelectorAll('.modal select').length })`, 3500), WIZARD);
    const ok = r.first.crumbs.join('|') === '1. Size|2. Design' && r.first.grains === 0
      && r.labels.length === 11 && new Set(r.labels).size === 11 && r.blurbs.length === 11 && r.labels.includes('3D Board') && ![...r.labels, ...r.blurbs].some((t) => /(end|edge|long)[ -]grain/i.test(t))
      && r.labels.join('|') === 'Single wood|Stripes|Stripes in a border|Checkerboard|Chess board|Brick (running bond)|Grid|Chevron|Double border|Basket weave|3D Board' && r.levels.join('|') === 'Beginner|Intermediate|Advanced' && r.options === 0;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['the wizard\'s designs are a list: a click picks one and leaves the wizard open, OK starts it, and the pictures show the board full face', async () => {
    const r = await probe('wizard=designs', `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const card = (t) => [...document.querySelectorAll('.wizard-examples button')].find((b) => b.querySelector('strong').textContent === t); const ok = () => document.querySelector('.wizard-pick button.primary'); const before = { ok: ok().disabled, picked: document.querySelectorAll('.wizard-examples [aria-selected=true]').length, roles: [...new Set([...document.querySelectorAll('.wizard-examples button')].map((b) => b.getAttribute('role')))].join(), lists: document.querySelectorAll('.wizard-examples[role=listbox]').length }; const img = card('Basket weave').querySelector('img'); await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; const bg = [d[0], d[1], d[2]]; let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0; for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const o = 4 * (y * c.width + x); if (Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) > 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } } card('Brick (running bond)').click(); await wait(300); const one = { wizard: !!document.querySelector('.modal'), picked: [...document.querySelectorAll('.wizard-examples [aria-selected=true] strong')].map((e) => e.textContent), ok: ok().disabled, said: document.querySelector('.wizard-pick .note').textContent }; card('Chevron').click(); await wait(300); const two = [...document.querySelectorAll('.wizard-examples [aria-selected=true] strong')].map((e) => e.textContent); ok().click(); await wait(900); return { before, one, two, face: { wide: x1 - x0, tall: y1 - y0 }, after: { wizard: !!document.querySelector('.modal'), name: document.title.replace(' - Cutting Boards', '') } }; })()`, examples(11));
    // Seen square on, the board's picture is as tall against its width as the board is wide against its length.
    const ok = r.before.ok && r.before.picked === 0 && r.before.roles === 'option' && r.before.lists === 3
      && r.one.wizard && r.one.picked.join() === 'Brick (running bond)' && !r.one.ok && r.one.said === 'Brick (running bond)' && r.two.join() === 'Chevron'
      && !r.after.wizard && /chevron$/.test(r.after.name) && r.face.tall / r.face.wide > 0.6 && r.face.tall / r.face.wide < 1.05;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['picking the chess board opens it like any other design: eight squares as wide as the board asked for, named for its woods', async () => {
    const r = await probe('wizard=designs', later(
      `const card = [...document.querySelectorAll('.wizard-examples button')].find((b) => b.querySelector('strong').textContent === 'Chess board'); const size = card.querySelector('small').textContent; card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
      `({ size, wizard: !!document.querySelector('.modal'), name: document.title.replace(' - Cutting Boards', ''), info: document.querySelector('.overlay.info').innerText, broken: document.querySelectorAll('.step.broken').length })`, 800), examples(11));
    if (r.wizard || r.name !== 'Black walnut and hard maple chess board' || !/12″ × 12″/.test(r.size) || !/12″ × 12″/.test(r.info) || r.broken) throw new Error(JSON.stringify(r));
  }],
  ['picking the double border board opens it the same way, named for its three woods', async () => {
    const r = await probe('wizard=designs', later(
      `const card = [...document.querySelectorAll('.wizard-examples button')].find((b) => b.querySelector('strong').textContent === 'Double border'); const picture = !!card.querySelector('img')?.src.startsWith('data:image/png'); card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
      `({ picture, wizard: !!document.querySelector('.modal'), name: document.title.replace(' - Cutting Boards', ''), broken: document.querySelectorAll('.step.broken').length })`, 800), examples(11));
    if (!r.picture || r.wizard || r.name !== 'Hard maple, black walnut and white oak double border' || r.broken) throw new Error(JSON.stringify(r));
  }],
  ['picking the 3D board opens tumbling blocks: a picture on its card, three boards to mill for its first step and a bevel rip for its second, the size asked for, and both grains on offer', async () => {
    const r = await probe('wizard=designs', later(
      `const card = [...document.querySelectorAll('.wizard-examples button')].find((b) => b.querySelector('strong').textContent === '3D Board'); const picture = !!card.querySelector('img')?.src.startsWith('data:image/png'); const size = card.querySelector('small').textContent; card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
      `({ picture, size, wizard: !!document.querySelector('.modal'), name: document.title.replace(' - Cutting Boards', ''), first: document.querySelector('.step.first header strong').textContent, note: document.querySelector('.step.first .note').textContent, bevel: document.querySelector('.steps .step .note').textContent, woods: document.querySelectorAll('.step.first .strip-row select').length, on: document.querySelector('.grain-switch button.on')?.textContent, edge: [...document.querySelectorAll('.grain-switch button')].find((b) => b.textContent === 'Edge grain').disabled, steps: [...document.querySelectorAll('.steps .step:not(.touch) header strong')].map((t) => t.textContent), info: document.querySelector('.overlay.info').innerText, broken: document.querySelectorAll('.step.broken').length, warnings: document.querySelectorAll('.step .warning').length })`, 800), examples(11));
    const ok = r.picture && !r.wizard && r.name === 'Hard maple, black walnut and cherry 3D blocks' && r.first === 'Mill the boards' && /^Three boards, one of each wood: 1 1\/4″ thick, [0-9 \/]+″ wide and [0-9 \/]+″ long\.$/.test(r.note) && !/30°|diamond/.test(r.note) && /^Blade tilted 30°\. Each strip is a diamond in cross-section, about 1 7\/16″ on every side\./.test(r.bevel)
      && r.woods === 3 && r.on === 'End grain' && !r.edge && r.steps.join('|') === 'Bevel rip|Glue up|Glue up|Cross cut|Turn to end grain|Offset|Glue up|Trim|Flatten' && !r.broken && !r.warnings && /× 12″ ×/.test(r.size) && r.info.includes(r.size.replace('Finishes at ', '').split(' × ').slice(0, 2).join(' × '));
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['the grain switch turns the 3D board into its other recipe, made from flat strips cut and flipped twice: the same size and design, nothing smaller than a slice', async () => {
    const r = await probe('preset=tumbling-blocks', later(
      `const read = () => ({ on: document.querySelector('.grain-switch button.on')?.textContent, design: document.querySelector('select[aria-label="Design"]').value, steps: [...document.querySelectorAll('.steps .step:not(.touch) header strong')].map((t) => t.textContent), fields: [...document.querySelectorAll('.step.first .row span')].map((e) => e.textContent).filter(Boolean), note: document.querySelector('.step.first .note').textContent, size: document.querySelector('.card.target .note').textContent, name: document.title, broken: document.querySelectorAll('.step.broken').length, warnings: document.querySelectorAll('.step .warning').length }); const before = read(); [...document.querySelectorAll('.grain-switch button')].find((b) => b.textContent === 'Edge grain').click()`,
      `({ before, after: read() })`, 1500));
    const ok = r.before.on === 'End grain' && r.after.on === 'Edge grain' && r.after.design === 'tumbling-blocks' && r.after.name === r.before.name
      && r.after.steps.join('|') === 'Glue up|Flatten|Cross cut|Flip|Offset|Glue up|Flatten|Trim|Rip the panel|Flip|Glue up|Trim|Flatten' && r.after.fields.includes('Strip width') && !r.before.fields.includes('Strip width')
      && /Flat strips, ripped square, in the order left, top, right, top/.test(r.after.note) && r.after.size === r.before.size && /16″ × 12″ × 1 1\/2″/.test(r.after.size)
      && !r.after.broken && !r.after.warnings;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['Add the feet is off until ticked; ticked, it is the last step, with its sizes on its card, feet drawn under the board, and the board the same size', async () => {
    const r = await probe('preset=brick', `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const card = () => [...document.querySelectorAll('.steps .step.touch')].find((c) => c.querySelector('strong').textContent === 'Add the feet'); const read = () => ({ dots: document.querySelectorAll('.overlay.stepper i').length, size: document.querySelector('.card.target .note').textContent, fields: [...card().querySelectorAll('.field > span:first-child, label > span:first-child')].map((e) => e.textContent), number: card().querySelector('em')?.textContent ?? '' }); const before = { ...read(), ticked: card().querySelector('input').checked }; card().querySelector('input').click(); await wait(900); card().querySelector('header > strong').click(); await wait(900); let below = 0; for (const node of window.boardScene.shown.nodes) { const p = node.mesh.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.01) below++; } return { before, after: { ...read(), heading: document.querySelector('.overlay.info strong').textContent, caption: document.querySelector('.overlay.caption').textContent, below, warnings: card().querySelectorAll('.warning').length } }; })()`);
    const ok = !r.before.ticked && !r.before.fields.length && !r.before.number
      && r.after.dots === r.before.dots + 1 && r.after.size === r.before.size && r.after.fields.join('|') === 'Diameter|Height|In from edges'
      && new RegExp('^' + r.after.dots + '\\. Add the feet$').test(r.after.heading) && r.after.number === String(r.after.dots)
      && /screw a foot inside each of the four corners, its centre 1″ in from both edges\. The feet are 13\/16″ across and 3\/8″ tall/.test(r.after.caption)
      && r.after.below > 0 && !r.after.warnings;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['New has Custom, which starts with the strips and their glue-up and nothing else; a checkerboard is then built from it by adding steps from the toolbar', async () => {
    const r = await probe('preset=brick', `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const rb = (t) => [...document.querySelectorAll('.top .rb')].find((b) => b.textContent.startsWith(t)); rb('New').click(); await wait(200); const menu = [...document.querySelectorAll('.dropdown button strong')].map((e) => e.textContent); [...document.querySelectorAll('.dropdown button')].find((b) => b.querySelector('strong').textContent === 'Custom').click(); await wait(900); const cards = () => [...document.querySelectorAll('.steps .step:not(.touch) header strong')].map((e) => e.textContent); const start = { name: document.title.replace(' - Cutting Boards', ''), first: document.querySelector('.step.first header strong').textContent, cards: cards(), ticked: [...document.querySelectorAll('.steps .step.touch input[type=checkbox]')].filter((c) => c.checked).length, design: document.querySelector('select[aria-label="Design"]').selectedOptions[0].textContent, dots: document.querySelectorAll('.overlay.stepper i').length }; document.querySelector('.step.first .row button').click(); await wait(500); const strips = document.querySelectorAll('.step.first .strip-row').length; const sel = document.querySelectorAll('.step.first .strip-row select')[1]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'walnut'); sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(500); document.querySelector('.steps .step header').click(); await wait(400); for (const step of ['Flatten', 'Cross cut', 'Turn to end grain', 'Flip', 'Glue up', 'Flatten']) { rb('Add step').click(); await wait(200); [...document.querySelectorAll('.add-menu button')].find((b) => b.querySelector('strong').textContent === step).click(); await wait(700); } return { menu: menu.slice(0, 2), start, strips, built: { cards: cards(), heading: document.querySelector('.overlay.info strong').textContent, info: document.querySelector('.overlay.info').innerText, broken: document.querySelectorAll('.step.broken').length, errors: document.querySelectorAll('.step .error').length } }; })()`);
    const ok = r.menu.join('|') === 'Board wizard…|Custom' && r.start.name === 'Custom board' && r.start.first === 'Rip the strips' && r.start.cards.join('|') === 'Glue up'
      && r.start.ticked === 0 && r.start.design === 'Your own design' && r.start.dots === 2 && r.strips === 2
      && r.built.cards.join('|') === 'Glue up|Flatten|Cross cut|Turn to end grain|Flip|Glue up|Flatten' && /^8\. Flatten$/.test(r.built.heading) && !/loose/.test(r.built.info) && !r.built.broken && !r.built.errors;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['the 3D board can be built from Custom with nothing to say what it is: a rip with the blade tilted straight after step 1 makes that step three boards', async () => {
    const r = await probe('preset=brick', `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const rb = (t) => [...document.querySelectorAll('.top .rb')].find((b) => b.textContent.startsWith(t)); const add = async (step) => { rb('Add step').click(); await wait(200); const b = [...document.querySelectorAll('.add-menu button')].find((x) => x.querySelector('strong').textContent === step); const ok = !b.disabled; b.click(); await wait(700); return ok; }; const cards = () => [...document.querySelectorAll('.steps .step:not(.touch) header strong')].map((e) => e.textContent); rb('New').click(); await wait(200); [...document.querySelectorAll('.dropdown button')].find((b) => b.querySelector('strong').textContent === 'Custom').click(); await wait(900); const options = document.querySelectorAll('select[aria-label="Made from"]').length; const before = document.querySelector('.step.first header strong').textContent; document.querySelector('.step.first header').click(); await wait(400); const added = [await add('Rip the panel')]; const tilt = [...document.querySelectorAll('.steps .step .field')].find((f) => f.querySelector('span')?.textContent === 'Blade tilt °').querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(tilt, '30'); tilt.dispatchEvent(new Event('input', { bubbles: true })); await wait(800); const ripped = cards(); const first = document.querySelector('.step.first header strong').textContent; const woods = document.querySelectorAll('.step.first .strip-row select').length; [...document.querySelectorAll('.steps .step header')].find((h) => h.querySelector('strong').textContent === 'Glue up').click(); await wait(400); for (const step of ['Glue up', 'Cross cut', 'Turn to end grain', 'Offset', 'Glue up', 'Trim', 'Flatten']) added.push(await add(step)); const size = [...document.querySelectorAll('.card.target .row input')].slice(0, 3).map((i) => i.value); return { options, before, first, woods, added, ripped, cards: cards(), heading: document.querySelector('.overlay.info strong').textContent, note: document.querySelector('.card.target .note').textContent, size, broken: document.querySelectorAll('.step.broken').length, errors: [...document.querySelectorAll('.step .error')].map((e) => e.textContent) }; })()`);
    const ok = r.options === 0 && r.before === 'Rip the strips' && r.first === 'Mill the boards' && r.woods === 3 && r.added.every(Boolean) && r.ripped.join('|') === 'Bevel rip|Glue up'
      && r.cards.join('|') === 'Bevel rip|Glue up|Glue up|Cross cut|Turn to end grain|Offset|Glue up|Trim|Flatten' && /^10\. Flatten$/.test(r.heading)
      && r.note === 'Finishes at ' + r.size[0] + '″ × ' + r.size[1] + '″ × ' + r.size[2] + '″.' && !r.broken && !r.errors.length;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['About, in the toolbar, says Joe designed and architected the app and set its standards, that Claude wrote its code, and its version from package.json; Escape closes it', async () => {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version.replace(/^(\d+\.\d+)\.0$/, '$1');
    const r = await probe('preset=brick', `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const before = document.querySelectorAll('.modal.about').length; [...document.querySelectorAll('.top .rb')].find((b) => b.textContent === 'About').click(); await wait(300); const box = document.querySelector('.modal.about'); const text = box.innerText; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(300); return { before, text, role: box.getAttribute('role'), after: document.querySelectorAll('.modal.about').length }; })()`);
    const ok = r.before === 0 && r.after === 0 && r.role === 'dialog' && r.text.includes('Designed by Joe Long.') && r.text.includes(`Version ${version}`)
      && r.text.includes('Joe designed and architected the app, and set and enforced its standards. Claude, an AI model made by Anthropic, wrote the code, the tests and the documentation to them, using Claude Code.')
      && r.text.includes('Check every measurement');
    if (!ok) throw new Error(JSON.stringify({ ...r, version }));
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
// Start from empty test profiles, so nothing an interrupted run left behind can change a result.
cleanUp();

/**
 * What a run must leave exactly as it found it: the real designs folder (every file's name, size
 * and time) and the names of this app's folders in the temp directory.
 */
function footprint() {
  const designs = join(root, 'designs');
  const files = existsSync(designs)
    ? readdirSync(designs).sort().map((f) => { const s = statSync(join(designs, f)); return `${f} ${s.size} ${s.mtimeMs}`; })
    : [];
  const temp = readdirSync(tmpdir()).filter((n) => n.startsWith('cutting-boards')).sort();
  return JSON.stringify({ files, temp }, null, 1);
}
const before = footprint();
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
cleanUp();
// A run that changed the designs folder or left a folder behind has failed, whatever its checks said.
const after = footprint();
if (after !== before) {
  failed++;
  console.log(`FAIL  the run left things changed\n      before: ${before.replace(/\n/g, '\n      ')}\n      after: ${after.replace(/\n/g, '\n      ')}`);
} else console.log('ok    the designs folder and the temp folder are as they were before the run');
process.exit(failed ? 1 : 0);
