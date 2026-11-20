import { describe, expect, it, vi } from 'vitest';
import { lonLatToPixel } from '../../shared/terrarium.ts';
import { MODEL_GRID } from '../../shared/grid.ts';
import { detailBlock } from '../src/shadows.ts';

describe('finer shadows around the view', () => {
  it('leaves them out when zoomed out', () => {
    expect(detailBlock(9, 11.354, 46.498)).toBeNull();
  });

  it('takes 2 × 2 tiles round the centre, about a screen pixel each, at most zoom 12', () => {
    const b = detailBlock(11.2, 11.354, 46.498)!;
    expect(b).toMatchObject({ z: 10, nx: 2, ny: 2 });
    const c = lonLatToPixel(11.354, 46.498, 10);
    expect(c.px / 512).toBeGreaterThanOrEqual(b.x);
    expect(c.px / 512).toBeLessThan(b.x + 2);
    expect(c.py / 512).toBeGreaterThanOrEqual(b.y);
    expect(c.py / 512).toBeLessThan(b.y + 2);
    expect(detailBlock(15, 11.354, 46.498)!.z).toBe(12);
  });

  it('stays on tiles that touch the grid at its edge', () => {
    const b = detailBlock(12.6, MODEL_GRID.west + 0.01, 46.6)!;
    expect(b.x).toBe(Math.floor(lonLatToPixel(MODEL_GRID.west, 46.6, b.z).px / 512));
  });
});

describe('shade when the worker fails', () => {
  // Stand-ins for the map and the Web Worker: enough for ShadowLayer to ask for one shade.
  const fakeMap = () =>
    ({
      addSource() {},
      addLayer() {},
      setLayoutProperty() {},
      getSource: () => ({ updateImage() {} }),
      getCenter: () => ({ lng: 11.35, lat: 46.5 }),
      getZoom: () => 8,
    }) as unknown as import('maplibre-gl').Map;
  class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    sent: { type: string; id?: number }[] = [];
    terminated = false;
    constructor() {
      FakeWorker.last = this;
    }
    postMessage(m: { type: string; id?: number }) {
      this.sent.push(m);
    }
    terminate() {
      this.terminated = true;
    }
  }
  const grid = { values: new Int16Array(4) } as unknown as import('../src/terrainSampler.ts').Grid;
  const look = { color: [22, 38, 96] as const, opacity: 0.4 };
  // Midday in December: the sun is up over the whole region.
  const noon = Date.UTC(2026, 11, 21, 11, 0);

  it('changes the light and stops waiting when the worker answers with an error', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { ShadowLayer } = await import('../src/shadows.ts');
    const layer = new ShadowLayer(fakeMap(), undefined, 'https://tiles/{z}/{x}/{y}.webp');
    const failed: string[] = [];
    layer.onFailed = (r) => failed.push(r);
    let lit = 0;
    expect(layer.show(grid, noon, 180, look, false, () => lit++)).toBe(true);
    expect(layer.busy).toBe(true);
    const worker = FakeWorker.last!;
    const id = worker.sent.find((m) => m.type === 'sun')!.id!;
    worker.onmessage!({ data: { id, error: 'out of memory' } });
    expect(lit).toBe(1);
    expect(layer.busy).toBe(false);
    expect(failed).toEqual(['out of memory']);
    expect(worker.terminated).toBe(true);
    // From then on only the light changes, at once.
    layer.show(grid, noon + 600_000, 182, look, false, () => lit++);
    expect(lit).toBe(2);
    expect(layer.busy).toBe(false);
    vi.unstubAllGlobals();
  });

  it('gives up after a while when the worker does not answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const { ShadowLayer, SHADE_TIMEOUT_MS } = await import('../src/shadows.ts');
    const layer = new ShadowLayer(fakeMap(), undefined, 'https://tiles/{z}/{x}/{y}.webp');
    let lit = 0;
    layer.show(grid, noon, 180, look, false, () => lit++);
    vi.advanceTimersByTime(SHADE_TIMEOUT_MS - 1);
    expect(lit).toBe(0);
    vi.advanceTimersByTime(1);
    expect(lit).toBe(1);
    expect(layer.busy).toBe(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
