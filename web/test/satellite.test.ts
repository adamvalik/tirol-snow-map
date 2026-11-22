import { describe, expect, it } from 'vitest';
import type { SatelliteFile } from '../../shared/types.ts';
import { passRole, satelliteInfoHtml } from '../src/satellite.ts';

const NOW = Date.parse('2026-11-22T10:30:00Z');
const file: SatelliteFile = {
  schemaVersion: 1,
  generatedAt: '2026-11-18T19:20:11Z',
  available: true,
  date: '2026-11-18',
  coverage: 1,
  clearShare: 0.635,
  fallbackDate: '2026-11-15',
  shares: { main: 0.546, fallback: 0.226, empty: 0.228 },
  checkedAt: '2026-11-22T06:10:00Z',
  minClearShare: 0.45,
  passes: [
    { date: '2026-11-21', coverage: 0.59, clearShare: 0.2 },
    { date: '2026-11-20', coverage: 0.01, clearShare: 0 },
    { date: '2026-11-18', coverage: 1, clearShare: 0.635 },
    { date: '2026-11-15', coverage: 0.98, clearShare: 0.42 },
  ],
  attribution: 'Copernicus',
};

describe('satellite info in the About tab', () => {
  it('says what each pass was used for, or why not', () => {
    expect(file.passes!.map((p) => passRole(p, file))).toEqual(['Too cloudy', 'Edge of the region only', 'Picture', 'Fill-in']);
  });

  it('shows the picture day, its make-up and the passes', () => {
    const html = satelliteInfoHtml(file, NOW);
    expect(html).toContain('pass with a mostly clear view, 18 Nov (4 days ago)');
    expect(html).toContain('<dt>18 Nov</dt><dd>55 %<small>picture</small>');
    expect(html).toContain('<dt>15 Nov</dt><dd>23 %<small>fill-in</small>');
    expect(html).toContain('<dt>Empty</dt><dd>23 %');
    expect(html).toContain('<tr class="used"><td>18 Nov</td><td>100 %</td><td>64 %</td><td>Picture</td></tr>');
    expect(html).toContain('<tr><td>20 Nov</td><td>1 %</td><td>0 %</td><td>Edge of the region only</td></tr>');
    expect(html).toContain('becomes the picture from 45 % clear');
    expect(html).toContain('(4 h ago)');
  });

  it('still reads a file from before the passes were kept', () => {
    const { passes, checkedAt, minClearShare, ...old } = file;
    void [passes, checkedAt, minClearShare];
    const html = satelliteInfoHtml(old, NOW);
    expect(html).toContain('<dl class="facts">');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('looked for');
  });

  it('says why there is no picture', () => {
    expect(satelliteInfoHtml({ schemaVersion: 1, generatedAt: '', available: false, reason: 'No clear day', attribution: '' })).toContain('not available (No clear day)');
  });
});
