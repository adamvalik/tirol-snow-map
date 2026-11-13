import { describe, expect, it } from 'vitest';
import type { RegionsFile } from '../../shared/types.ts';
import { buildRegions, localName, serviceFor, simplifyLine } from '../../pipeline/src/regions.ts';
import file from '../src/data/regions.json';
import { bulletinLink, regionAt } from '../src/regions.ts';

const regions = file as unknown as RegionsFile;

describe('regions.json lookup', () => {
  it('finds the warning region of known places', () => {
    const at = (lon: number, lat: number) => regionAt(regions, lon, lat)?.id.slice(0, 8) ?? null;
    expect(at(10.775, 46.757)).toBe('IT-32-BZ'); // Kurzras, Schnals valley
    expect(at(11.39, 47.265)).toMatch(/^AT-07-/); // Innsbruck
    expect(regionAt(regions, 12.135, 46.54)?.id).toBe('IT-34-BL-02'); // Cortina d'Ampezzo
    expect(regionAt(regions, 0, 0)).toBeNull();
  });

  it('links Euregio regions to avalanche.report and others to their own service', () => {
    const schnals = bulletinLink(regions, 10.775, 46.757);
    expect(schnals.href).toBe('https://avalanche.report/bulletin/latest');
    expect(schnals.region).toMatch(/^Schnals Ridge \(Schnalser Kamm \/ Cresta di Senales\), IT-32-BZ-03$/);
    const cortina = bulletinLink(regions, 12.135, 46.54);
    expect(cortina).toMatchObject({ service: 'AINEVA Veneto', href: 'https://bollettini-en.aineva.it' });
    expect(bulletinLink(null, 11.35, 46.5)).toEqual({ href: 'https://avalanche.report', region: null, service: 'avalanche.report' });
  });

  it('covers the whole data area without gaps at the stations', () => {
    // Every station-sized step of a 0.05° lattice over South Tyrol finds a region.
    const misses: string[] = [];
    for (let lon = 10.5; lon <= 12.4; lon += 0.05)
      for (let lat = 46.25; lat <= 47.05; lat += 0.05) if (!regionAt(regions, lon, lat)) misses.push(`${lon.toFixed(2)},${lat.toFixed(2)}`);
    expect(misses).toEqual([]);
  });
});

describe('building regions.json', () => {
  it('simplifies a line within the tolerance', () => {
    expect(simplifyLine([[0, 0], [1, 0.0001], [2, 0], [3, 1]], 0.001)).toEqual([[0, 0], [2, 0], [3, 1]]);
  });

  it('picks the most specific service and the local names', () => {
    expect(serviceFor('IT-25-SO-LI', ['IT-25', 'IT-25-SO-LI'])).toBe('IT-25-SO-LI');
    expect(serviceFor('IT-25-SO-03', ['IT-25', 'IT-25-SO-LI'])).toBe('IT-25');
    expect(serviceFor('IT-2501', ['IT-25'])).toBeNull();
    const names = { en: { 'IT-32-BZ-03': 'Schnals Ridge', 'CH-7111': 'Corvatsch' }, de: { 'IT-32-BZ-03': 'Schnalser Kamm', 'CH-7111': 'Corvatsch' }, it: { 'IT-32-BZ-03': 'Cresta di Senales' } };
    expect(localName('IT-32-BZ-03', names)).toBe('Schnalser Kamm / Cresta di Senales');
    expect(localName('CH-7111', names)).toBeUndefined();
  });

  it('keeps current regions in the area, with their services', () => {
    const square = (x: number, y: number) => [[[x, y], [x + 0.2, y], [x + 0.2, y + 0.2], [x, y + 0.2], [x, y]]];
    const out = buildRegions({
      collections: [
        {
          features: [
            { type: 'Feature', properties: { id: 'IT-32-BZ-03' }, geometry: { type: 'Polygon', coordinates: square(10.8, 46.7) } },
            { type: 'Feature', properties: { id: 'IT-32-BZ-99', end_date: '2022-10-01' }, geometry: { type: 'Polygon', coordinates: square(10.8, 46.7) } },
            { type: 'Feature', properties: { id: 'IT-34-BL-09' }, geometry: { type: 'Polygon', coordinates: square(13.5, 46.0) } },
          ],
        },
      ],
      services: [{ id: 'IT-32-BZ', aws: [{ name: 'AINEVA Bozen', url: { en: 'https://avalanche.report' } }] }, { id: 'IT-34' }],
      names: { en: { 'IT-32-BZ-03': 'Schnals Ridge' }, de: {}, it: {} },
      area: [10.2, 46.1, 12.7, 47.25],
      date: '2026-11-13',
    });
    expect(out.regions.map((r) => r.id)).toEqual(['IT-32-BZ-03']);
    expect(out.services).toEqual({ 'IT-32-BZ': { name: 'avalanche.report', url: 'https://avalanche.report/bulletin/latest' } });
  });
});
