# AI Assistant Rules for Cutting Boards

This document defines the rules, conventions, and standards for AI assistants working in the
Cutting Boards repository. It is the single source of truth; read it before changing anything.

## Starting work

At the start of a new task, read these in order before editing:

1. `.ai/ai-rules.md` (this file) for the rules.
2. `.ai/project-summary.md` for where the project stands and what is next.
3. `readme.md` for what the app does, how it models wood, and how it is checked.
4. The source files the task touches, and their tests.

Then look at the ground truth: `git status` and `git log --oneline -10`.

## AI agent agnosticism

**CRITICAL RULE:** all content in `.ai/` must be **AI agent agnostic**.

- No agent-specific references. Use "AI assistant" or "AI agent".
- Agent-specific bindings live in their own files and point back here: `CLAUDE.md` and `AGENTS.md`
  at the root, and `.claude/` for commands and permissions.
- New guidance goes **here**, not in the bindings. The bindings stay thin.

## What this repository is

One program: a desktop app (Electron) and a web page (the same code) for designing a cutting board
before any wood is cut. A design is a list of steps; the app draws every stage in 3D and writes
the cut list and the instructions. It is written in TypeScript with React and three.js.

The repository is **public**. Everything committed here, and every commit message, is read by
strangers.

## Repository structure

```text
CLAUDE.md  AGENTS.md    # thin bindings that point at .ai/ai-rules.md
.ai/                    # these rules, project summary, session handover: agent agnostic
.claude/                # commands and permissions for one AI coding tool

src/model/              # geometry, the recipe, presets, cut list, fit, storage. No UI. Unit tested.
src/view/               # the three.js scene, wood textures, the viewport
src/ui/                 # the editors for strips, steps and the cut list
electron/               # the desktop shell: the only code that touches the disk
scripts/                # run, window checks (smoke), deploy, icon
public/                 # files copied into the build as they are
designs/                # designs saved from the desktop app
docs/                   # pictures the readme shows
dist/  electron-dist/   # build output: generated, ignored by git
```

## What the app must be for the person at the bench

These came from the owner, a woodworker, correcting recipes that could not be built. They outrank
elegance in the code.

- **Strips, not loose blocks.** A recipe handles strips and slices of a panel. If a pattern seems
  to need many small loose pieces, find the recipe that cuts them from a glued panel instead. A
  spacer strip that is ripped out later is better than an individual block.
- **One operation per step.** Mill, glue, cut, turn, place: each is its own stage with its own
  picture, animation and instruction. Never fold two operations into one stage.
- **A step stands on its own.** Its instruction says what to do in that step, not what came before
  or what comes next.
- **Sizes a person can cut.** Nobody mills to a thousandth of an inch. Every length shown is
  written in the units and rounding the design asks for, and the board drawn is built from those
  rounded sizes. Someone who wants exact sizes sets rounding to Exact.
- **Allow for the saw.** Every cut uses the design's saw kerf, and stock is sized for the wood the
  blade turns to dust. A spacer is never thinner than the kerf; a wider one is sawn in two passes.
- **Followable by an ordinary woodworker.** If a step could not be done with a table saw, a
  planer, clamps and glue by someone reading only that step, the step is wrong.

## Code conventions

- **Every function has a comment saying what it is for**: exported or private, class method or
  named helper inside another function. Inline callbacks passed straight to a prop or an array
  method are the exception.
- **When a function changes, its comment changes in the same edit.** A comment that no longer
  matches the code is a defect.
- **Every feature has at least one test.** Logic in `src/model/` gets a unit test (`*.test.ts`);
  anything that exists only in the window gets a check in `scripts/smoke.mjs`.
- **A test must be able to fail for the reason it exists.** Comparing a design with itself (a
  round trip, a snapshot) does not show the board is right. A pattern needs a test of what it must
  look like (`src/model/patterns.test.ts`). When fixing a defect, show the new test fails without
  the fix.
- **No abstractions that are only wrappers.** Each layer must justify its own existence.
- **The model has no UI in it**, and only `electron/` touches the disk.
- **Generated files are never edited by hand.** `dist/`, `electron-dist/`, the icon files
  (`npm run icon`) and the test snapshots are produced by commands. Change the source and
  regenerate.
- Comment **why**, not what.

## Checks

```sh
npm test         # the model's unit tests
npm run smoke    # build, then check the real window feature by feature
npm run check    # both: run this before every commit
npx tsc --noEmit # types only, for a quick look while editing
```

