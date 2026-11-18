import { describe, expect, it } from 'vitest';
import type { FogLayer, Inversion } from '../../shared/inversion.ts';
import { airNoteHtml } from '../src/air.ts';

const AT = '2026-11-18T08:40:00Z';
const NOW = Date.parse('2026-11-18T09:00:00Z');
const fog: FogLayer = { kind: 'fog', cloudTopM: 1100, clearFromM: 1310, cloudBelow: 5, below: 5, clearAbove: 3, above: 3, sunAbove: 3, warmerC: 4, stations: 10, observedAt: AT };
const inv: Inversion = { kind: 'inversion', valleyM: 250, topM: 1050, warmerC: 6, stations: 7, observedAt: AT };

describe('fog and inversion note', () => {
  it('says how high the fog goes and where the sun starts, with the reading time', () => {
    const html = airNoteHtml(fog, NOW);
    expect(html).toContain('Fog or low cloud up to about 1,100 m');
    expect(html).toContain('Sun from about 1,400 m, 4 °C warmer.');
    expect(html).toContain('Stations within 20 km, read at 09:40.');
  });

  it('does not promise sun when no station up there measured it', () => {
    const html = airNoteHtml({ ...fog, sunAbove: 0, warmerC: null }, NOW);
    expect(html).toContain('Drier air from about 1,400 m, but no sun measured up there.');
    expect(html).not.toContain('Sun from');
  });

  it('keeps the clear height above the rounded fog top', () => {
    expect(airNoteHtml({ ...fog, cloudTopM: 1460, clearFromM: 1480 }, NOW)).toContain('Sun from about 1,600 m');
  });

  it('describes an inversion', () => {
    const html = airNoteHtml(inv, NOW);
    expect(html).toContain('Inversion: 6 °C warmer at about 1,100 m');
    expect(html).toContain('Than in the valley at about 300 m.');
  });

  it('shows nothing for old readings or no layer', () => {
    expect(airNoteHtml(fog, NOW + 7 * 3_600_000)).toBe('');
    expect(airNoteHtml(null, NOW)).toBe('');
  });
});
