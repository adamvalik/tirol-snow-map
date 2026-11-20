import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('web/index.html', 'utf8');
const manifest = JSON.parse(readFileSync('web/public/manifest.webmanifest', 'utf8')) as { description: string; name: string };

describe('page title and description', () => {
  const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1];
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]) as { description: string; name: string };

  it('has the same description in the page, the manifest and the JSON-LD', () => {
    expect(description).toBeTruthy();
    expect(manifest.description).toBe(description);
    expect(ld.description).toBe(description);
    expect(ld.name).toBe(manifest.name);
  });

  it('keeps the description and title short enough for search results', () => {
    expect(description!.length).toBeLessThanOrEqual(160);
    expect(/<title>([^<]+)<\/title>/.exec(html)![1].length).toBeLessThanOrEqual(65);
  });

  it('fills the canonical link from SITE_URL', () => {
    expect(html).toContain('<link rel="canonical" href="__SITE_URL__" />');
  });
});