- Run `npm run check` before committing, and read its result.
- **Tests leave no trace.** A test run's window is kept off the screen and out of the taskbar, it
  keeps its designs in a throwaway folder, and the smoke script fails if the designs folder or the
  temp folder differ afterwards. Keep it that way: a new check must not write to `designs/`, steal
  focus, or leave a process running.
- **Do not relaunch or close the owner's running app** to show a change. Verify in a second
  instance, then say whether they need Ctrl+R (a change to the page) or a restart (a change under
  `electron/`).
- A change to the window waits for the owner to look at it before it is committed.

## Deploying the web version

`npm run deploy` runs every check, uploads `dist/` to the one Azure Static Web App, and verifies
the live files against the build by hash. See `readme.md` for what it needs.

- **One site only.** Never create a second site, app or environment for this project.
- **Deploy after a change to the app is checked**, and report the hash verification.
- **Move the version on by the nature of the change**: `--bump=patch` for a fix, `--bump=minor`
  for something new, `--bump=major` when saved designs would open differently. No bump only when
  putting the same thing up again. Say which bump was used and the new number; the bump edits
  `package.json` and `package-lock.json`, which go in the commit with the change.
- **Check which account is signed in before any Azure command** that changes something, and stop
  if it is not the owner's own subscription.
- **The deployment token is never printed, logged, written to a file or put on a command line.**
- Deleting anything in Azure, and anything that costs money, needs the owner's explicit yes.

## Secrets and privacy

The repository is public.

- Never commit a credential, a token, a subscription or tenant identifier, a machine path with a
  user name in it, or anyone's email address.
- Search what is staged for such things before every commit, and read the result.
- Nothing about the owner beyond what the About box already says belongs in a file or a commit
  message.

## Scripting standards

- Prefer a reusable script with explicit parameters over ad-hoc commands and UI automation, and
  suggest one when a process is repeated. Do not let a suggestion delay work already agreed.
- Process scripts report measured per-phase and total wall time, including failed phases, from a
  monotonic clock, and offer a `--plan` that says what would happen and changes nothing.
- A script that rewrites a file computes the whole new text first and opens the file for writing
  only then, so a failed check cannot leave it empty.
- Verify by hash, not by exit code, whenever files are copied, uploaded or regenerated in bulk.

## Markdown

Wrap at about 100 characters (150 is the ceiling), a language on every fenced block, blank lines
round headings and fences, a table for anything with more than two columns. The spelling
dictionary is `cspell.json`: add a real word there; fix a misspelling in the text. Summaries and
status files state the date they were last true.

## Git

- Small changes go straight to `main`. A change large enough that the owner would want to review
  it as a unit goes on a branch and a pull request.
- Commit messages: `<area>: <what changed and why>`. Areas: `model`, `ui`, `view`, `desktop`,
  `deploy`, `test`, `docs`, `fix`.
- Stage only what the task touched. Never `git add --all`.
- Commit and push only when the owner asks.
- Every change to the app adds a line to the readme where the feature is described, in the same
  commit.

## Evidence integrity

Do not claim something works because it looks right.

- Run it, or say plainly that you did not.
- Quote real output when reporting a result. Never invent or predict command output.
- Distinguish "verified" from "should work". If a check was skipped, say which and why.
- When a command fails, report the failure and the actual error text.

## Task completion and capability evidence

- At the start, note the end state the owner asked for. Intermediate edits and diagnostic checks
  are progress, not completion.
- Apply the latest explicit instruction when it supersedes an earlier one; do not ask again for
  permission already given.
- Before declaring a capability unavailable, try it. A remembered failure or a limitation of
  another tool does not establish that. Record an observed failure with the tool, the actual error
  and what was tried.
- Before ending a task, compare the end state asked for with what was done and the evidence for
  it. Continue while a supported path remains. If a gate is truly blocked, name the tested
  failure, what remains, and the smallest handoff. Never quietly replace the outcome asked for
  with an intermediate one.
- After a source change, anything built from it is stale until it is rebuilt and checked. An
  existing file, a matching name or an earlier pass does not prove the current state.

## Workflow compliance and reporting

Reading these rules is not evidence of following them.

- Do not substitute a familiar tool or a passing automated check for a review that was asked for.
  If a step cannot be done, say so before going past it.
- When asked whether the rules were followed, audit what was actually done against each one and
  report done, skipped and unverified, with evidence. No blanket assurances.
- A completion claim describes the verified state: source edited, tests passed, window checked,
  deployed and verified by hash, looked at by the owner. Say which of these are true.

## Communication

- Be direct and honest, not agreeable. Do not open with praise or agreement.
- If an approach is wrong or worse than another, say so plainly, and say what you would do.
- Write for a woodworker when describing the app, and for a programmer when describing the code.
