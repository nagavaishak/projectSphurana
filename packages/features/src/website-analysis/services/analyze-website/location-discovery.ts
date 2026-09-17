/**
 * Location, team, and subpage discovery and content extraction.
 *
 * Async orchestration functions that combine URL utilities, structured data
 * extraction, sitemap discovery, and browser rendering to find and fetch
 * location/team/subpage content.
 */

import type { Logger } from '@borradh-workspace/observability';
import type { BrowserSession } from './browser-renderer.js';
import { extractTextFromHtml } from './extract-html-metadata.js';
import {
  extractEmbeddedLocationData,
  extractJsonLdLocations,
} from './extract-structured-data.js';
import { fetchSitemapUrls } from './sitemap-discovery.js';
import {
  MAX_SUBPAGES,
  PRIORITY_SUBPAGE_PATTERNS,
  PRIORITY_SUBPAGE_TEXT_LIMIT,
  SUBPAGE_TEXT_LIMIT,
  SUBPAGE_TOTAL_LIMIT,
  TEAM_PATH_PATTERNS,
  extractInternalLinks,
  extractLocationSubpageLinks,
  extractNavLinks,
  pickLocationUrls,
} from './url-utilities.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Try to render a page with the browser, returning rendered HTML or null.
 */
async function tryBrowserRender(
  url: string,
  fetchedHtml: string,
  fetchedText: string,
  childLinksCount: number,
  browserSession: BrowserSession | null,
  needsBrowserRendering: (
    html: string,
    text: string,
    childLinks: number
  ) => boolean,
  logger: Logger
): Promise<string | null> {
  if (!browserSession) return null;
  if (!needsBrowserRendering(fetchedHtml, fetchedText, childLinksCount))
    return null;

  logger.info(
    `[browser-fallback] SPA detected for ${url}, rendering with browser`
  );
  const rendered = await browserSession.renderPage(url);
  if (!rendered) return null;

  const renderedText = extractTextFromHtml(rendered.html);
  logger.info(
    `[browser-fallback] ${url} rendered: ${renderedText.length} chars text (was ${fetchedText.length})`
  );

  // Only use rendered version if it has more content
  if (renderedText.length > fetchedText.length) {
    return rendered.html;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Location discovery
// ---------------------------------------------------------------------------

export interface LocationDiscoveryDeps {
  fetchContent: (url: string) => Promise<string>;
  browserSession: BrowserSession | null;
  needsBrowserRendering: (
    html: string,
    text: string,
    childLinks: number
  ) => boolean;
  logger: Logger;
}

/**
 * Orchestrator: try sitemap first, then fall back to HTML link extraction.
 * Returns up to 2 location-relevant URLs.
 */
export async function discoverLocationUrls(
  baseUrl: string,
  homepageHtml: string,
  deps: LocationDiscoveryDeps
): Promise<string[]> {
  const { fetchContent, logger } = deps;
  const origin = new URL(baseUrl).origin;

  // Collect candidates from both sources
  const sitemapUrls = await fetchSitemapUrls(origin, fetchContent);
  logger.info(`[locations] sitemap returned ${sitemapUrls.length} URLs`);

  const internalLinks = extractInternalLinks(homepageHtml, baseUrl);
  logger.info(`[locations] homepage links extracted: ${internalLinks.length}`);

  // Dedupe by pathname before scoring
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const url of [...internalLinks, ...sitemapUrls]) {
    try {
      const key = new URL(url, origin).pathname;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(url);
      }
    } catch {
      /* skip malformed */
    }
  }
  logger.info(`[locations] combined ${candidates.length} unique candidates`);

  const picked = pickLocationUrls(candidates, baseUrl);
  logger.info(`[locations] picked: ${JSON.stringify(picked)}`);
  return picked;
}

/**
 * Fetch location subpages in parallel and combine their text + JSON-LD.
 * Total text is capped at 8000 chars.
 *
 * When a browser session is provided, pages detected as SPAs are re-rendered
 * with headless Chromium to extract JS-loaded content.
 */
