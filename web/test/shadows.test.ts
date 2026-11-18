import { describe, expect, it } from 'vitest';
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
