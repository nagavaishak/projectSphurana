import { fetchWithRetry } from '@borradh-workspace/http';
import { createLogger } from '@borradh-workspace/observability';

import type { StrategyResult } from './types.js';

const logger = createLogger('BrowserbaseStrategy');

const BROWSERBASE_API = 'https://api.browserbase.com';
const SESSION_TIMEOUT_MS = 90_000;

interface BrowserbaseConfig {
  apiKey: string;
  projectId: string;
}

interface SessionResponse {
  id: string;
  status: string;
  connectUrl?: string;
}

async function bbRequest(
  path: string,
  config: BrowserbaseConfig,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetchWithRetry(`${BROWSERBASE_API}${path}`, {
    timeoutMs: 30_000,
    ...options,
    headers: {
      'x-bb-api-key': config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Browserbase ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function runBrowserbaseStrategy(
  websiteUrl: string,
  config: BrowserbaseConfig
): Promise<StrategyResult> {
  logger.info(`[browserbase] starting session for ${websiteUrl}`);

  let pw: typeof import('playwright-core') | null = null;
  try {
    pw = await import('playwright-core');
  } catch {
    logger.warn('[browserbase] playwright-core not available, skipping');
    return { services: [], source: 'browserbase' };
  }

  const session = (await bbRequest('/v1/sessions', config, {
    method: 'POST',
    body: JSON.stringify({
      projectId: config.projectId,
      browserSettings: {
        fingerprint: {
          devices: ['desktop'],
          operatingSystems: ['macos'],
        },
      },
    }),
  })) as SessionResponse;

  if (!session.id) {
    throw new Error('Browserbase: no session ID returned');
  }

  logger.info(`[browserbase] session ${session.id} created, connecting CDP...`);

  let browser: import('playwright-core').Browser | null = null;
  try {
    const cdpUrl = `wss://connect.browserbase.com?apiKey=${config.apiKey}&sessionId=${session.id}`;
    browser = await pw.chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });

    const defaultContext = browser.contexts()[0];
    if (!defaultContext) throw new Error('No browser context available');
    const page = defaultContext.pages()[0] ?? (await defaultContext.newPage());

    await page.goto(websiteUrl, {
      waitUntil: 'domcontentloaded',
      timeout: SESSION_TIMEOUT_MS,
    });

    await page.waitForTimeout(3000);

    // Scroll to trigger lazy-loaded content
    await autoScroll(page);

    const serviceLinks = await findServiceLinks(page);
    logger.info(
      `[browserbase] found ${serviceLinks.length} service/pricing links`
    );

    const allTexts: string[] = [];
    const allImageUrls: string[] = [];

    const mainText = await extractPageText(page);
    allTexts.push(`--- Main Page ---\n${mainText}`);
    allImageUrls.push(...(await extractPriceListImages(page)));

    for (const link of serviceLinks.slice(0, 8)) {
      try {
        await page.goto(link, {
          waitUntil: 'domcontentloaded',
          timeout: 20_000,
        });
        await page.waitForTimeout(2000);
        await autoScroll(page);
        const subText = await extractPageText(page);
        allTexts.push(`--- ${link} ---\n${subText}`);
        allImageUrls.push(...(await extractPriceListImages(page)));
      } catch {
        logger.warn(`[browserbase] failed to load ${link}`);
      }
    }

    const rawContent = allTexts.join('\n\n').slice(0, 80_000);
    const uniqueImages = [...new Set(allImageUrls)].slice(0, 10);

    logger.info(
      `[browserbase] extracted ${rawContent.length} chars, ${uniqueImages.length} potential price-list images`
    );

    return {
      services: [],
      rawContent,
      priceListImageUrls: uniqueImages.length > 0 ? uniqueImages : undefined,
      source: 'browserbase',
    };
  } finally {
    try {
      await browser?.close();
    } catch {
      // ignore
    }
    try {
      await bbRequest(`/v1/sessions/${session.id}`, config, {
        method: 'POST',
        body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
      });
    } catch {
      // ignore cleanup failure
    }
  }
}

async function autoScroll(page: import('playwright-core').Page): Promise<void> {
  await page.evaluate(
    `(async () => {
      const delay = ms => new Promise(r => setTimeout(r, ms));
      const distance = 400;
      const maxScrolls = 10;
      let scrolls = 0;
      while (scrolls < maxScrolls) {
        window.scrollBy(0, distance);
        await delay(300);
        scrolls++;
        if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight) break;
      }
      window.scrollTo(0, 0);
    })()`
  );
}

async function findServiceLinks(
  page: import('playwright-core').Page
): Promise<string[]> {
  const servicePattern =
    /service|pricing|price|treatment|menu|package|rate|appointment|book|cost|fee|tariff/i;

  const links: Array<{ href: string; text: string }> = await page.evaluate(
    `(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors.map(a => ({
        href: a.href,
        text: (a.textContent || '').trim(),
      })).filter(l => l.href.startsWith('http'));
    })()`
  );

  const origin = new URL(page.url()).origin;
  const matched = links
    .filter(
      (l) =>
        l.href.startsWith(origin) &&
        (servicePattern.test(l.href) || servicePattern.test(l.text))
    )
    .map((l) => l.href);

  return [...new Set(matched)].slice(0, 15);
}

async function extractPageText(
  page: import('playwright-core').Page
): Promise<string> {
  return page.evaluate(
    `(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, iframe, svg')
        .forEach(el => el.remove());
      return (clone.innerText || '').slice(0, 20000);
    })()`
  ) as Promise<string>;
}

async function extractPriceListImages(
  page: import('playwright-core').Page
): Promise<string[]> {
  const priceKeywords =
    /price|pricing|menu|tariff|rate|cost|treatment.*list|service.*list/i;

  const pageUrl = page.url();
  const isLikelyPricingPage = priceKeywords.test(pageUrl);

  return page.evaluate(
    `((isLikelyPricingPage) => {
      const imgs = Array.from(document.querySelectorAll('img[src]'));
      const results = [];
      for (const img of imgs) {
        const src = img.src;
        if (!src.startsWith('http')) continue;
        const lower = src.toLowerCase();
        if (/logo|icon|favicon|avatar|profile|team|staff|social|banner/.test(lower)) continue;
        if (!/\\.(jpg|jpeg|png|webp)/i.test(lower)) continue;

        const alt = (img.alt || '').toLowerCase();
        const nearby = (img.closest('section, div, article') || {}).textContent || '';
        const nearbyLower = nearby.toLowerCase().slice(0, 500);

        const isRelevant = isLikelyPricingPage
          || /price|menu|tariff|treatment|service|list/i.test(alt)
          || /price|menu|tariff|treatment list|service list/i.test(nearbyLower);

        if (isRelevant) {
          results.push(src);
        }
      }
      return results;
    })(${isLikelyPricingPage})`
  ) as Promise<string[]>;
}
