import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// nearFirst.ts keeps its gate in the module, so each test loads a fresh copy.
const load = async () => {
  vi.resetModules();
  const m = await import('../src/nearFirst.ts');
  m.watchZoom({ getZoom: () => 10.4, on: () => undefined });
  return m;
};

/** A tile load that ends when `finish` is called. */
function pending() {
  let finish!: () => void;
  const done = new Promise<string>((resolve) => (finish = () => resolve('tile')));
  return { done, finish };
}

describe('nearFirst', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts tiles three zoom levels or more below the view as far', async () => {
    const { isFar } = await load();
    expect(isFar(10, 10.4)).toBe(false);
    expect(isFar(8, 10.4)).toBe(false);
    expect(isFar(7, 10.4)).toBe(true);
    expect(isFar(11, 13)).toBe(false);
    expect(isFar(10, 13)).toBe(true);
  });

  it('holds the far tiles until the near ones are in', async () => {
    const { nearFirst, onNearLoaded } = await load();
    const signal = new AbortController().signal;
    const near = pending();
    const farLoad = vi.fn(async () => 'far tile');
    const opened = vi.fn();
    onNearLoaded(opened);

    const nearTile = nearFirst(10, signal, () => near.done);
    const farTile = nearFirst(5, signal, farLoad);
    await vi.advanceTimersByTimeAsync(1000);
    expect(farLoad).not.toHaveBeenCalled();

    near.finish();
    await expect(nearTile).resolves.toBe('tile');
    expect(farLoad).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(opened).toHaveBeenCalledOnce();
    await expect(farTile).resolves.toBe('far tile');

    // Open for good: a later far tile loads at once.
    await expect(nearFirst(5, signal, async () => 'later')).resolves.toBe('later');
  });

  it('waits for a near tile that starts while the last one ends', async () => {
    const { nearFirst, onNearLoaded } = await load();
    const signal = new AbortController().signal;
    const opened = vi.fn();
    onNearLoaded(opened);
    const first = pending();
    const second = pending();
    void nearFirst(10, signal, () => first.done);
    first.finish();
    await vi.advanceTimersByTimeAsync(100);
    void nearFirst(9, signal, () => second.done);
    await vi.advanceTimersByTimeAsync(1000);
    expect(opened).not.toHaveBeenCalled();
    second.finish();
    await vi.advanceTimersByTimeAsync(300);
    expect(opened).toHaveBeenCalledOnce();
  });

  it('lets the far tiles go after 30 s in any case', async () => {
    const { nearFirst } = await load();
    const farLoad = vi.fn(async () => 'far tile');
    void nearFirst(10, new AbortController().signal, () => new Promise<string>(() => undefined));
    const farTile = nearFirst(5, new AbortController().signal, farLoad);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(farLoad).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(farTile).resolves.toBe('far tile');
  });

  it('drops a held tile when its request is aborted', async () => {
    const { nearFirst } = await load();
    const abort = new AbortController();
    const farLoad = vi.fn(async () => 'far tile');
    const farTile = nearFirst(5, abort.signal, farLoad);
    abort.abort();
    await expect(farTile).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(farLoad).not.toHaveBeenCalled();
  });
});
