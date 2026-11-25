import { describe, expect, it } from 'vitest';
import { checkSite } from '../../scripts/live-check.mjs';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const base = 'https://example.org/snow/';

/** A fake site: paths to [status, body]; anything else is 404. */
function site(files: Record<string, [number, string]>) {
  const asked: string[] = [];
  const fetchFn = async (url: string) => {
    const path = url.slice(base.length).split('?')[0];
    asked.push(path);
    const [status, body] = files[path] ?? [404, ''];
    return { ok: status < 300, status, text: async () => body, json: async () => JSON.parse(body) as unknown } as Response;
  };
  return { fetchFn, asked };
}

const good = {
  '': [200, '<head><meta name="app-commit" content="abc1234" /></head>'],
  'data/status.json': [200, JSON.stringify({ generatedAt: '2026-11-20T04:00:00Z' })],
  'basemap/south-tyrol.pmtiles': [206, ''],
  'og.jpg': [200, ''],
  'robots.txt': [200, ''],
  'sitemap.xml': [200, ''],
} satisfies Record<string, [number, string]>;

describe('live site check', () => {
  it('passes a site that serves what was built', async () => {
    const { fetchFn, asked } = site(good);
    expect(await checkSite({ base, commit: 'abc1234', picture: true, indexed: true }, fetchFn, NOW)).toEqual({ problems: [], notes: [] });
    expect(asked).toContain('og.jpg');
  });

  it('finds an old commit, stale data and missing files', async () => {
    const { fetchFn } = site({
      ...good,
      '': [200, '<meta name="app-commit" content="0000000" />'],
      'data/status.json': [200, JSON.stringify({ generatedAt: '2026-11-19T12:00:00Z' })],
      'og.jpg': [404, ''],
    });
    const { problems } = await checkSite({ base, commit: 'abc1234', picture: true, indexed: true }, fetchFn, NOW);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('commit 0000000, expected abc1234');
    expect(problems[1]).toContain('24 h old');
    expect(problems[2]).toContain('og.jpg');
  });

  it('notes a page without the commit tag but does not fail it', async () => {
    const { fetchFn, asked } = site({ ...good, '': [200, '<head></head>'] });
    const r = await checkSite({ base, commit: 'abc1234', picture: false, indexed: true }, fetchFn, NOW);
    expect(r.problems).toEqual([]);
    expect(r.notes).toHaveLength(1);
    expect(asked).not.toContain('og.jpg');
  });

  it('reports a site that does not answer', async () => {
    const fetchFn = async () => {
      throw new Error('offline');
    };
    const { problems } = await checkSite({ base, commit: '', picture: false, indexed: false }, fetchFn as never, NOW);
    expect(problems.some((p) => p.includes('network error (offline)'))).toBe(true);
  });

  it('fails a dev preview that search engines may list', async () => {
    const { fetchFn } = site(good);
    const { problems } = await checkSite({ base, commit: 'abc1234', picture: false, indexed: false }, fetchFn, NOW);
    expect(problems).toEqual([`\`${base}\` has no noindex tag, so search engines may list it`]);
  });

  it('passes a dev preview with the noindex tag, without robots.txt', async () => {
    const page = '<meta name="app-commit" content="abc1234" /><meta name="robots" content="noindex" />';
    const { fetchFn, asked } = site({ ...good, '': [200, page], 'robots.txt': [404, ''] });
    expect(await checkSite({ base, commit: 'abc1234', picture: false, indexed: false }, fetchFn, NOW)).toEqual({ problems: [], notes: [] });
    expect(asked).not.toContain('robots.txt');
  });

  it('only notes a site kept out of search engines', async () => {
    const page = '<meta name="app-commit" content="abc1234" /><meta name="robots" content="noindex" />';
    const { fetchFn } = site({ ...good, '': [200, page] });
    const r = await checkSite({ base, commit: 'abc1234', picture: true, indexed: true }, fetchFn, NOW);
    expect(r.problems).toEqual([]);
    expect(r.notes[0]).toContain('noindex');
  });

  it('finds a missing robots.txt and sitemap on an indexed site', async () => {
    const { fetchFn } = site({ ...good, 'robots.txt': [404, ''], 'sitemap.xml': [404, ''] });
    const { problems } = await checkSite({ base, commit: 'abc1234', picture: true, indexed: true }, fetchFn, NOW);
    expect(problems).toEqual([`\`${base}robots.txt\` answers 404`, `\`${base}sitemap.xml\` answers 404`]);
  });
});
