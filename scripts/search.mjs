// Search engines (vite.config.ts). web/index.html carries a noindex tag, so a build stays out of
// search results unless it is asked for: the deploy builds the site with SEARCH_INDEX=on, the dev
// preview and local builds without. An indexed build loses the tag and gets robots.txt and
// sitemap.xml at its root.

/** The tag in web/index.html (and web/404.html, which keeps it in every build). */
export const NOINDEX = '<meta name="robots" content="noindex" />';

/** The page without its noindex tag. Throws when the tag is not there, so a changed tag is noticed. */
export function indexable(html) {
  const at = html.indexOf(NOINDEX);
  if (at < 0) throw new Error(`No noindex tag to remove: ${NOINDEX}`);
  const start = html.lastIndexOf('\n', at) + 1;
  const end = html.indexOf('\n', at) + 1 || html.length;
  return html.slice(0, start) + html.slice(end);
}

const xml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * Lets every crawler in, /dev/ too: the dev preview keeps out of results with its noindex tag,
 * which a crawler only sees when robots.txt lets it read the page.
 */
export function robotsTxt(siteUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`;
}

/** The app is one page; a shared view lives in the hash, which crawlers leave out. */
export function sitemapXml(siteUrl) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${xml(siteUrl)}</loc></url>`,
    '</urlset>',
    '',
  ].join('\n');
}
