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
  ['going into the chamfer size keeps the finished board, groove and all, on show; from an earlier step it goes to the chamfer step', async () => {
    const into = `[...document.querySelectorAll('.step.touch .field')].find((f) => f.querySelector('span')?.textContent === 'Chamfer').querySelector('input').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`;
    const seen = `({ heading: document.querySelector('.overlay.info strong').textContent, notice: !!document.querySelector('.not-final') })`;
    const end = await probe('preset=brick', later(into, seen));
    const early = await probe('preset=brick&stage=2', later(`const before = ${seen}; ${into}`, `({ before, after: ${seen} })`));
    if (!/Sand and oil/.test(end.heading) || end.notice || !/Flatten/.test(early.before.heading) || !/Chamfer the bottom edges/.test(early.after.heading)) throw new Error(JSON.stringify({ end, early }));
  }],
  ['a finishing card is selected by a click on its title or on the space round its fields, and a click on a field leaves the view alone', async () => {
    const card = `const card = (t) => [...document.querySelectorAll('.steps .step.touch')].find((c) => c.querySelector('strong').textContent === t); const info = () => document.querySelector('.overlay.info strong').textContent; const hit = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));`;
    const r = await probe('preset=brick', later(
      `${card} const seen = {}; hit(card('Juice groove').querySelector('header > strong')); setTimeout(() => { seen.title = info(); hit(card('Chamfer the bottom edges').querySelector('.params')); }, 300); setTimeout(() => { seen.space = info(); hit(card('Juice groove').querySelector('.params .field input')); }, 600)`,
      `({ ...seen, field: info(), ticked: card('Juice groove').querySelector('input').checked })`, 1000));
    if (!/14\. Juice groove/.test(r.title) || !/Chamfer the bottom edges/.test(r.space) || !/Chamfer the bottom edges/.test(r.field) || !r.ticked) throw new Error(JSON.stringify(r));
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
  ['Add a step is on screen without scrolling and adds after the selected step', async () => {
    const r = await probe('preset=brick&stage=6', later(
      `const bar = document.querySelector('.add-step'); const box = bar.getBoundingClientRect(); const title = bar.querySelector('span').textContent; const cards = () => [...document.querySelectorAll('.step strong, .step-card strong, .steps strong')].length; const n = document.querySelectorAll('.overlay.stepper i').length; [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Insert accent strips').click()`,
      `({ title, visible: box.top >= 0 && box.bottom <= window.innerHeight + 1, before: n, after: document.querySelectorAll('.overlay.stepper i').length, heading: document.querySelector('.overlay.info strong').textContent })`));
    if (!/after 7\. Offset/i.test(r.title) || !r.visible || r.after !== r.before + 1 || !/8\. Insert accent strips/.test(r.heading)) throw new Error(JSON.stringify(r));
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
    if (r.label !== '1 Rip the strips' || r.second !== '2 Glue up' || r.numbers !== '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15' || !r.selected || r.heading !== '1. Rip the strips' || !/7 loose strips/.test(r.info) || r.kind !== 'strips' || r.drawn !== 7) throw new Error(JSON.stringify(r));
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
  ['the toolbar has ten buttons in four named groups, each an icon over its label', async () => {
    const r = await probe('preset=brick', `({ groups: [...document.querySelectorAll('.top .group > small')].map((e) => e.textContent), buttons: [...document.querySelectorAll('.top .rb')].map((b) => { const icon = b.querySelector('svg.icon').getBoundingClientRect(), label = b.querySelector('span').getBoundingClientRect(); return { text: b.textContent, icon: Math.round(icon.width), above: icon.bottom <= label.top + 1 }; }) })`);
    const ok = r.groups.join('|') === 'File|Edit|Share|View' && r.buttons.map((b) => b.text).join('|') === 'New|Open|Save|Save as|Undo|Redo|Export|Print|Picture|Hide panel'
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
      `const titles = [...document.querySelectorAll('.side .step header strong')].map((e) => e.textContent); const card = (name) => [...document.querySelectorAll('.steps .step')].find((c) => c.querySelector('header strong').textContent === name); const info = () => document.querySelector('.overlay.info').innerText; const before = info(); const panel = card('Start another panel'); const page = { strips: panel.querySelectorAll('.panel-strip').length, faced: [...panel.querySelectorAll('.faced input[type=checkbox]')].map((c) => c.checked), auto: [...panel.querySelectorAll('label.check')].at(-1).querySelector('input').checked, aside: panel.querySelector('.result').textContent, border: [...card('Add a border').querySelectorAll('.field > span')].map((e) => e.textContent), addable: [...document.querySelectorAll('.add-step button')].map((b) => b.textContent) }; panel.querySelector('.faced input[type=checkbox]').click()`,
      `({ titles, page, before, after: info(), broken: document.querySelectorAll('.step.broken').length })`, 700));
    const ok = r.titles.join('|') === 'Rip the strips|Glue up|Flatten|Trim|Cross cut|Turn to end grain|Start another panel|Flatten|Trim|Cross cut|Turn to end grain|Interleave the slices|Offset|Glue up|Flatten|Trim|Add a border|Flatten|Round the corners|Chamfer the bottom edges|Round over the top edges|Juice groove template|Juice groove|Sand and oil'
      && r.page.strips === 4 && r.page.faced.join() === 'true,false,false,false' && r.page.auto && /slices set aside/.test(r.page.aside)
      && r.page.border.includes('Border') && r.page.border.includes('Line inside it')
      && ['Start another panel', 'Interleave the slices', 'Add a border'].every((t) => r.page.addable.includes(t)) && r.before !== r.after && r.broken === 0;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['while the second panel is worked, the 3D view draws the slices set aside beside it', async () => {
    const r = await probe('preset=basket-weave&stage=9', `({ heading: document.querySelector('.overlay.info strong').textContent, work: window.boardScene.shown.nodes.length, aside: window.boardScene.shown.aside.length, drawn: window.boardScene.shown.aside.every((n) => n.group.parent === window.boardScene.root), past: window.boardScene.shown.asideZ > window.boardScene.shown.sizeZ })`);
    if (!/^10\. Cross cut/.test(r.heading) || r.aside < 2 || r.work < 1 || !r.drawn || !r.past) throw new Error(JSON.stringify(r));
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
    const ok = b.map((c) => c.title).join('|') === 'Round the corners|Chamfer the bottom edges|Round over the top edges|Juice groove template|Juice groove|Sand and oil'
      && b.map((c) => c.number).join() === '11,12,13,,14,15' && b.slice(0, 3).every((c) => c.on === true) && b[4].on === true
      && b[0].fields.join() === 'Corner radius' && b[1].fields.join() === 'Chamfer' && b[2].fields.join() === 'Roundover (bit)' && b[3].fields.length === 0 && b[3].on === false && b[4].fields.length === 4 && b[5].fields.length === 0
      && r.before.chamfer.info === '12. Chamfer the bottom edges' && /^Chamfer the bottom edges 1\/4″ at 45°/.test(r.before.chamfer.caption) && !/groove|corners|Sand/.test(r.before.chamfer.caption)
      // Ticked off: the chamfer keeps its card, without a number or fields, and the steps after it move up one.
      && a[1].on === false && a[1].number === '' && a[1].fields.length === 0 && a.map((c) => c.number).join() === '11,,12,,13,14' && r.after.dots === r.before.dots - 1;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['Rip the panel is a step that can be added after a glue-up, and leaves strips to work as slices', async () => {
    const r = await probe('preset=single-edge-grain&stage=1', later(
      `const bar = document.querySelector('.add-step'); const button = [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Rip the panel'); const enabled = !button.disabled; button.click()`,
      `({ enabled, heading: document.querySelector('.overlay.info strong').textContent, info: document.querySelector('.overlay.info').innerText, caption: document.querySelector('.overlay.caption').textContent, fields: [...document.querySelectorAll('.steps .step.selected .field > span:first-child')].map((e) => e.textContent) })`, 600));
    if (!r.enabled || r.heading !== '3. Rip the panel' || !/8 loose slices/.test(r.info) || !/^Rip the panel lengthways into 8 strips, each 1 1\/4″ wide/.test(r.caption) || r.fields.join() !== 'Strip width,Kerf') throw new Error(JSON.stringify(r));
  }],
  ['a board finishes at exactly the target size: the grid opens at 16 x 12, says what its strips are milled to, and stays on target in edge grain', async () => {
    const r = await probe('preset=maple-purpleheart', later(
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
  ['the cut list has a units choice: Metric adds millimetres beside the inches, and Imperial off leaves millimetres only', async () => {
    const r = await probe('preset=brick&tab=cutlist', later(
      `const boxes = () => [...document.querySelectorAll('.cutlist .units input')]; const text = () => [...document.querySelectorAll('.cutlist table, .cutlist ol, .cutlist .note')].map((e) => e.innerText).join(' '); const shots = [{ on: boxes().map((b) => b.checked), text: text() }]; boxes()[1].click(); setTimeout(() => { shots.push({ on: boxes().map((b) => b.checked), text: text() }); boxes()[0].click(); }, 300); setTimeout(() => { shots.push({ on: boxes().map((b) => b.checked), text: text() }); boxes()[1].click(); }, 600)`,
      `({ shots: shots.map((s) => ({ on: s.on, inch: (s.text.match(/″/g) || []).length, mm: (s.text.match(/ mm/g) || []).length, sample: s.text.slice(0, 90) })), last: boxes().map((b) => b.checked), saved: localStorage.getItem('cutting-boards.units.v1') })`, 900));
    const [imperial, both, metric] = r.shots;
    const ok = imperial.on.join() === 'true,false' && imperial.inch > 10 && imperial.mm === 0
      && both.on.join() === 'true,true' && both.inch === imperial.inch && both.mm > 10
      && metric.on.join() === 'false,true' && metric.inch === 0 && metric.mm > 10
      // Turning the last unit off turns the other on.
      && r.last.join() === 'true,false' && r.saved === '{"imperial":true,"metric":false}';
    if (!ok) throw new Error(JSON.stringify(r));
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
  ['the board wizard has two pages, size then design: each design is offered once, and no name or description says which grain', async () => {
    const r = await probe('wizard', later(
      `const first = { crumbs: [...document.querySelectorAll('.crumbs li')].map((e) => e.textContent), grains: document.querySelectorAll('.wizard-types').length }; document.querySelector('.modal footer button.primary').click()`,
      `({ first, labels: [...document.querySelectorAll('.wizard-examples strong')].map((e) => e.textContent), blurbs: [...document.querySelectorAll('.wizard-examples span')].map((e) => e.textContent), options: document.querySelectorAll('.modal select').length })`, 3500), WIZARD);
    const ok = r.first.crumbs.join('|') === '1. Size|2. Design' && r.first.grains === 0
      && r.labels.length === 10 && new Set(r.labels).size === 10 && r.blurbs.length === 10 && ![...r.labels, ...r.blurbs].some((t) => /(end|edge|long)[ -]grain/i.test(t))
      && r.labels.at(-2) === 'Chess board' && r.labels.at(-1) === 'Double border' && r.labels.slice(0, 5).join('|') === 'Single wood|Stripes|Stripes in a border|Grid|Checkerboard' && r.options === 0;
    if (!ok) throw new Error(JSON.stringify(r));
  }],
  ['picking the chess board opens it like any other design: eight squares as wide as the board asked for, named for its woods', async () => {
    const r = await probe('wizard=designs', later(
      `const card = [...document.querySelectorAll('.wizard-examples button')].find((b) => b.querySelector('strong').textContent === 'Chess board'); const size = card.querySelector('small').textContent; card.click()`,
      `({ size, wizard: !!document.querySelector('.modal'), name: document.title.replace(' - Cutting Boards', ''), info: document.querySelector('.overlay.info').innerText, broken: document.querySelectorAll('.step.broken').length })`, 800), examples(11));
    if (r.wizard || r.name !== 'Black walnut and hard maple chess board' || !/12″ × 12″/.test(r.size) || !/12″ × 12″/.test(r.info) || r.broken) throw new Error(JSON.stringify(r));
  }],
  ['picking the double border board opens it the same way, named for its three woods', async () => {
    const r = await probe('wizard=designs', later(
      `const card = [...document.querySelectorAll('.wizard-examples button')].find((b) => b.querySelector('strong').textContent === 'Double border'); const picture = !!card.querySelector('img')?.src.startsWith('data:image/png'); card.click()`,
      `({ picture, wizard: !!document.querySelector('.modal'), name: document.title.replace(' - Cutting Boards', ''), broken: document.querySelectorAll('.step.broken').length })`, 800), examples(11));
    if (!r.picture || r.wizard || r.name !== 'Hard maple, black walnut and white oak double border' || r.broken) throw new Error(JSON.stringify(r));
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
