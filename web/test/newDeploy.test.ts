import { describe, expect, it } from 'vitest';
import { GUARD_MS, mayReload } from '../src/app/newDeploy.ts';

describe('reload after a deploy', () => {
  it('reloads when it has not reloaded before', () => {
    expect(mayReload(null, 1_000_000)).toBe(true);
  });

  it('does not reload again within a minute, so a missing file cannot loop', () => {
    expect(mayReload(1_000_000, 1_000_000 + GUARD_MS - 1)).toBe(false);
    expect(mayReload(1_000_000, 1_000_000 + GUARD_MS)).toBe(true);
  });

  it('treats a stored time in the future (a changed clock) as recent', () => {
    expect(mayReload(2_000_000, 1_000_000)).toBe(false);
  });
});
