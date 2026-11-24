import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexable, NOINDEX, robotsTxt, sitemapXml } from '../../scripts/search.mjs';

const html = readFileSync('web/index.html', 'utf8');
const site = 'https://cimamap.com/';

describe('search engines', () => {
  it('keeps every page out of search results unless the build asks', () => {
    expect(html).toContain(NOINDEX);
    // The not-found page keeps it in every build.
    expect(readFileSync('web/404.html', 'utf8')).toContain(NOINDEX);
  });

  it('removes only the noindex line from an indexed page', () => {
    const out = indexable(html);
    expect(out).not.toContain('noindex');
    expect(out.split('\n')).toHaveLength(html.split('\n').length - 1);
    expect(out).toContain('<link rel="canonical" href="__SITE_URL__" />');
  });

  it('notices when the tag it should remove has changed', () => {
    expect(() => indexable('<meta name="robots" content="noindex, nofollow" />')).toThrow(/No noindex tag/);
  });

  it('lets crawlers read every page, /dev/ too, and names the sitemap', () => {
    const robots = robotsTxt(site);
    expect(robots).not.toMatch(/Disallow/);
    expect(robots).toContain('Sitemap: https://cimamap.com/sitemap.xml\n');
  });

  it('lists the one page in the sitemap', () => {
    const xml = sitemapXml(site);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.match(/<loc>/g)).toHaveLength(1);
    expect(xml).toContain('<loc>https://cimamap.com/</loc>');
    expect(sitemapXml('https://example.org/a&b/')).toContain('<loc>https://example.org/a&amp;b/</loc>');
  });
});
