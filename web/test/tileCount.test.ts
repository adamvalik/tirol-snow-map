import { describe, expect, it, vi } from 'vitest';
import { counted, onTileCount } from '../src/tileCount.ts';

describe('tileCount', () => {
  it('counts tiles asked for and in, failed ones as in', async () => {
    const seen: string[] = [];
    const stop = onTileCount((done, asked) => seen.push(`${done}/${asked}`));
    let finish!: (v: string) => void;
    const a = counted(new Promise<string>((resolve) => (finish = resolve)));
    const b = counted(Promise.reject(new Error('404')));
    await expect(b).rejects.toThrow('404');
    finish('tile');
    await expect(a).resolves.toBe('tile');
    expect(seen).toEqual(['0/1', '0/2', '1/2', '2/2']);

    stop();
    const listener = vi.fn();
    onTileCount(listener);
    await counted(Promise.resolve(1));
    expect(listener).toHaveBeenLastCalledWith(3, 3);
  });
});

describe('progressShare', async () => {
  const { progressShare } = await import('../src/app/mapLoading.ts');

  it('fills with the tiles, up to 95 % before the map is done', () => {
    expect(progressShare(0, 0, 0)).toBe(0);
    expect(progressShare(5, 10, 0)).toBeCloseTo(0.475);
    expect(progressShare(10, 10, 0)).toBeCloseTo(0.95);
  });

  it('never goes back when more tiles are asked for', () => {
    const before = progressShare(9, 10, 0);
    expect(progressShare(9, 20, before)).toBe(before);
    expect(progressShare(19, 20, before)).toBeGreaterThan(before);
  });
});
