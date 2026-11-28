#!/usr/bin/env node
/**
 * Say how far the changes waiting to be released move the version on, from the subjects of
 * their commits, so that a release can be made without anyone choosing a number.
 *
 *   node scripts/release-kind.mjs                   every commit since the last version tag
 *   node scripts/release-kind.mjs "fix: a typo"     that one subject
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
 * A mark in square brackets at the end of the subject overrides the area: [major] when saved
 * designs would open differently, [minor], [patch], or [no release]. At the end only, so that a
 * subject which merely mentions a mark is not obeyed.
 *
 * Several commits are released together as the largest of their kinds: a `ui:` change that
 * landed before a `test:` one is still a minor release. The subject git writes for a merge
 * ("Merge pull request…") says nothing about what was merged, so it is passed over, and the
 * commits it brought in are read in its place.
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
/** The kinds of release, smallest first. */
const KINDS = ['none', 'patch', 'minor', 'major'];

/** The kind of release one commit subject calls for: major, minor, patch or none. */
export function releaseKind(subject) {
  // A squashed pull request's subject ends with its number, after any mark.
  const mark = /\[(major|minor|patch|no release)\]\s*(\(#\d+\))?\s*$/i.exec(subject)?.[1].toLowerCase();
  if (mark) return mark === 'no release' ? 'none' : mark;
  const area = /^\s*([a-z-]+):/i.exec(subject)?.[1].toLowerCase();
  return BY_AREA[area] ?? 'patch';
}

/**
 * The kind of release several commits call for together: the largest of their kinds. Merge
 * subjects are passed over; with nothing else to go on, a merge is a patch. No commits at all
 * is no release.
 */
export function releaseKindOf(subjects) {
  const own = subjects.filter((s) => !/^Merge (pull request|branch|remote-tracking branch|tag) /.test(s));
  if (!own.length) return subjects.length ? 'patch' : 'none';
  return own.map(releaseKind).reduce((most, kind) => (KINDS.indexOf(kind) > KINDS.indexOf(most) ? kind : most), 'none');
}

/** A git command's output, trimmed, or an empty string when it fails. */
function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

/**
 * The subjects of the commits not yet released: those since the nearest version tag (`v…`) in
 * this branch's history, or the last commit alone when there is no such tag. It needs the whole
 * history and the tags, which a shallow checkout does not have.
 */
function unreleased() {
  const last = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
  const log = last ? git('log', `${last}..HEAD`, '--format=%s') : git('log', '-1', '--format=%s');
  return log ? log.split(/\r?\n/) : [];
}

// Run as a program, not imported: print the kind for the subject given, or for what is unreleased.
// Windows does not care about the case of a path, and the two can differ in the drive letter's.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const given = process.argv.slice(2).join(' ');
  if (!given && !git('rev-parse', 'HEAD')) {
    console.error('No commits to read: give a subject, or run this in the repository.');
    process.exit(2);
  }
  console.log(given ? releaseKind(given) : releaseKindOf(unreleased()));
}