export async function fetchAndExtractLocationContent(
  urls: string[],
  deps: LocationDiscoveryDeps
): Promise<{ text: string; jsonLd: string }> {
  const {
    fetchContent,
    browserSession,
    needsBrowserRendering: needsBrowser,
    logger,
  } = deps;

  if (urls.length === 0) return { text: '', jsonLd: '' };

  const results = await Promise.allSettled(urls.map((u) => fetchContent(u)));

  const textParts: string[] = [];
  const jsonLdParts: string[] = [];
  let totalLen = 0;
  const maxTotal = 8000;

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled') continue;

    let pageHtml = res.value;
    const pageUrl = urls[i];

    // Extract initial content from raw fetch
    let pageText = extractTextFromHtml(pageHtml);
    let childLinks = extractLocationSubpageLinks(pageHtml, pageUrl, 6);

    // SPA fallback: re-render with browser if content looks like an empty shell
    const renderedHtml = await tryBrowserRender(
      pageUrl,
      pageHtml,
      pageText,
      childLinks.length,
      browserSession,
      needsBrowser,
      logger
    );
    if (renderedHtml) {
      pageHtml = renderedHtml;
      pageText = extractTextFromHtml(pageHtml);
      childLinks = extractLocationSubpageLinks(pageHtml, pageUrl, 6);
    }

    // Extract JSON-LD location data
    const pageJsonLd = extractJsonLdLocations(pageHtml);
    logger.debug(
      `[locationContent] ${pageUrl} jsonLd=${pageJsonLd ? 'found' : 'none'}`
    );
    if (pageJsonLd) jsonLdParts.push(pageJsonLd);

    logger.info(
      `[locationContent] ${pageUrl} textLen=${pageText.length} htmlLen=${pageHtml.length}`
    );
    logger.debug(`[locationContent] text preview: ${pageText.slice(0, 300)}`);

    // Always include page text (even if sparse, it may have useful headers/names)
    if (pageText.length > 0) {
      const remaining = maxTotal - totalLen;
      if (remaining > 0) {
        const header = `\n--- ${pageUrl} ---\n`;
        const chunk = header + pageText.slice(0, Math.min(4000, remaining));
        textParts.push(chunk);
        totalLen += chunk.length;
      }
    }

    // Always try embedded script data
    const embeddedData = extractEmbeddedLocationData(pageHtml);
    logger.info(
      `[locationContent] ${pageUrl} embeddedData=${embeddedData ? `${embeddedData.length} chars` : 'none'}`
    );
    if (embeddedData) {
      const remaining = maxTotal - totalLen;
      if (remaining > 0) {
        const header = `\n--- ${pageUrl} (embedded data) ---\n`;
        const chunk = header + embeddedData.slice(0, remaining);
        textParts.push(chunk);
        totalLen += chunk.length;
      }
    }

    // Child link extraction
    const allInternalLinks = extractInternalLinks(pageHtml, pageUrl);
    logger.info(
      `[locationContent] ${pageUrl} internalLinks=${allInternalLinks.length} childLinks=${childLinks.length}`
    );
    if (allInternalLinks.length > 0 && childLinks.length === 0) {
      logger.debug(
        `[locationContent] sample internal links: ${JSON.stringify(allInternalLinks.slice(0, 10))}`
      );
    }
    if (childLinks.length > 0) {
      logger.info(
        `[locationContent] fetching child subpages: ${JSON.stringify(childLinks)}`
      );
      const childFetchResults = await Promise.allSettled(
        childLinks.map((u) => fetchContent(u))
      );
      for (let j = 0; j < childFetchResults.length; j++) {
        const childRes = childFetchResults[j];
        if (childRes.status !== 'fulfilled') continue;

        const remaining = maxTotal - totalLen;
        if (remaining <= 0) break;

        let childHtml = childRes.value;
        const childUrl = childLinks[j];
        let childText = extractTextFromHtml(childHtml);

        // SPA fallback for child pages too
        const renderedChild = await tryBrowserRender(
          childUrl,
          childHtml,
          childText,
          0,
          browserSession,
          needsBrowser,
          logger
        );
        if (renderedChild) {
          childHtml = renderedChild;
          childText = extractTextFromHtml(childHtml);
        }

        const childJsonLd = extractJsonLdLocations(childHtml);
        if (childJsonLd) jsonLdParts.push(childJsonLd);

        // Supplement with embedded data if available
        let childContent = childText;
        const childEmbedded = extractEmbeddedLocationData(childHtml);
        if (childEmbedded) {
          childContent =
            childContent.length > 0
              ? `${childContent}\n${childEmbedded}`
              : childEmbedded;
        }
        logger.debug(
          `[locationContent] child ${childUrl} contentLen=${childContent.length}`
        );

        // Cap per-subpage at 2000 chars to fit more locations
        const header = `\n--- ${childUrl} ---\n`;
        const chunk = header + childContent.slice(0, Math.min(2000, remaining));
        textParts.push(chunk);
        totalLen += chunk.length;
      }
    }
  }

  return { text: textParts.join(''), jsonLd: jsonLdParts.join('\n') };
}

// ---------------------------------------------------------------------------
// Team page discovery
// ---------------------------------------------------------------------------

/**
 * Discover team/about page URLs from homepage links.
 * Returns up to 1 team-relevant URL.
 */
