# Project summary

Last true on **2026-11-27**.

## What it is

Cutting Boards designs a cutting board before any wood is cut: pick a pattern and a size, and it
draws every stage of the build in 3D and writes the cut list and the instructions. It is an
Electron desktop app and, from the same code, a web page at <https://boards.longshotsw.com>.
`readme.md` has the directions for using it and the description of how it models wood.

## Where it stands

- Version **0.9.1**, on Electron 45. 547 tests (`npm test`) and 54 checks of the real window
  (`npm run smoke`) pass.
- No board has been built in wood from its instructions yet. Until one has, the recipes are
  checked by geometry and by reading, not at the bench.
- Eleven designs in three levels: single wood, stripes, stripes in a border, checkerboard, chess
  board (beginner); brick, grid, chevron (intermediate); double border, basket weave, 3D board
  (advanced). **New → Custom** starts from the strips alone, and every design can be rebuilt that
  way (`src/model/custom.test.ts`).
- A design is a list of steps, each carried out by primitive actions (`src/model/actions.ts`),
  with one stage per operation at the bench (`src/model/pipeline.ts`). End or edge grain is a
  switch on the open board (`src/model/grain.ts`). The 3D board has a recipe for each grain
  (`src/model/blocks.ts`, `src/model/blocksFlat.ts`).
- Units, rounding, saw kerf and the thinnest strip are settings of the design; the board drawn is
  built from the rounded sizes. Size boxes are in the design's units, and a size typed in the
  other units (`43mm`, `3/4"`) is converted. The Dimensions tile takes the starting
  thickness of the wood as well as the finished thickness of the board, and the instructions say
  where a size is set for good. The brick board starts in hard maple. (All uncommitted on
  2026-11-27, waiting for the owner to look at them.)
- A Windows installer is built by `npm run installer` (electron-builder, per user, unsigned) and
  attached to a release on GitHub. There is no installer for macOS or Linux.
- The web version is an Azure Static Web App on the Free plan. A change that lands on `main` is
  released by `.github/workflows/release.yml`: version worked out from the commit subjects and
  recorded as a tag, unit tests, installer, site uploaded and verified by hash, release
  published. `main` takes only pull requests that pass `.github/workflows/checks.yml`. Neither
  workflow runs the window checks. The release workflow had not yet run on 2026-11-27.

## History

The project began on 2026-11-17 as a folder of a private repository of shop projects and moved
here, with its commits, on 2026-11-27. Commit messages before the move begin `cutting-boards:`
and may mention pull requests of that repository.

## Known gaps

See "Known limits" in `readme.md`. Beyond those:

- With rounding on, a held board finishes near its target, not on it.
- The feet are drawn grey, not brass.
- An accent strip that is itself a slice of another glue-up is described in one long instruction.

## Next

1. Build a board from the instructions and correct what the bench shows to be wrong.
2. Decide whether chevron belongs under Advanced.
3. A whole-project spelling and markdown lint sweep, and a lint command in `package.json`.
