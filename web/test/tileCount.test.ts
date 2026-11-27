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
