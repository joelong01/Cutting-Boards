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
npm run web          # the same page in a browser (designs save to browser storage instead of files)
```

On Windows the app adds itself to the Start Menu as **Cutting Boards** the first time it starts,
so after that it can be opened from there without a terminal. `npm run shortcut` adds the entry
without opening the app. The shortcut opens the last build; it does not rebuild, so run
`npm start` once after changing the code. To remove it, delete
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Cutting Boards.lnk`.

If `npm install` reports that Electron's install script was skipped, run
`node node_modules/electron/install.js` once to fetch the Electron binary.

## What it does

- **Strips.** Species, width, order, a repeat count, and "end with first strip" for a symmetric
  panel. Lengths accept shop fractions (`1 1/8`, `3/4`); Up/Down nudges by 1/16.
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
  target, and numbered instructions.
- **Names.** A design names itself from its woods and pattern ("Hard maple and black walnut grid")
  and keeps that up to date as the woods change, until you type a name of your own or save it.
- **Save, open, export.** Save (Ctrl+S) writes `designs/<name>.board.json` in this folder, so
  designs are versioned with the repo. Delete moves the file to the recycle bin. Undo and redo
  with Ctrl+Z and Ctrl+Y.
- **Print preview.** **Print…** (or Ctrl+P) shows the sheet as it will print: the cut list and the
  order of operations, with a tick box to add a picture of each stage. Print it or save it as a
  PDF from there. **PNG** saves the current 3D view.

**New ▸ Board wizard** asks for the finished size, then end grain or edge grain, then shows the
common boards of that type already resized to fit, each with a picture. Picking one opens it for
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
npm test                                   # 169 tests of the model: geometry, every step, presets, resizing, cut list, design files, finish, naming
npm run smoke                              # builds, then 13 checks of the real window: 3D view, wizard, print preview, edge tags, add step, save and open
node scripts/run.mjs --selftest            # save, list, read and delete a design through the app
node scripts/run.mjs --screenshot=out.png --query=preset=brick   # render one frame and exit
```

`--pdf=out.pdf` writes the PDF that **Save as PDF** writes, with no file dialog, and exits.

`--query` takes `preset=<key>`, `stage=<n>`, `tab=cutlist` and `wizard=end` or `wizard=edge`.
`--eval=<expression>` runs one expression in the page and prints the result; the 3D scene is
reachable there as `window.boardScene`.

## Known limits

- **Wood colours are approximations** picked by eye, and the grain is generated, not photographed.
- **Strip sizes in the cut list are finished sizes.** Jointing and planing allowances are yours.
- **3D-illusion boards** (tumbling blocks, the "woven tube" look) need bevel cuts and separate
  sub-assemblies glued together. Neither exists yet.
- **Basket weave** is modelled by ripping one panel into square logs with zero kerf. In the shop
  those logs are glued up one at a time; the cut list does not yet say so.
- **Auto trim** squares the two long edges only. Ends are trimmed by the amounts you enter.
- Inches only.
