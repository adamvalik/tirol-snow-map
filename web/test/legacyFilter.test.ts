import { convertFilter as specConvert, expression } from '@maplibre/maplibre-gl-style-spec';
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { FilterSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { convertFilter, isExpressionFilter } from '../src/legacyFilter.ts';

// The port in legacyFilter.ts must give the style spec's own answers.
const same = (filter: unknown) => {
  expect(isExpressionFilter(filter)).toBe(expression.isExpressionFilter(filter));
  expect(convertFilter(filter as FilterSpecification)).toEqual(specConvert(structuredClone(filter) as FilterSpecification));
};

describe('legacyFilter', () => {
  it('converts every filter of the basemap style as the style spec does', () => {
    const filters = layers('protomaps', namedFlavor('light'), { lang: 'en' }).flatMap((l) => ('filter' in l && l.filter ? [l.filter] : []));
    expect(filters.some((f) => !expression.isExpressionFilter(f))).toBe(true);
    for (const f of filters) same(f);
  });

  it('converts the other legacy forms as the style spec does', () => {
    const cases: unknown[] = [
      ['==', '$type', 'Point'],
      ['==', '$id', 3],
      ['==', 'name', null],
      ['!=', 'name', null],
      ['<', 'ele', 2000],
      ['>=', 'ele', 1000],
      ['in', 'kind', 'b', 'a', 'b'],
      ['in', 'kind', 'a', 1],
      ['!in', 'kind', 'a', 'b'],
      ['!in', 'kind', true, 1],
      ['in', 'kind'],
      ['has', '$id'],
      ['has', '$type'],
      ['!has', 'name'],
      ['all', ['==', 'kind', 'peak']],
      ['all', ['==', 'kind', 'peak'], ['>', 'ele', 3000]],
      ['any', ['==', 'kind', 'peak'], ['<', 'ele', 100]],
      ['none', ['==', 'kind', 'peak'], ['has', 'ele']],
      ['any'],
      ['all'],
      ['==', ['get', 'kind'], 'peak'],
      ['in', ['get', 'kind'], ['literal', ['a']]],
      true,
    ];
    for (const f of cases) same(f);
  });
});
