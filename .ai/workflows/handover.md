# Handover Workflow

**Purpose:** end a working session so the next one can pick it up cold.

Before running this, read `.ai/ai-rules.md`. This file only says what to do at the end of a
session. If a step below cannot be run, say so; do not describe what it would have said.

---

## Step 1: Verify

```sh
npm run check
```

Read the result and record the counts. If the app changed and the owner asked for it to be
deployed, confirm the deploy reported that every live file matches the build.

For every function changed this session, confirm its comment still says what it does. For every
feature added, confirm it has a test and a line in `readme.md`.

---

## Step 2: Session summary

Write `.ai/sessions/SESSION_SUMMARY-{YYYY-MM-DD}-{hhmm}.md`.

Skip it for a session that changed nothing worth remembering. Otherwise cover:

- **What changed**, with paths.
- **Decisions, and why**, including alternatives rejected and what it costs to be wrong.
- **Traps found by running things.** The highest-value section. Something that behaved
  differently from how it reads belongs here, once.
- **What is unfinished**, and what state it was left in.
- **Open questions** that need a person.
- **Next session**: the ordered list, most important first.

The repository is public: a session summary names no account, no identifier, no machine path and
nothing about the owner.

Then bring `.ai/project-summary.md` into line with reality, with its date.

---

## Step 3: Commit

Only if the owner asked for a commit. Stage only the files the session touched; never
`git add --all`. Group changes into commits that each stand on their own. `.ai/ai-rules.md` holds
the message conventions. Include the session summary in the last commit.
