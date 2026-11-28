import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { releaseKind } from './release-kind.mjs';

describe('the kind of release a commit subject calls for', () => {
  it('follows the area: a fix is a patch, something new in the app is minor, and what nobody using it sees is no release', () => {
    expect(releaseKind('fix: the board no longer finishes a block short')).toBe('patch');
    for (const area of ['model', 'ui', 'view', 'desktop']) expect(releaseKind(`${area}: something new`), area).toBe('minor');
    for (const area of ['docs', 'test', 'deploy']) expect(releaseKind(`${area}: nothing to see`), area).toBe('none');
    // The number GitHub adds to a squashed pull request changes nothing.
    expect(releaseKind("ui: sizes in the design's units (#3)")).toBe('minor');
    expect(releaseKind('UI: capitals are the same area')).toBe('minor');
  });

  it('takes a mark in square brackets over the area', () => {
    expect(releaseKind('model: design files are version 3 [major]')).toBe('major');
    expect(releaseKind('docs: the readme, and a fix that rode along [patch]')).toBe('patch');
    expect(releaseKind('fix: a new step, really [minor]')).toBe('minor');
    expect(releaseKind('ui: not ready to go out [no release]')).toBe('none');
  });

  it('releases a patch for a subject it cannot read, so a change is not left unpublished', () => {
    expect(releaseKind('Merge pull request #1 from someone/branch')).toBe('patch');
    expect(releaseKind('cutting-boards: an older subject')).toBe('patch');
    expect(releaseKind('no area at all')).toBe('patch');
  });

  it('run as a program prints the kind for the subject it is given', () => {
    const script = fileURLToPath(new URL('./release-kind.mjs', import.meta.url));
    const out = spawnSync(process.execPath, [script, 'fix: a typo'], { encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('patch');
  });
});
