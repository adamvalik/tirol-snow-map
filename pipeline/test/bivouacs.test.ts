import { describe, expect, it } from 'vitest';
import { bivouacKind, parseBivouacs } from '../src/bivouacs.ts';

const node = (id: number, tags: Record<string, string>, lat = 46.5, lon = 11.3) => ({ type: 'node' as const, id, lat, lon, tags });

describe('parseBivouacs', () => {
  it('keeps public huts named bivouac, highest first, with numbers parsed', () => {
    const out = parseBivouacs({
      elements: [
        node(1, { tourism: 'wilderness_hut', name: 'Bivacco Rossi', ele: '2650', capacity: '9' }),
        node(2, { tourism: 'wilderness_hut', name: 'Hochjochbiwak', ele: '3535,5' }),
        node(3, { tourism: 'wilderness_hut', name: 'Grünseehütte', ele: '2235' }),
        node(4, { tourism: 'wilderness_hut', name: 'Biwak privat', access: 'private' }),
        { type: 'way', id: 5, center: { lat: 46.123456, lon: 11.987654 }, tags: { amenity: 'shelter', name: 'Bivouac X', beds: '4' } },
        node(1, { tourism: 'wilderness_hut', name: 'Bivacco Rossi', ele: '2650' }),
      ],
    });
    expect(out.map((b) => b.name)).toEqual(['Hochjochbiwak', 'Bivacco Rossi', 'Bivouac X']);
    expect(out[0].ele).toBe(3536);
    expect(out[1]).toMatchObject({ capacity: 9, kind: 'metal', osm: 'node/1' });
    expect(out[2]).toMatchObject({ lat: 46.12346, lon: 11.98765, ele: null, capacity: 4, osm: 'way/5' });
  });
});

describe('bivouacKind', () => {
  it('uses the building material when mapped', () => {
    expect(bivouacKind({ 'building:material': 'wood' })).toBe('wood');
    expect(bivouacKind({ 'building:material': 'steel' })).toBe('metal');
  });
  it('reads wood from the description, but not a wooden frame under sheet metal', () => {
    expect(bivouacKind({ description: "L'edificio è interamente in legno con stufa." })).toBe('wood');
    expect(bivouacKind({ description: 'È una costruzione in legno ricoperta di lamiera bianca.' })).toBe('metal');
    expect(bivouacKind({ description: 'Tavolo in legno, due panche.' })).toBe('metal');
    expect(bivouacKind({})).toBe('metal');
  });
});
