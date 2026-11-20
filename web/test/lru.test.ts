import { describe, expect, it } from 'vitest';
import { LruMap } from '../src/lru.ts';

describe('LruMap', () => {
  it('drops the least recently used entry, not the oldest inserted', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1).set('b', 2);
    m.get('a');
    m.set('c', 3);
    expect(m.has('a')).toBe(true);
    expect(m.has('b')).toBe(false);
    expect(m.size).toBe(2);
  });

  it('peek does not count as a use', () => {
    const m = new LruMap<string, number | null>(2);
    m.set('a', null).set('b', 2);
    expect(m.peek('a')).toBeNull();
    m.set('c', 3);
    expect(m.has('a')).toBe(false);
  });

  it('setting a key again keeps one entry and makes it the newest', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1).set('b', 2).set('a', 9).set('c', 3);
    expect(m.get('a')).toBe(9);
    expect(m.has('b')).toBe(false);
  });
});
