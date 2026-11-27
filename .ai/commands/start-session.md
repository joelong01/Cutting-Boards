# Start Session Command

> **Important:** read `.ai/ai-rules.md` first. It is the single source of truth for this
> repository's conventions and governs everything below.

## What this repository is

One TypeScript program, Cutting Boards, built as an Electron desktop app and as a web page. Two
things are easy to get wrong:

- **The recipes are for a person at a bench.** Read "What the app must be for the person at the
  bench" in the rules before touching a recipe.
- **Tests leave no trace**, and the owner's running app is never relaunched.

## 1. Get oriented

Read, in this order:

- `.ai/project-summary.md`: where the project stands and what is next. Start here.
- `.ai/sessions/`: the most recent `SESSION_SUMMARY-{date}-{hhmm}.md`, if any, for what the last
  session was in the middle of.
- `readme.md`: what the app does and how it models wood.

Then look at the ground truth:

```sh
git status
git log --oneline -10
```

## 2. Check that it builds and passes

```sh
npm install      # only if node_modules is missing or package-lock.json changed
npm run check    # the model tests, then the window checks
```

Report the counts it prints. If it fails before any change was made, say so first.

## Notes

- Do not declare work complete without running it. Quote what actually ran, or say you did not.
- Commit, push and deploy only when the owner asks.
