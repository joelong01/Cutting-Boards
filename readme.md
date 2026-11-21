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
npm run deploy       # build the web page, publish it to cuttingboard.azurewebsites.net, check it by hash
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
`rg-cutting-boards`, Linux, Node 22, Free plan `plan-cutting-boards`, served by `pm2 serve`) at
<https://cuttingboard.azurewebsites.net>. `npm run deploy` rebuilds, publishes, and checks every live
file against the build by hash. It needs `az login` and prints a timing report; `--plan` says what
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
- **Finish.** The last card in the step list, all on by default, each with its own size: rounded
  corners, a rounded-over top edge, a 45° chamfer on the bottom edges, and a juice groove in the
  top. They are cut into the 3D model, so the last stage shows the board as it will be; curves are
  drawn as short flat facets. Anything that does not fit the board is skipped with a warning. The
  groove is cut as a router cuts it: with the path corner radius at 0 (a router guided by straight
  rails) its outside corners take the bit's radius and its inside corners stay sharp.
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

**New ▸ Board wizard** has two pages. The first asks for the finished size and which grain faces
up, end or edge. The second shows the designs of that grain already resized to fit, each with a
picture; picking one opens it for editing, where its woods and sizes are changed like any other
board's. Among them are a chess board, always 8 × 8 squares and as wide as the board asked for, in
walnut and maple, and a double border board, each made end grain or face grain to match the grain
chosen. A double border board is square blocks, each
ringed by a second wood, in a grid of a third wood that also frames the board, with every
crossing matching. It starts as maple, walnut and white oak with a cheap spacer wood (poplar), and fits a whole
number of 1 1/2″ blocks to the size. It takes three glue-ups: after the
usual two, the panel is turned, sawn through each spacer strip of the first glue-up, with a kerf
as wide as the strip, and the third wood is glued into the kerfs. An "Insert accent strips" step
can also put its strips on the outside of the first and last slice, which this board uses to
close the pattern at the edges.
Picking a design opens it for
editing. The same eight starting designs are listed under **New** at their default sizes:

| Type | Designs |
| --- | --- |
| End grain | Single wood, maple blocks with a purpleheart grid, checkerboard, brick, basket weave |
| Edge grain | Single wood, stripes, chevron |

## How it models wood

Every piece is a convex solid with a species and a grain direction (`src/model/geometry.ts`). A
cut clips solids with a plane; a turn or flip is a rotation; a glue-up packs slices together.
Because nothing is special-cased to rectangles, angled cuts and rolled strips work the same way
as square ones, and a face shows end grain exactly when it is square to the piece's fibres.

The recipe in `src/model/pipeline.ts` is recomputed from the strips every time something changes,
so there is no stored geometry to go stale. A design file holds only the strips and the steps.

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
npm test                                   # 211 tests of the model: geometry, every step, presets, resizing, cut list, design files, finish, naming, units
npm run smoke                              # builds, then 30 checks of the real window: 3D view, wizard, print preview, edge tags, add step, accent strips, pinned target size, hiding the panel, save and open
node scripts/run.mjs --selftest            # save, list, read and delete a design through the app
node scripts/run.mjs --screenshot=out.png --query=preset=brick   # render one frame and exit
```

`--pdf=out.pdf` writes the PDF that **Save as PDF** writes, with no file dialog, and exits.

`--query` takes `preset=<key>`, `stage=<n>`, `tab=cutlist`, `preview`, `pictures` and `wizard=end` or `wizard=edge`.
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
