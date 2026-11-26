import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, shownVersion } from './version';

describe('the version the About box shows', () => {
  it('is the one in package.json, with a final .0 left off', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe(shownVersion(pkg.version));
    // The lock file says the same, or an install would put the old number back.
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { version: string; packages: Record<string, { version: string }> };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('reads 0.9.0 as 0.9, and keeps a patch number that is not zero', () => {
    expect(shownVersion('0.9.0')).toBe('0.9');
    expect(shownVersion('0.9.1')).toBe('0.9.1');
    expect(shownVersion('0.10.0')).toBe('0.10');
    expect(shownVersion('1.0.0')).toBe('1.0');
    expect(shownVersion('1.2.3')).toBe('1.2.3');
  });
});
