import { describe, expect, it } from 'vitest';
import { introFor, introHtml } from '../src/app/whatsNew.ts';
import { items, releaseNotes } from '../../scripts/release-notes.mjs';

describe("What's new and first view", () => {
  const notes = ['Winter sports layer', 'New map look'];

  it('welcomes a first visit', () => {
    expect(introFor(null, false, '0.3.0', notes)).toBe('welcome');
    expect(introFor(null, false, '0.3.0', [])).toBe('welcome');
  });

  it('shows what is new to a visitor of an older version, or of the app before the card', () => {
    expect(introFor('0.2.2', false, '0.3.0', notes)).toBe('new');
    expect(introFor(null, true, '0.3.0', notes)).toBe('new');
  });

  it('shows nothing for the same version, an old cached copy or a version without notes', () => {
    expect(introFor('0.3.0', true, '0.3.0', notes)).toBeNull();
    expect(introFor('0.4.0', true, '0.3.0', notes)).toBeNull();
    expect(introFor('0.2.2', true, '0.3.0', [])).toBeNull();
    expect(introFor('0.2.9', false, '0.2.10', notes)).toBe('new');
  });

  it('draws the notes escaped, with a link to all release notes', () => {
    const html = introHtml('new', '0.3.0', ['Fixes <b>', ...notes]);
    expect(html).toContain("What's new in 0.3.0");
    expect(html).toContain('<li>Fixes &#60;b&#62;</li>');
    expect(html).toContain('github.com/adamvalik/tirol-snow-map/releases');
    expect(introHtml('welcome', '0.3.0', [])).toContain('Welcome to South Tyrol Snow');
  });
});

describe('release notes from the Releases table', () => {
  const md = '## Releases\n\n| Version | Date | What |\n| --- | --- | --- |\n| `v0.3.0` | Nov 21, 2026 | winter sports (slopes, lifts in 3D), new map look |\n';

  it('splits on commas outside brackets and starts each item with a capital', () => {
    expect(items('a (b, c), d')).toEqual(['a (b, c)', 'd']);
    expect(releaseNotes(md, 'v0.3.0')).toEqual(['Winter sports (slopes, lifts in 3D)', 'New map look']);
    expect(releaseNotes(md, 'v0.4.0')).toEqual([]);
  });
});
