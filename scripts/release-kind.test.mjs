import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { releaseKind, releaseKindOf } from './release-kind.mjs';

describe('the kind of release a commit subject calls for', () => {
  it('follows the area: a fix is a patch, something new in the app is minor, and what nobody using it sees is no release', () => {
    expect(releaseKind('fix: the board no longer finishes a block short')).toBe('patch');
    for (const area of ['model', 'ui', 'view', 'desktop']) expect(releaseKind(`${area}: something new`), area).toBe('minor');
    for (const area of ['docs', 'test', 'deploy']) expect(releaseKind(`${area}: nothing to see`), area).toBe('none');
    // The number GitHub adds to a squashed pull request changes nothing.
    expect(releaseKind("ui: sizes in the design's units (#3)")).toBe('minor');
    expect(releaseKind('UI: capitals are the same area')).toBe('minor');
    // The commit the release workflow makes for itself releases nothing.
    expect(releaseKind('deploy: release 0.10.0')).toBe('none');
  });

  it('takes a mark in square brackets at the end of the subject over the area, and only there', () => {
    expect(releaseKind('model: design files are version 3 [major]')).toBe('major');
    expect(releaseKind('docs: the readme, and a fix that rode along [patch]')).toBe('patch');
    expect(releaseKind('fix: a new step, really [minor]')).toBe('minor');
    expect(releaseKind('ui: not ready to go out [no release]')).toBe('none');
    // After the mark may come the number of the pull request, and nothing else.
    expect(releaseKind('model: design files are version 3 [major] (#12)')).toBe('major');
    // A subject that only mentions a mark is not obeyed.
    expect(releaseKind('docs: say when to use [major] in a subject')).toBe('none');
    expect(releaseKind('fix: [no release] was read in the middle of a subject')).toBe('patch');
  });

  it('releases a patch for a subject it cannot read, so a change is not left unpublished', () => {
    expect(releaseKind('cutting-boards: an older subject')).toBe('patch');
    expect(releaseKind('no area at all')).toBe('patch');
  });

  it('releases several commits together as the largest of their kinds', () => {
    // A new tile landed, its release failed, and the commit that steadied the check came after.
    expect(releaseKindOf(['test: steady the check', 'ui: a new tile'])).toBe('minor');
    expect(releaseKindOf(['fix: one thing', 'docs: words', 'fix: another'])).toBe('patch');
    expect(releaseKindOf(['docs: words', 'model: version 3 of design files [major]', 'ui: a tile'])).toBe('major');
    expect(releaseKindOf(['docs: words', 'deploy: release 0.10.0'])).toBe('none');
    expect(releaseKindOf([])).toBe('none');
  });

  it('passes over the subject of a merge and reads the commits it brought in', () => {
    // Merged with a merge commit: git's own subject says nothing of what was merged.
    expect(releaseKindOf(['Merge pull request #18 from someone/release-workflow', 'deploy: a workflow that releases'])).toBe('none');
    expect(releaseKindOf(['Merge pull request #3 from someone/units', 'ui: sizes in the design\'s units', 'docs: the readme'])).toBe('minor');
    expect(releaseKindOf(["Merge branch 'main' into units", 'fix: a typo'])).toBe('patch');
    // A merge with nothing else to go on is still released.
    expect(releaseKindOf(['Merge pull request #1 from someone/branch'])).toBe('patch');
  });

  it('run as a program prints the kind for the subject it is given', () => {
    const script = fileURLToPath(new URL('./release-kind.mjs', import.meta.url));
    const out = spawnSync(process.execPath, [script, 'fix: a typo'], { encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('patch');
  });
});
