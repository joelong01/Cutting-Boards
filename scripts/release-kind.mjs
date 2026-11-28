#!/usr/bin/env node
/**
 * Say how far a change moves the version on, from the subject of its commit, so that a release
 * can be made without anyone choosing a number.
 *
 *   node scripts/release-kind.mjs                   the kind for the last commit on this branch
 *   node scripts/release-kind.mjs "fix: a typo"     the kind for that subject
 *
 * It prints one word: major, minor, patch or none.
 *
 * Commit subjects here are `<area>: <what changed and why>` (see .ai/ai-rules.md), and the area
 * says what kind of change it is:
 *
 *   fix                        patch   something that was wrong now works
 *   model, ui, view, desktop   minor   something new in the app
 *   docs, test, deploy         none    nothing a person using the app would see
 *   anything else              patch   better a release too many than a change left unpublished
 *
 * A mark in square brackets anywhere in the subject overrides the area: [major] when saved
 * designs would open differently, [minor], [patch], or [no release].
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What each area of a commit subject means for the version. */
const BY_AREA = {
  fix: 'patch',
  model: 'minor', ui: 'minor', view: 'minor', desktop: 'minor',
  docs: 'none', test: 'none', deploy: 'none',
};

/** The kind of release a commit subject calls for: major, minor, patch or none. */
export function releaseKind(subject) {
  const mark = /\[(major|minor|patch|no release)\]/i.exec(subject)?.[1].toLowerCase();
  if (mark) return mark === 'no release' ? 'none' : mark;
  const area = /^\s*([a-z-]+):/i.exec(subject)?.[1].toLowerCase();
  return BY_AREA[area] ?? 'patch';
}

// Run as a program, not imported: print the kind for the subject given, or for the last commit.
// Windows does not care about the case of a path, and the two can differ in the drive letter's.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const given = process.argv.slice(2).join(' ');
  const subject = given || spawnSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout.trim();
  if (!subject) {
    console.error('No commit subject to read: give one, or run this in the repository.');
    process.exit(2);
  }
  console.log(releaseKind(subject));
}
