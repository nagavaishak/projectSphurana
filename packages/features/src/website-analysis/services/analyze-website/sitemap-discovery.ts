/**
 * Sitemap URL discovery.
 *
 * Async function that fetches sitemap.xml (or robots.txt -> Sitemap directive)
 * and extracts URLs. Handles sitemap index files one level deep.
 */

/**
 * Fetch URLs from sitemap.xml (or robots.txt -> Sitemap directive).
 * Handles sitemap index files (one level deep, up to 2 sub-sitemaps).
 *
 * Accepts a `fetchContent` function to avoid a direct dependency on the
 * main service's `fetchWebsiteContent()`.
 */
export async function fetchSitemapUrls(
  origin: string,
  fetchContent: (url: string) => Promise<string>
): Promise<string[]> {
  const urls: string[] = [];

  // Try to find sitemap URL from robots.txt first, fall back to /sitemap.xml
  let sitemapUrl = `${origin}/sitemap.xml`;
  try {
    const robotsTxt = await fetchContent(`${origin}/robots.txt`);
    const sitemapMatch = robotsTxt.match(/^Sitemap:\s*(.+)$/im);
    if (sitemapMatch?.[1]) {
      sitemapUrl = sitemapMatch[1].trim();
    }
  } catch {
    // robots.txt not available, use default
  }

  try {
    const xml = await fetchContent(sitemapUrl);
    const locMatches = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(
      (m) => m[1]
    );

    // Detect sitemap index: contains <sitemap> tags
    if (/<sitemap>/i.test(xml)) {
      // It's a sitemap index — fetch up to 2 sub-sitemaps
      const subSitemapUrls = locMatches.slice(0, 2);
      const subResults = await Promise.allSettled(
        subSitemapUrls.map((u) => fetchContent(u))
      );
      for (const sub of subResults) {
        if (sub.status === 'fulfilled') {
          const subLocs = [
            ...sub.value.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi),
          ].map((m) => m[1]);
          urls.push(...subLocs);
        }
      }
    } else {
      urls.push(...locMatches);
    }
  } catch {
    // Sitemap not available
  }

  return urls;
}
