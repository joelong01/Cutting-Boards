# Cutting Boards

A desktop app for modelling a cutting board before any wood is cut. Enter the strips for the first
glue-up, then add the operations a real board goes through: cross cut, turn to end grain, flip,
offset, insert accent strips, glue up, trim, flatten. Every stage is drawn in 3D, and the app
writes the cut list and the order of operations.

Status as of **2026-11-17**: first version, built and smoke-tested. Not yet used to build a board.

## Run it

Needs Node 22 or newer. From this folder:

```powershell
npm install          # once
npm start            # build, then open the desktop app
npm run dev          # desktop app with hot reload, for changing the code
npm test             # geometry and recipe tests
npm run smoke        # build, then check the real app window feature by feature
npm run check        # both of the above: about 15 seconds
npm run web          # the same page in a browser (designs save to browser storage instead of files)
npm run deploy       # run every check; only if all pass, publish to cuttingboard.azurewebsites.net and check it by hash
```

On Windows the app adds itself to the Start Menu as **Cutting Boards** the first time it starts,
so after that it can be opened from there without a terminal. `npm run shortcut` adds the entry
without opening the app. The shortcut opens the last build; it does not rebuild, so run
`npm start` once after changing the code. To remove it, delete
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Cutting Boards.lnk`.

If `npm install` reports that Electron's install script was skipped, run
`node node_modules/electron/install.js` once to fetch the Electron binary.

## On a phone

The web version is published to the Azure App Service `cuttingboard` (resource group
`rg-cutting-boards`, Linux, Node 22, Free plan `plan-cutting-boards`, served by `scripts/azure-server.cjs`, which the deploy installs as `server.cjs` so phones always re-check the page) at
<https://cuttingboard.azurewebsites.net>. `npm run deploy` runs `npm run check` first and stops if any
test or window check fails; otherwise it publishes and checks every live file against the build by hash. It needs `az login` and prints a timing report; `--plan` says what
it would do without deploying. The site is public and keeps designs in the phone's browser
storage, so it is for showing a board, not keeping designs. Open a starter design with
`?preset=brick` (or any key under **New**).

On a phone the side panel starts hidden. The blue **☰ Edit** tab on the left edge opens it; the
blue **Show the board ›** bar along the bottom goes back to the board.

## What it does

- **Toolbar.** Along the top, laid out like an Office ribbon: groups of buttons (File, Edit,
  Share, View), each button an icon over its label. The design's name is in the window's title
  bar; **Save as** (Ctrl+Shift+S) gives it a new name. It is the same in the
  desktop app and the web page; on a phone the buttons shrink to one row and lose the group names.
- **Hide the panel.** **Hide panel** in the toolbar, the blue **‹ Board** tab beside the panel,
  or Ctrl+B gives the 3D view the whole window; **Show panel** or the blue **☰ Edit** tab brings the side panel back. On a phone-width screen the panel starts hidden and,
  when shown, takes the whole width, so the toggle switches between editing and the board; the
  tab then becomes a **Show the board ›** bar along the bottom, clear of the panel's controls, so
  there is always something on screen to tap. On a phone the target board and "Add a step" scroll
  with the list instead of staying pinned, to leave room for the steps.
- **Grain switch.** **End grain / Edge grain** in the Target board card turns the open board
  round, keeping its woods, pattern and size: end to edge takes out the turn step and mills the
  stock to the board's thickness; edge to end cuts and stands the slices up. Greyed out for
  basket weave and chevron, which cannot be turned round.
- **Target board.** The size to build, and the size the recipe finishes at. It stays at the top
  of the side panel while the steps scroll under it.
- **Strips.** Step 1, "Mill strips for first glue-up": species, width, order, a repeat count, and
  "end with first strip" for a symmetric panel. Lengths accept shop fractions (`1 1/8`, `3/4`);
  Up/Down nudges by 1/16.
- **Accent strips.** An "Insert accent strips" step takes a list of strips, like step 1 does:
  each gap between slices gets the whole stack, in order (walnut, maple, walnut, say). A strip can
  also be a slice of a second glue-up, a panel with a strip pattern of its own: click its
  **Panel** row to edit that panel's strips, where it starts, and how far every other one is slid
  along. A panel strip can be a plank "faced both sides" with another wood. The step's instruction
  says how to make the panel and the cut list has its stock.
- **Border.** "Add a border" glues a frame round a panel, with a thin line inside it if you
  want one. On an end-grain board the border is end-grain blocks, so it moves with the board.
- **A second panel.** Some patterns need two different panels. "Start another panel" sets the
  loose slices aside and glues up a new panel from its own strips; flatten, trim, cross cut and
  turn it with the usual steps, then "Interleave the slices" brings the first set back with a new
  slice after each. The panel sizes itself to the slices set aside unless you untick that. While
  the second panel is being worked, the 3D view shows the set-aside slices waiting beside it.
  A strip of either panel can be a plank "faced both sides" with another wood.
- **Basket weave.** Walnut bars lying alternately along and across, a maple square where four
  bars meet, a cherry line round every piece, in a walnut border. It is two panels made with the
  same steps: the square rows, and the bar rows, whose across bars are walnut planks with a
  cherry face glued to each side. They are interleaved and every other bar row is slid over by
  one bar. Change a wood in step 1 and the second panel and border follow; change the bar width
  and the second panel's widths and the slide have to be changed to match, by hand.
- **Steps.** Click a step to select it; "Add a step" puts the new one straight after it, so steps
  can be added in the middle of a recipe. Each step shows the size it leaves. Steps that do not fit the current state (a cross
  cut with no glued panel) say so instead of failing silently.
- **3D view.** Drag to orbit, wheel to zoom. Hover a block for its species, size and grain
  direction. With a Turn, Flip or Offset step selected, click slices to choose which ones it
  applies to. Play runs the build as an animation; Left/Right step through it. Selecting a
  step shows the board as that step leaves it; **Show finished board** goes back to the end.
  With a Trim step selected, the panel's sides are tagged Edge A, Edge B, End A and End B to
  match the step's fields.
- **Target.** With "Keep the board at this size" ticked (the default), the target length and
  width are held: change a strip width, the stock thickness or a step, and the app finds the
  repeat count and stock length again, so the wood changes and the board does not. The board
  finishes at the smallest size its blocks allow that is not under the target. Untick it to type
  the repeat count and stock length yourself.
- **The board finishes at the size asked for.** The target length, width and thickness are what
  the board comes out at, exactly, in either grain. With "Keep the board at this size" on, a fit
  first finds the fewest strips and the shortest stock that make a board at least that big, at
  the sizes you typed; then the sizes give way so it is not over at all. Across the board, the
  strips that are not locked are milled a little narrower (thin accent lines, under 3/8″, and
  spacers are locked, so they keep their width). Along the board, the blocks are made a little
  shorter: the strips' thickness when the slices stand on end, the cross-cut width when they do
  not. A brick slide keeps its proportion to the blocks. The widths you typed stay as typed and
  the strips card says what to mill them to; fitting again, or going to another size and back,
  gives the same board. Two patterns are left "at least the size": basket weave, whose two
  panels must match piece for piece, and chevron, whose angled cut moves both sides at once.
- **Finishing.** Four touches, each a card of its own under the steps, ticked on or off, with its
  own size: round the corners, chamfer the bottom edges, round over the top edges, and a juice
  groove in the top. Each one that is on is a numbered step with its own instruction, drawn in
  the 3D view as that cut alone leaves the board, and a last step, Sand and oil, follows them.
  Curves are drawn as short flat facets. A touch that does not fit the board is left off with a
  warning on its own card. The groove is cut as a router cuts it: with the path corner radius at
  0 (a router guided by straight rails) its outside corners take the bit's radius and its inside
  corners stay sharp.
- **Cut list and steps.** Stock to mill by species, board feet, yield, finished size against the
  target, and numbered instructions. **Units** at the top of the tab ticks Imperial, Metric or
  both: with both, every length reads `1 1/2″ (38.1 mm)`, and board feet are joined by cubic
  metres. The printed sheet and PDF follow the same choice, which is remembered. The design is
  still entered in inches, and the Design tab and the 3D view still show inches.
- **Names.** A design names itself from its woods and pattern ("Hard maple and black walnut grid")
  and keeps that up to date as the woods change, until you save it or give it a name of your own
  with **Save as**. The name is shown in the window's title bar.
- **Save, open, export.** Save (Ctrl+S) writes `designs/<name>.board.json` in this folder, so
  designs are versioned with the repo. Delete moves the file to the recycle bin. Undo and redo
  with Ctrl+Z and Ctrl+Y.
- **Print preview.** **Print…** (or Ctrl+P) shows the sheet as it will print: the cut list and the
  order of operations. Tick "Show a picture of each step" and every step is drawn beside its
  instruction. Print it or save it as a PDF from there. **Picture** saves the current 3D view as a PNG.
- **Export.** A PDF of the cut list and steps, the same PDF with a picture of each step, or
  the design file itself.

**New ▸ Board wizard** has two pages. The first asks for the finished size. The second shows every
pattern once, already resized to fit, each with a picture; picking one opens it for editing, where
its woods, its sizes and which grain is on top are changed like any other board's. Among them are
a chess board, always 8 × 8 squares and as wide as the board asked for, in walnut and maple, and a
double border board. A double border board is square blocks, each
ringed by a second wood, in a grid of a third wood that also frames the board, with every
crossing matching. It starts as maple, walnut and white oak with a cheap spacer wood (poplar), and fits a whole
number of 1 1/2″ blocks to the size. It takes three glue-ups: after the
usual two, the panel is turned, sawn through each spacer strip of the first glue-up, with a kerf
as wide as the strip, and the third wood is glued into the kerfs. An "Insert accent strips" step
can also put its strips on the outside of the first and last slice, which this board uses to
close the pattern at the edges.
End grain or edge grain is not a kind of board: it is only whether the recipe stands the slices
up after the first cross cut ("Turn to end grain"). The **End grain / Edge grain** switch on the
Target board card puts that step in or takes it out of the open board, and swaps the stock
thickness with the cross-cut width so the blocks stay square (`src/model/grain.ts`); a board
with no cross cut gets one, with a turn and a glue-up. Basket weave (two panels) and chevron
(angled cuts) cannot be switched.
Picking a design opens it for
editing. A design is a pattern, not a grain: its name and description say nothing of which
grain is on top, and each is listed once (single wood is one design, not one for each grain). The
same eight starting designs are listed under **New** at their default sizes: single wood, stripes,
stripes in a border, grid, checkerboard, brick, basket weave and chevron. Each opens in the grain
it is usually made in, and the switch on the board changes it.

## How it models wood

Every piece is a convex solid with a species and a grain direction (`src/model/geometry.ts`). A
cut clips solids with a plane; a turn or flip is a rotation; a glue-up packs slices together.
Because nothing is special-cased to rectangles, angled cuts and rolled strips work the same way
as square ones, and a face shows end grain exactly when it is square to the piece's fibres.

A design is a list of steps, and every step is carried out by one or more **primitive actions**,
the things actually done at the bench (`src/model/actions.ts`):

| Action | What it does | Steps made from it |
| --- | --- | --- |
| `rip` | Rip and mill the strips for a glue-up: the blanks | Rip the strips (step 1 of every board); Start another panel |
| `crosscut` | Saw a panel into slices, square or at an angle | Cross cut |
| `rotate` | Turn slices, or the whole panel, by an angle about an axis | Turn to end grain (90° about a slice's length), Flip (180°), Quarter-turn panel |
| `shift` | Slide slices along their length | Offset |
| `addStrips` | Put a stack of strips between the slices | Insert accent strips |
| `setAside`, `interleave` | Put the slices to one side; bring them back between new ones | Start another panel; Interleave the slices |
| `glue` | Glue what is on the bench into one panel: strips edge to edge, slices face to face | Glue up (step 2 of every starter board, and after any cross cut); Start another panel |
| `trim`, `flatten` | Saw the edges square; take wood off the faces | Trim; Flatten |
| `ripPanel` | Saw a glued panel lengthways into strips, then worked as slices | Rip the panel |
| `roundCorners`, `chamfer`, `roundOver`, `groove`, `sand` | The finishing touches, each cut together with the ones before it; then sand and oil | The finishing steps |
| `border` | Glue a frame round a panel | Add a border |

Every board starts with the same two steps: rip the strips, then glue them up. Each action is a
pure function from the state of the work to its state afterwards, with the stock it needs and
the sentence that tells you how to do it. The instructions are those sentences and nothing else:
a step made of several actions (Start another panel is `setAside`, `rip`, `glue`) says each
one's in turn. `src/model/pipeline.ts` lists the
steps, which actions each one is and what a new one starts with, and runs a design by doing them
in order. Nothing in the
engine knows about patterns or grain. The recipe is recomputed from the strips every time
something changes, so there is no stored geometry to go stale.

A design file (format version 2) holds only the list of steps, the target size and the finishing
options. The first step is always "Rip the strips", which carries the strips, their thickness,
length and repeat; in every starter the second is the "Glue up" of those strips. There is no
separate strips block: `layupOf(design)` and `withLayup(design, …)` in `src/model/design.ts` read
and change that first step. Files saved in format version 1 are refused with a message and are
not converted.

`src/model/golden.test.ts` holds the output of every starter design, at several sizes and both
grains, a line per stage. A change to how the recipe is run must leave every line as it was.

| Path | What it holds |
| --- | --- |
| `src/model/` | Geometry, the recipe, presets, cut list, fit-to-target, storage. No UI. Tested. |
| `src/view/` | The three.js scene, procedural wood textures, the viewport component. |
| `src/ui/` | The editors for strips, steps and the cut list. |
| `electron/` | The desktop shell. Only it touches the disk, through the small API in `preload.cts`. |
| `designs/` | Saved designs. Source files: commit them. |
| `dist/`, `electron-dist/` | Build output. Generated, ignored by git. |
| `assets/`, `public/icon.png` | The app icon. Generated by `scripts/make-icon.cjs`; regenerate with `npm run icon`, never edit by hand. |

## Code conventions

- **Every feature has at least one test.** Logic in `src/model/` gets a unit test
  (`*.test.ts`); anything that only exists in the window gets a check in `scripts/smoke.mjs`.

- **Every function has a comment saying what it is for**: exported or private, class method or
  named helper inside another function. Inline callbacks passed straight to a prop or an array
  method are the exception.
- **When a function changes, its comment changes in the same edit.** A comment that no longer
  matches the code is a defect.

## Checks

```powershell
npm test                                   # 399 tests of the model: the exact fit, reference outputs, the actions, geometry, every step, presets, resizing, both grains, cut list, design files, finish, naming, units
npm run smoke                              # builds, then 38 checks of the real window: the grain switch, 3D view, wizard, print preview, edge tags, add step, accent strips, removing strips and woods, pinned target size, hiding the panel, save and open
node scripts/run.mjs --selftest            # save, list, read and delete a design through the app
node scripts/run.mjs --screenshot=out.png --query=preset=brick   # render one frame and exit
```

`--pdf=out.pdf` writes the PDF that **Save as PDF** writes, with no file dialog, and exits.

`--query` takes `preset=<key>`, `stage=<n>`, `tab=cutlist`, `preview`, `pictures` and `wizard` (or `wizard=designs` to open at its second page).
`--ready=<expression>` makes a test run look as soon as the expression is true in the page
instead of waiting a fixed `--wait`, and `--profile=<name>` gives it a settings folder of its own
so several can run at once; the smoke checks use both.
A test run's window (`--eval`, `--pdf`, `--screenshot`) is placed outside every monitor and kept
out of the taskbar, so it never covers your work; add `--show` to watch one on screen. The smoke
script stops any launch still running and deletes its test profile folders when it ends.
A test run keeps its designs in that throwaway folder, never in `designs/`, and deletes them
outright rather than to the recycle bin. The smoke script compares the designs folder and the temp
folder before and after, and fails if the run left anything changed.
`--eval=<expression>` runs one expression in the page and prints the result; the 3D scene is
reachable there as `window.boardScene`.

## Known limits

- **Wood colours are approximations** picked by eye, and the grain is generated, not photographed.
- **Strip sizes in the cut list are finished sizes.** Jointing and planing allowances are yours.
- **3D-illusion boards** (tumbling blocks, the "woven tube" look) need bevel cuts and separate
  sub-assemblies glued together. Neither exists yet.
- **Auto trim** squares the two long edges only. Ends are trimmed by the amounts you enter.
- Inches only.
