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

describe('first paint', async () => {
  const { inlineIcons } = await import('../src/app/icons.ts');

  it('draws every icon of the page at build time', () => {
    const built = inlineIcons(html);
    expect(html).toMatch(/<i data-icon="/);
    expect(built).not.toMatch(/<i data-icon="/);
    expect(built).toContain('<svg aria-hidden="true" viewBox="0 0 256 256" width="22" height="22"');
  });

  it('leaves an unknown icon to the app', () => {
    expect(inlineIcons('<i data-icon="nope" data-size="12"></i>')).toBe('<i data-icon="nope" data-size="12"></i>');
  });

  it('puts the timeline where the app keeps it, with the same breakpoint', () => {
    const layout = readFileSync('web/src/app/layout.ts', 'utf8');
    const query = /matchMedia\('([^']+)'\)/.exec(layout)![1];
    expect(html).toContain(`window.matchMedia('${query}')`);
  });
});