export function discoverTeamUrls(
  baseUrl: string,
  homepageHtml: string
): string[] {
  const origin = new URL(baseUrl).origin;
  const homePath = new URL(baseUrl).pathname.replace(/\/+$/, '') || '/';
  const localePrefix = homePath !== '/' ? homePath : '';

  const internalLinks = extractInternalLinks(homepageHtml, baseUrl);

  const scored: { url: string; priority: number }[] = [];
  for (const raw of internalLinks) {
    let parsed: URL;
    try {
      parsed = new URL(raw, origin);
    } catch {
      continue;
    }
    if (parsed.origin !== origin) continue;

    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (path === homePath) continue;

    for (let i = 0; i < TEAM_PATH_PATTERNS.length; i++) {
      if (TEAM_PATH_PATTERNS[i].test(path)) {
        const matchesLocale =
          !localePrefix || path.startsWith(`${localePrefix}/`);
        const priority = i + (matchesLocale ? 0 : TEAM_PATH_PATTERNS.length);
        scored.push({ url: parsed.href, priority });
        break;
      }
    }
  }

  scored.sort((a, b) => a.priority - b.priority);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const { url } of scored) {
    const path = new URL(url).pathname;
    if (!seen.has(path)) {
      seen.add(path);
      result.push(url);
      if (result.length >= 1) break;
    }
  }

  return result;
}

/**
 * Fetch team page content and extract text.
 * Returns up to 4000 chars of team page text.
 */
export async function fetchTeamPageContent(
  urls: string[],
  fetchContent: (url: string) => Promise<string>
): Promise<string> {
  if (urls.length === 0) return '';

  const results = await Promise.allSettled(urls.map((u) => fetchContent(u)));

  const textParts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled') continue;

    const pageText = extractTextFromHtml(res.value);
    if (pageText.length > 0) {
      const header = `\n--- ${urls[i]} ---\n`;
      textParts.push(header + pageText.slice(0, 4000));
    }
  }

  return textParts.join('');
}

// ---------------------------------------------------------------------------
// Subpage discovery
// ---------------------------------------------------------------------------

/**
 * Discover key subpages via nav links + sitemap, fetch their content.
 * Nav links are prioritized (most important pages), then filled from sitemap.
 * Returns combined text from all subpages, or undefined if none found.
 */
export async function discoverAndFetchSubpages(
  baseUrl: string,
  homepageHtml: string,
  fetchContent: (url: string) => Promise<string>,
  logger: Logger
): Promise<string | undefined> {
  const origin = new URL(baseUrl).origin;
  const homePath = new URL(baseUrl).pathname.replace(/\/+$/, '') || '/';

  // 1. Get nav links (highest priority)
  const navLinks = extractNavLinks(homepageHtml, baseUrl);
  logger.info(`[subpages] nav links: ${navLinks.length}`);

  // 2. Get sitemap URLs as a broader pool
  const sitemapUrls = await fetchSitemapUrls(origin, fetchContent);
  logger.info(`[subpages] sitemap URLs: ${sitemapUrls.length}`);

  // 3. Combine: nav links first, then sitemap (deduplicated)
  const seen = new Set<string>();
  seen.add(homePath);
  const priorityUrls: string[] = [];
  const regularUrls: string[] = [];

  for (const url of [...navLinks, ...sitemapUrls]) {
    let parsed: URL;
    try {
      parsed = new URL(url, origin);
    } catch {
      continue;
    }
    if (parsed.origin !== origin) continue;

    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (seen.has(path)) continue;
    seen.add(path);

    // Pricing/services pages go first
    if (PRIORITY_SUBPAGE_PATTERNS.some((p) => p.test(path))) {
      priorityUrls.push(parsed.href);
    } else {
      regularUrls.push(parsed.href);
    }
  }

  // Priority pages first, then regular pages
  const orderedUrls = [...priorityUrls, ...regularUrls];
  logger.info(
    `[subpages] ${priorityUrls.length} priority (pricing/services) pages, ${regularUrls.length} regular pages`
  );

  // Cap at MAX_SUBPAGES
  const urlsToFetch = orderedUrls.slice(0, MAX_SUBPAGES);
  logger.info(
    `[subpages] fetching ${urlsToFetch.length} subpages: ${JSON.stringify(urlsToFetch)}`
  );

  if (urlsToFetch.length === 0) return undefined;

  // 4. Fetch all subpages in parallel
  const results = await Promise.allSettled(
    urlsToFetch.map((u) => fetchContent(u))
  );

  const textParts: string[] = [];
  let totalLength = 0;

  const prioritySet = new Set(priorityUrls);

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled') continue;

    // Priority pages (pricing/services) get a larger text budget
    const isPriority = prioritySet.has(urlsToFetch[i]);
    const textLimit = isPriority
      ? PRIORITY_SUBPAGE_TEXT_LIMIT
      : SUBPAGE_TEXT_LIMIT;

    const pageText = extractTextFromHtml(res.value).slice(0, textLimit);
    if (pageText.length < 50) continue; // skip near-empty pages

    const header = `\n--- ${urlsToFetch[i]} ---\n`;
    const chunk = header + pageText;

    if (totalLength + chunk.length > SUBPAGE_TOTAL_LIMIT) break;
    textParts.push(chunk);
    totalLength += chunk.length;
  }

  if (textParts.length === 0) return undefined;

  logger.info(
    `[subpages] extracted text from ${textParts.length} pages, ${totalLength} chars total`
  );
  return textParts.join('');
}
