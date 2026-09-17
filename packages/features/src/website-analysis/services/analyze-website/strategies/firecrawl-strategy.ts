import { fetchWithRetry } from '@borradh-workspace/http';
import { createLogger } from '@borradh-workspace/observability';

import type { StrategyResult } from './types.js';

const logger = createLogger('FirecrawlStrategy');

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';
const MAX_PAGES = 20;
const CRAWL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
// Per-request bound. Without it a single hung request stalls past the
// CRAWL_TIMEOUT_MS deadline loop (which is only checked between iterations)
// and can hang the whole analysis job.
const REQUEST_TIMEOUT_MS = 30_000;
// Result pagination is capped so a `next` chain can't loop unbounded.
const MAX_RESULT_PAGES = 10;

interface FirecrawlCrawlResponse {
  success: boolean;
  id?: string;
  status?: string;
  data?: FirecrawlPageData[];
  total?: number;
  next?: string;
  error?: string;
}

interface FirecrawlPageData {
  markdown?: string;
  metadata?: {
    title?: string;
    description?: string;
    sourceURL?: string;
    ogImage?: string;
    [key: string]: unknown;
  };
  screenshot?: string;
}

async function firecrawlRequest(
  path: string,
  apiKey: string,
  options: RequestInit = {}
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchWithRetry(`${FIRECRAWL_BASE}${path}`, {
      timeoutMs: 30_000,
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Firecrawl ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function pollCrawlJob(
  jobId: string,
  apiKey: string
): Promise<FirecrawlPageData[]> {
  const deadline = Date.now() + CRAWL_TIMEOUT_MS;
  const allPages: FirecrawlPageData[] = [];

  while (Date.now() < deadline) {
    const res = (await firecrawlRequest(
      `/crawl/${jobId}`,
      apiKey
    )) as FirecrawlCrawlResponse;

    if (res.status === 'completed') {
      if (res.data) allPages.push(...res.data);

      let nextUrl = res.next;
      let resultPages = 0;
      while (nextUrl && resultPages < MAX_RESULT_PAGES) {
        const nextRes = (await firecrawlRequest(
          nextUrl.replace(FIRECRAWL_BASE, ''),
          apiKey
        )) as FirecrawlCrawlResponse;
        if (nextRes.data) allPages.push(...nextRes.data);
        nextUrl = nextRes.next;
        resultPages++;
      }

      return allPages;
    }

    if (res.status === 'failed') {
      throw new Error(`Firecrawl crawl failed: ${res.error ?? 'unknown'}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error('Firecrawl crawl timed out');
}

function extractImageUrls(pages: FirecrawlPageData[]): string[] {
  const imageUrls: string[] = [];
  const priceKeywords =
    /price|pricing|menu|tariff|rate|cost|treatment.*list|service.*list/i;

  for (const page of pages) {
    const sourceUrl = page.metadata?.sourceURL ?? '';
    const markdown = page.markdown ?? '';

    if (priceKeywords.test(sourceUrl) || priceKeywords.test(markdown)) {
      const imgMatches = markdown.matchAll(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g);
      for (const m of imgMatches) {
        const url = m[1];
        if (/\.(jpg|jpeg|png|webp)/i.test(url)) {
          imageUrls.push(url);
        }
      }
    }

    if (page.metadata?.ogImage) {
      const ogUrl = page.metadata.ogImage;
      if (
        priceKeywords.test(sourceUrl) &&
        /\.(jpg|jpeg|png|webp)/i.test(ogUrl)
      ) {
        imageUrls.push(ogUrl);
      }
    }
  }

  return [...new Set(imageUrls)].slice(0, 10);
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: { screenshot?: string };
  error?: string;
}

/**
 * Capture a single-page homepage screenshot via Firecrawl `/scrape`.
 *
 * Used as a fallback brand-color source when local headless Chromium isn't
 * available (e.g. distroless prod). Returns the hosted screenshot URL, or null.
 */
export async function fetchFirecrawlScreenshot(
  websiteUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    const res = (await firecrawlRequest('/scrape', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        url: websiteUrl,
        formats: ['screenshot'],
      }),
    })) as FirecrawlScrapeResponse;
    return res.success ? (res.data?.screenshot ?? null) : null;
  } catch (error) {
    logger.warn(
      `[firecrawl] screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export async function runFirecrawlStrategy(
  websiteUrl: string,
  apiKey: string
): Promise<StrategyResult> {
  logger.info(`[firecrawl] starting crawl of ${websiteUrl}`);

  const crawlRes = (await firecrawlRequest('/crawl', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      url: websiteUrl,
      limit: MAX_PAGES,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
      },
    }),
  })) as FirecrawlCrawlResponse;

  if (!crawlRes.success || !crawlRes.id) {
    throw new Error(
      `Firecrawl crawl start failed: ${crawlRes.error ?? 'no job id'}`
    );
  }

  logger.info(`[firecrawl] crawl job ${crawlRes.id} started, polling...`);
  const pages = await pollCrawlJob(crawlRes.id, apiKey);
  logger.info(`[firecrawl] crawl complete, ${pages.length} pages`);

  // Prioritize pages likely to contain services/pricing so they survive truncation
  const PRIORITY_KEYWORDS =
    /price|pricing|menu|tariff|treatment|service|offer|book|appointment|rate|cost|facial|laser|filler|botox/i;

  const sorted = [...pages].sort((a, b) => {
    const urlA = a.metadata?.sourceURL ?? '';
    const urlB = b.metadata?.sourceURL ?? '';
    const mdA = (a.markdown ?? '').slice(0, 500);
    const mdB = (b.markdown ?? '').slice(0, 500);
    const scoreA =
      (PRIORITY_KEYWORDS.test(urlA) ? 2 : 0) +
      (PRIORITY_KEYWORDS.test(mdA) ? 1 : 0);
    const scoreB =
      (PRIORITY_KEYWORDS.test(urlB) ? 2 : 0) +
      (PRIORITY_KEYWORDS.test(mdB) ? 1 : 0);
    return scoreB - scoreA;
  });

  const rawContent = sorted
    .map((p) => {
      const url = p.metadata?.sourceURL ?? '';
      const md = p.markdown ?? '';
      return `--- Page: ${url} ---\n${md}`;
    })
    .join('\n\n')
    .slice(0, 100_000);

  const priceListImageUrls = extractImageUrls(pages);
  logger.info(
    `[firecrawl] found ${priceListImageUrls.length} potential price-list images`
  );

  return {
    services: [],
    rawContent,
    priceListImageUrls,
    source: 'firecrawl',
  };
}
