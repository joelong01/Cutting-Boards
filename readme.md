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
  there is always something on screen to tap. On a phone the Dimensions tile scrolls with the
  list instead of staying pinned, to leave room for the steps.
- **Grain switch.** **End grain / Edge grain** in the Target board card turns the open board
  round, keeping its woods, pattern and size: end to edge takes out the turn step and mills the
  stock to the board's thickness; edge to end cuts and stands the slices up. Greyed out for
  basket weave and chevron, which cannot be turned round. On the 3D board it swaps the whole
  recipe for the other one.
- **Target board.** The first tile: which design the board is, in a dropdown of every design on
  offer, and the grain switch. The designs are listed easiest first, under Beginner, Intermediate
  and Advanced, here, in the board wizard and under New. Picking another design changes the open board to it at the same
  size (Ctrl+Z brings the old one back).
- **Dimensions.** The second tile, which stays at the top of the side panel while the steps
  scroll under it: the size to build and the size the recipe finishes at, plus three settings
  saved with the design.
  - **Units**: inches as fractions, inches as decimals, or millimetres, like the modes of a
    caliper. Every length in the window, the cut list, the instructions and the printed sheet is
    written that way. Lengths are still typed in inches.
  - **Round to**: 1/64 to 1/8 inch, 0.001 to 0.01 inch, or 0.1 to 1 mm, or Exact. Every size is
    rounded to it where it is used, so the board drawn is built from the sizes the instructions
    give, and "Finishes at" is where those sizes really land. A coarse step moves the board off
    its target, visibly. A size smaller than one step (a saw kerf, a 1/16 inch flattening pass)
    is kept as it is, and a trim is not rounded: it is sawn to the size it leaves. New boards
    start at 1/16 inch.
  - **Saw kerf**: how thick the blade cuts, 1/8 inch to start with. Every cut in the recipe uses
    it, the cutting steps have no kerf field of their own, and the stock is sized to allow for it
    (on the 3D board, the boards are also wide enough for the corner a bevel rip wastes).
  - **Thinnest strip**: the thinnest the planer or sander can work, 1/8 inch to start with. A
    step that mills anything thinner is flagged, and strip widths cannot be typed below it.

  Clicking either tile shows the finished board.
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
- **Steps.** Click a step to select it. **Add step** in the toolbar opens a menu of the steps
  there are, says which step the new one will follow, and puts it straight after the selected
  one, so steps can be added in the middle of a recipe. Steps that do not fit there (a flip with
  nothing cut yet) are greyed out and say what they need. Each step shows the size it leaves. Steps that do not fit the current state (a cross
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
  target, and numbered instructions, every length written and rounded the way the Dimensions
  tile says. The printed sheet and PDF follow it too.
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
(angled cuts) cannot be switched. The 3D board has a recipe for each grain and switches between them.
Picking a design opens it for
editing. A design is a pattern, not a grain: its name and description say nothing of which
grain is on top, and each is listed once (single wood is one design, not one for each grain). The
same nine starting designs are listed under **New** at their default sizes: single wood, stripes,
stripes in a border, grid, checkerboard, brick, basket weave, chevron and the 3D board. Each opens
in the grain it is usually made in, and the switch on the board changes it.

**The 3D board** (tumbling blocks) is diamonds in three woods, three round every point, that read
as stacked cubes. No row of straight cuts through a striped panel makes that, so its strips are
not square (`src/model/blocks.ts`). Its steps are the ordinary ones:

1. **Mill the boards**: one square board of each wood, 10 1/4″ wide and 14″ long for a 16 × 12 board.
2. **Bevel rip**: each board ripped with the blade tilted 30° into six strips, every one a
   diamond in cross-section.
3. **Glue up**: one strip of each wood into each hexagonal log.
4. **Glue up**: the six logs side by side, flat to flat, into one row.
5. **Cross cut** the row into slices as long as the board is thick, plus the flattening. Each
   slice is a whole row of the pattern in one piece.
6. **Turn to end grain**: stand the slices up.
7. **Offset**: slide every other slice half a log along, so the points of one fit the hollows
   of the next.
8. **Glue up** the slices. The top is the pattern.
9. **Trim** the board out of the ragged block, and **Flatten**.

Nothing smaller than a slice is handled: eight slices for that board, not loose pieces.

The thickness of the boards the strips are ripped from sets the size of the blocks. Holding the
board's size counts the logs and the rows again and sets how many strips there are and how long.

That is the end-grain recipe. The grain switch changes it to the other one: the same design with
face grain on top, made entirely from strips (`src/model/blocksFlat.ts`). Nothing smaller than a
slice of a panel is handled, and every step is an ordinary one:

1. **Rip the strips**, square: the two face woods one width, the top wood about half that.
   **Glue up** in the order left, top, right, top, repeated, and **Flatten**.
2. **Cross cut** the panel 30° off square into slices.
3. **Flip** every other slice face down and **Offset** it half a repeat, then **Glue up** and
   **Flatten**: a zigzag panel.
4. **Trim**, then **Rip the panel** into strips, each cut along the middle of a top-wood band.
5. **Flip** every other strip face down and **Glue up**: the half-diamonds meet as whole ones.
6. **Trim** to size and **Flatten**.

The fit sets every size from the face strips' width and the target, and finds the stock by
running the recipe: the slices from the two ends of the angled cut are short and are sawn off.
Its sizes are not rounded, since they follow from the 60° of the diamonds.

In either recipe each step is one operation at the bench, with its own picture and instruction.

## About and the version

**About**, at the end of the toolbar, says who designed the app, that its code was written by
Claude, and its version. The version is the one in `package.json`, put into the page when it is
built. A deploy moves it on by how big the change is: `npm run deploy -- --bump=patch` for a
fix, `--bump=minor` for something new, `--bump=major` when saved designs would open differently.
Without `--bump` the version stays as it is.

## Custom boards

**New → Custom** starts a board with nothing but the strips and their glue-up: no pattern, no
finishing, no feet. The rest is built by adding steps from **Add step** in the toolbar and
filling in their cards. `custom.test.ts` rebuilds every design on offer that way, and the 3D
board in both grains, step by step with only what the cards can set, and checks each comes out
identical to the original. What makes that possible:

- Every step after the first can be moved or removed, and a step can be added straight after the
  first, before the strips are glued.
- **Rip the panel** has a blade tilt. A rip with the blade tilted, straight after the first
  step, is the bevel rip of an end-grain 3D board: the first step then makes three boards, not
  strips, without anyone saying so (`madeFromSteps` in `src/model/blocksFlat.ts`). The
  edge-grain 3D board is recognised the same way, by its strips and its cut-and-flip steps. A
  3D board's sizes follow from its diamonds, so the fit sets them.
- A strip's row has an **S** button to mark it a spacer, and a **Cross cut** can say it saws
  spacers out and how wide they are. A spacer is never milled thinner than the saw kerf; one
  wider than the blade is sawn out in two passes.
- Every step's card takes a note, added to its instruction.

## Feet

**Add the feet**, the last card under Finishing, is off until ticked. Ticked, it is the last step
of all, after the sanding: a round foot screwed under each corner, drawn beneath the board. Its
sizes start at those of the common brass-and-rubber screw-on feet (0.82″ across, 0.35″ tall) with
each foot's centre 1″ in from both edges, and all three can be changed. Feet are not part of the
board's size, its wood or its yield. Feet that would stick out past the edges or meet in the
middle are left off, with the reason.

## One operation, one stage

What the view plays, and what the instructions number, is one operation at the bench at a time:
mill, glue, cut, turn, place. A step in the Design tab is usually one operation. Three are
several, and each of their operations has its own stage, picture and sentence
(`performEach` in `src/model/pipeline.ts`):

- **Start another panel**: mill its pieces (the first slices go to one side), glue faces onto
  any planks that take them, glue it up.
- **Insert accent strips**: mill the strips, which lie beside the slices, then place them.
- **Add a border**: mill the pieces, glue on the ends, glue on the sides. An end-grain border's
  pieces are made first: mill strips, glue two small panels, cut the pieces from them.

A card that covers several operations is numbered with all of them ("8–9"), so the numbers in
the list, the view and the printed instructions agree. An instruction says only its own
operation, not what came before or what comes next. `run` gives a stage per operation and
`runSteps` gives each step whole, for anything that asks what a step leaves.

Known exception: an accent strip that is itself a slice of another glue-up (a pattern) is still
described in one long instruction.

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
npm test                                   # 516 tests of the model: the defects a review found, what each pattern must look like, building every design from Custom, feet, one operation per stage, dimensions and rounding, the 3D board, the exact fit, reference outputs, the actions, geometry, every step, presets, resizing, both grains, cut list, design files, finish, naming, units
npm run smoke                              # builds, then 50 checks of the real window: About, Custom, feet, the wizard list, the Target board and Dimensions tiles, the grain switch, 3D view, wizard, print preview, edge tags, add step, accent strips, removing strips and woods, pinned target size, hiding the panel, save and open
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
- **The 3D board** is tumbling blocks only. The other 3D illusions (the "woven tube" look) are
  not here. Its trim off the ragged block comes out in odd decimals; the size it trims to is
  what matters.
- **Auto trim** squares the two long edges only. Ends are trimmed by the amounts you enter.
- Lengths are typed in inches whatever the units shown.
- With rounding on, a held board finishes near its target, not on it: the fit finds the exact
  sizes and rounds them, and does not yet look for a different count of strips that would land closer.
