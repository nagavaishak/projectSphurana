/**
 * Booking system discovery and content extraction.
 *
 * Async functions that fetch booking system pages, discover pricing sub-pages,
 * and use browser rendering for SPA-heavy booking systems.
 */

import type { Logger } from '@borradh-workspace/observability';
import type { BrowserSession } from './browser-renderer.js';
import { extractTextFromHtml } from './extract-html-metadata.js';
import { fetchSitemapUrls } from './sitemap-discovery.js';
import {
  BOOKING_PRICING_PATTERNS,
  extractInternalLinks,
} from './url-utilities.js';

/**
 * Discover pricing/services sub-links within a booking system.
 * Combines links from the page HTML AND the booking system's sitemap
 * to find pricing-relevant pages. Returns up to 3 URLs.
 */
export async function discoverBookingPricingLinks(
  html: string,
  baseUrl: string,
  fetchContent: (url: string) => Promise<string>,
  logger: Logger
): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, '') || '/';
  const seen = new Set<string>();
  seen.add(basePath);
  const links: string[] = [];

  // Collect candidates from HTML links and sitemap
  const htmlLinks = extractInternalLinks(html, baseUrl);
  const sitemapUrls = await fetchSitemapUrls(origin, fetchContent);
  logger.info(
    `[booking] link discovery: ${htmlLinks.length} HTML links, ${sitemapUrls.length} sitemap URLs`
  );

  // HTML links first (more targeted), then sitemap (broader coverage)
  for (const raw of [...htmlLinks, ...sitemapUrls]) {
    let parsed: URL;
    try {
      parsed = new URL(raw, origin);
    } catch {
      continue;
    }
    if (parsed.origin !== origin) continue;

    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (seen.has(path)) continue;

    // Check if the link matches pricing patterns
    if (BOOKING_PRICING_PATTERNS.some((p) => p.test(path))) {
      seen.add(path);
      links.push(parsed.href);
      if (links.length >= 3) break;
    }
  }

  return links;
}

export interface BookingDiscoveryDeps {
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
 * Fetch booking system content with browser rendering fallback.
 * Booking systems (Fresha, Treatwell, Phorest, etc.) are typically SPAs
 * that load services/pricing via JavaScript.
 *
 * Steps:
 * 1. Fetch the main booking URL
 * 2. If content is sparse, try browser rendering
 * 3. Discover pricing sub-pages and fetch them too
 * 4. Combine all content (capped at 10000 chars)
 */
export async function fetchBookingSystemContent(
  bookingUrl: string,
  deps: BookingDiscoveryDeps
): Promise<string | undefined> {
  const { fetchContent, browserSession, needsBrowserRendering, logger } = deps;
  const maxTotal = 10000;
  const textParts: string[] = [];
  let totalLen = 0;

  // 1. Fetch the main booking page
  let bookingHtml: string;
  try {
    bookingHtml = await fetchContent(bookingUrl);
  } catch {
    // If fetch fails, try browser rendering directly
    if (browserSession) {
      const rendered = await browserSession.renderPage(bookingUrl);
      if (rendered) {
        bookingHtml = rendered.html;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  let bookingText = extractTextFromHtml(bookingHtml);

  // 2. If content is sparse, try browser rendering (SPAs)
  if (browserSession && needsBrowserRendering(bookingHtml, bookingText, 0)) {
    logger.info(
      `[booking] SPA detected for ${bookingUrl}, rendering with browser`
    );
    const rendered = await browserSession.renderPage(bookingUrl);
    if (rendered) {
      const renderedText = extractTextFromHtml(rendered.html);
      logger.info(
        `[booking] rendered: ${renderedText.length} chars (was ${bookingText.length})`
      );
      if (renderedText.length > bookingText.length) {
        bookingHtml = rendered.html;
        bookingText = renderedText;
      }
    }
  }

  // Add main booking page text
  if (bookingText.length > 0) {
    const chunk = bookingText.slice(0, 6000);
    textParts.push(chunk);
    totalLen += chunk.length;
  }

  // 3. Discover and fetch pricing sub-pages (checks HTML links + sitemap)
  const pricingLinks = await discoverBookingPricingLinks(
    bookingHtml,
    bookingUrl,
    fetchContent,
    logger
  );
  logger.info(
    `[booking] discovered ${pricingLinks.length} pricing sub-pages: ${JSON.stringify(pricingLinks)}`
  );

  if (pricingLinks.length > 0) {
    for (const subUrl of pricingLinks) {
      if (totalLen >= maxTotal) break;

      let subText = '';
      try {
        // Try fetch first
        const subHtml = await fetchContent(subUrl);
        subText = extractTextFromHtml(subHtml);

        // If sparse, try browser
        if (browserSession && subText.length < 200) {
          const rendered = await browserSession.renderPage(subUrl);
          if (rendered) {
            const renderedText = extractTextFromHtml(rendered.html);
            if (renderedText.length > subText.length) {
              subText = renderedText;
            }
          }
        }
      } catch {
        // Try browser as last resort
        if (browserSession) {
          const rendered = await browserSession.renderPage(subUrl);
          if (rendered) {
            subText = extractTextFromHtml(rendered.html);
          }
        }
      }

      if (subText.length > 50) {
        const remaining = maxTotal - totalLen;
        const header = `\n--- ${subUrl} ---\n`;
        const chunk = header + subText.slice(0, Math.min(3000, remaining));
        textParts.push(chunk);
        totalLen += chunk.length;
      }
    }
  }

  const combined = textParts.join('');
  return combined.length > 0 ? combined : undefined;
}
