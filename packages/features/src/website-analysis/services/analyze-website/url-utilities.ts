/**
 * URL utility functions for website analysis.
 *
 * Pure functions for resolving URLs, extracting links from HTML,
 * and scoring/picking location-relevant URLs.
 */

/** Optional locale prefix: matches /ie, /en-us, /pt-br, etc. */
const LOCALE_PREFIX = '(?:\\/[a-z]{2}(?:-[a-z]{2})?)?';

/** Location-relevant path patterns ordered by priority */
export const LOCATION_PATH_PATTERNS = [
  new RegExp(
    `^${LOCALE_PREFIX}\\/(locations?|clinics?|branches?|stores?)(\\/|$)`,
    'i'
  ),
  new RegExp(
    `^${LOCALE_PREFIX}\\/(find-us|our-locations?|where-to-find-us)(\\/|$)`,
    'i'
  ),
  new RegExp(`^${LOCALE_PREFIX}\\/(contact|about)(\\/|$)`, 'i'),
];

/** Team-relevant path patterns ordered by priority */
export const TEAM_PATH_PATTERNS = [
  new RegExp(
    `^${LOCALE_PREFIX}\\/(team|our-team|meet-the-team|meet-our-team|staff|specialists|practitioners)(\\/|$)`,
    'i'
  ),
  new RegExp(`^${LOCALE_PREFIX}\\/(about|about-us)(\\/|$)`, 'i'),
];

/** File extensions to skip when extracting links */
export const SKIP_EXTENSIONS =
  /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|css|js|woff2?|ttf|eot)$/i;

/** Path patterns for pricing/services pages that should be prioritized in subpage discovery */
export const PRIORITY_SUBPAGE_PATTERNS = [
  /\/(prices?|pricing|price-list|aesthetics-price-list)(\/|$|\?)/i,
  /\/(services?|treatments?|treatment-list|service-list|our-services)(\/|$|\?)/i,
  /\/(menu|treatment-menu|service-menu)(\/|$|\?)/i,
];

/** Path patterns that indicate a pricing/services page within a booking system */
export const BOOKING_PRICING_PATTERNS = [
  /\/(services?|pricing|prices|menu|treatments?|book)(\/|$|\?)/i,
  /\/(service-menu|treatment-menu|price-list)(\/|$|\?)/i,
];

/** Max subpages to fetch beyond the homepage */
export const MAX_SUBPAGES = 8;
/** Max chars per subpage text */
export const SUBPAGE_TEXT_LIMIT = 3000;
/** Max chars for priority pages (pricing/services) — more generous to capture full price lists */
export const PRIORITY_SUBPAGE_TEXT_LIMIT = 6000;
/** Max total chars for all subpage text combined */
export const SUBPAGE_TOTAL_LIMIT = 18000;

/**
 * Resolve a potentially relative URL to absolute.
 */
export function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * Filter URLs to those matching location-relevant path patterns.
 * Excludes the homepage itself. Returns at most 2 URLs ordered by priority.
 */
export function pickLocationUrls(
  urls: string[],
  homepageUrl: string
): string[] {
  const homeOrigin = new URL(homepageUrl).origin;
  const homePath = new URL(homepageUrl).pathname.replace(/\/+$/, '') || '/';

  // When homepage has a subpath (e.g. /ie), prefer URLs under that prefix
  const localePrefix = homePath !== '/' ? homePath : '';

  const scored: { url: string; priority: number }[] = [];

  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw, homeOrigin);
    } catch {
      continue;
    }
    if (parsed.origin !== homeOrigin) continue;

    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (path === homePath) continue;

    for (let i = 0; i < LOCATION_PATH_PATTERNS.length; i++) {
      if (LOCATION_PATH_PATTERNS[i].test(path)) {
        // Deprioritize URLs that don't match the homepage locale prefix
        const matchesLocale =
          !localePrefix || path.startsWith(`${localePrefix}/`);
        const priority =
          i + (matchesLocale ? 0 : LOCATION_PATH_PATTERNS.length);
        scored.push({ url: parsed.href, priority });
        break;
      }
    }
  }

  scored.sort((a, b) => a.priority - b.priority);

  // Dedupe by pathname
  const seen = new Set<string>();
  const result: string[] = [];
  for (const { url } of scored) {
    const path = new URL(url).pathname;
    if (!seen.has(path)) {
      seen.add(path);
      result.push(url);
      if (result.length >= 2) break;
    }
  }
  return result;
}

/**
 * Fallback link extraction: pull internal <a href> links from HTML.
 * Skips anchors, mailto, tel, javascript, and file extensions.
 * Caps at 100 unique links.
 */
export function extractInternalLinks(html: string, baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin;
  const seen = new Set<string>();
  const links: string[] = [];

  const hrefMatches = html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi);
  for (const m of hrefMatches) {
    const href = m[1].trim();
    if (
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      SKIP_EXTENSIONS.test(href)
    ) {
      continue;
    }

    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (absolute.origin !== origin) continue;

    const key = absolute.pathname;
    if (!seen.has(key)) {
      seen.add(key);
      links.push(absolute.href);
      if (links.length >= 100) break;
    }
  }

  return links;
}

/**
 * Extract links from <nav> and <header> elements.
 * These are the pages the business considers most important.
 */
export function extractNavLinks(html: string, baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin;
  const homePath = new URL(baseUrl).pathname.replace(/\/+$/, '') || '/';
  const seen = new Set<string>();
  const links: string[] = [];

  // Match <nav>...</nav> and <header>...</header> blocks
  const navBlocks = html.matchAll(/<(nav|header)\b[^>]*>([\s\S]*?)<\/\1>/gi);
  for (const block of navBlocks) {
    const blockHtml = block[2];
    const hrefMatches = blockHtml.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi);
    for (const m of hrefMatches) {
      const href = m[1].trim();
      if (
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:') ||
        SKIP_EXTENSIONS.test(href)
      ) {
        continue;
      }

      let absolute: URL;
      try {
        absolute = new URL(href, baseUrl);
      } catch {
        continue;
      }
      if (absolute.origin !== origin) continue;

      const path = absolute.pathname.replace(/\/+$/, '') || '/';
      if (path === homePath) continue;
      if (!seen.has(path)) {
        seen.add(path);
        links.push(absolute.href);
      }
    }
  }

  return links;
}

/**
 * Extract child location subpage links from the current page HTML.
 * For example, from /ie/locations extract links like /ie/locations/dundrum.
 * Returns up to `limit` URLs that are direct children of the page path.
 */
export function extractLocationSubpageLinks(
  html: string,
  pageUrl: string,
  limit = 6
): string[] {
  const parsed = new URL(pageUrl);
  const basePath = parsed.pathname.replace(/\/+$/, '');
  if (!basePath || basePath === '/') return [];

  const allLinks = extractInternalLinks(html, pageUrl);
  const childLinks: string[] = [];

  for (const link of allLinks) {
    const linkPath = new URL(link).pathname.replace(/\/+$/, '');
    // Must start with basePath and have exactly one more segment
    if (
      linkPath.startsWith(`${basePath}/`) &&
      linkPath !== basePath &&
      linkPath
        .slice(basePath.length + 1)
        .split('/')
        .filter(Boolean).length === 1
    ) {
      childLinks.push(link);
      if (childLinks.length >= limit) break;
    }
  }

  return childLinks;
}
