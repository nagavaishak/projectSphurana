/**
 * Headless Browser Renderer for SPA Websites
 *
 * Uses playwright-core to render JavaScript-heavy pages (SPAs) that return
 * empty shells via fetch(). A shared singleton browser is reused across
 * concurrent requests, with per-request browser contexts for isolation.
 *
 * Gracefully degrades: if playwright-core or Chromium aren't available,
 * all functions return null and the service falls back to fetch-only.
 */

import { createLogger } from '@borradh-workspace/observability';
import { SCRAPER_USER_AGENT } from '../../utils/user-agent.js';

const logger = createLogger('BrowserRenderer');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrowserRenderResult {
  html: string;
  finalUrl: string;
}

export interface BrowserSession {
  renderPage(url: string): Promise<BrowserRenderResult | null>;
  renderPages(
    urls: string[],
    concurrency?: number
  ): Promise<Map<string, BrowserRenderResult | null>>;
  /**
   * Inspect a page's brand styling: the computed colors of brand-relevant
   * elements (buttons/CTAs, header/nav, headings, links, theme CSS variables)
   * ranked by weighted prominence, plus an above-the-fold screenshot as a
   * fallback. Loads CSS + images. Returns empties if Chromium is unavailable.
   */
  captureBrandSignals(url: string): Promise<{
    computedColors: string[];
    logoUrl: string | null;
    screenshot: Buffer | null;
  }>;
  close(): Promise<void>;
}

/**
 * Evaluated inside the page. Samples the rendered colors of the elements that
 * actually carry a brand's identity — CTAs/buttons and brand/primary/accent
 * classed nodes (weighted highest), then header/nav, then headings/links — plus
 * any `--primary`/`--brand`/`--accent` theme CSS variables. Returns hex colors
 * ranked by weighted frequency, so the brand's primary leads. This beats pixel
 * quantization, which surfaces whatever covers the most screen area (hero
 * photos, large section bands) rather than the brand color.
 *
 * Serialized as a string so TypeScript doesn't see `document`/`window` in Node.
 */
const BRAND_COLOR_SCRIPT = `(() => {
  function toRgb(c) {
    if (!c) return null;
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (m) { const a = m[4] === undefined ? 1 : parseFloat(m[4]); if (a < 0.5) return null; return [+m[1], +m[2], +m[3]]; }
    const h = c.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (h) { let x = h[1]; if (x.length === 3) x = x.split('').map(s => s + s).join(''); return [parseInt(x.slice(0,2),16), parseInt(x.slice(2,4),16), parseInt(x.slice(4,6),16)]; }
    return null;
  }
  function hex(rgb) { return '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join(''); }
  const weights = {};
  function bump(rgb, w) { if (!rgb) return; const k = rgb.join(','); weights[k] = (weights[k] || 0) + w; }
  const groups = [
    { sel: 'button,[role="button"],a[class*="btn"],a[class*="button"],[class*="cta"],[class*="Cta"],[class*="CTA"],[class*="brand"],[class*="primary"],[class*="accent"]', w: 5 },
    { sel: 'header,nav', w: 3 },
    { sel: 'h1,h2,h3,a', w: 1 },
  ];
  for (const g of groups) {
    for (const el of document.querySelectorAll(g.sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      bump(toRgb(s.backgroundColor), g.w);
      bump(toRgb(s.color), g.w * 0.4);
      bump(toRgb(s.borderColor), g.w * 0.3);
      bump(toRgb(s.fill), g.w);
    }
  }
  const root = getComputedStyle(document.documentElement);
  for (const prop of root) {
    if (prop.indexOf('--') === 0 && /(primary|brand|accent|cta)/i.test(prop)) {
      bump(toRgb(root.getPropertyValue(prop)), 8);
    }
  }
  function sat(rgb) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  }
  // Final score = sqrt(prominence) × vividness. sqrt compresses frequency so a
  // saturated brand hue outranks a very high-frequency but washed-out section
  // background (which would otherwise dominate purely by element count).
  const colors = Object.entries(weights)
    .map(([k, w]) => { const rgb = k.split(',').map(Number); return [hex(rgb), Math.sqrt(w) * (0.2 + sat(rgb))]; })
    .sort((a, b) => b[1] - a[1])
    .map(([h]) => h);

  // Find the brand logo in the RENDERED header — the native HTML shell of a
  // JS-rendered site has no logo <img> (and its og:image is often a hero photo,
  // not the logo). Score by logo-ish src/alt/class, home-link ancestor, header
  // placement and top-left position; reject social/payment/badge icons.
  function findLogo() {
    const bad = /tiktok|instagram|facebook|twitter|youtube|linkedin|whatsapp|pinterest|flag|promo|payment|visa|mastercard|amex|paypal|klarna|trustpilot|review|google|award|badge|cqc|rating|star/i;
    // <img> candidates (incl. lazyloaded data-* sources).
    const sel = 'a[href="/"] img,[class*="logo" i] img,img[class*="logo" i],img[alt*="logo" i],img[src*="logo" i],header img,nav img';
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.top > 220) continue;
      const src = el.currentSrc || el.src || el.getAttribute('data-src') ||
        el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || '';
      if (!src || src.startsWith('data:')) continue;
      const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
      const hay = (src + ' ' + (el.getAttribute('alt') || '') + ' ' + cls).toLowerCase();
      if (bad.test(hay)) continue;
      let score = 0;
      if (/logo/.test(hay)) score += 5;
      if (el.closest('a[href="/"]') || el.closest('a[href="' + location.origin + '/"]')) score += 3;
      if (el.closest('header,nav')) score += 2;
      score += Math.max(0, 3 - r.left / 120);
      if (score > bestScore) { bestScore = score; best = src; }
    }
    if (bestScore >= 6) return best;
    // CSS background-image logos (common in WordPress / themed headers).
    const bgSel = 'a[href="/"],a[href="' + location.origin + '/"],[class*="logo" i],header [class*="brand" i]';
    for (const el of document.querySelectorAll(bgSel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.top > 220) continue;
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (m && m[1] && !/gradient/i.test(bg) && !m[1].startsWith('data:')) return m[1];
    }
    return null;
  }

  // apple-touch-icon is a clean, square brand mark present on most sites
  // (incl. JS shells) — a good fallback when no header logo is found.
  function appleTouchIcon() {
    const el = document.querySelector('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
    const href = el && el.getAttribute('href');
    return href ? new URL(href, location.href).href : null;
  }

  return { colors, logo: findLogo(), appleTouchIcon: appleTouchIcon() };
})()`;

interface BrowserSessionOptions {
  /** Per-page navigation timeout in ms (default: 15000) */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Singleton browser manager
// ---------------------------------------------------------------------------

/** Lazily-imported playwright-core module */
let playwrightMod: typeof import('playwright-core') | null | undefined;

/** The shared Chromium browser instance */
let sharedBrowser: import('playwright-core').Browser | null = null;

/** Number of active sessions using the shared browser */
let activeSessionCount = 0;

/** Timer that closes the browser after idle period */
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const IDLE_SHUTDOWN_MS = 30_000; // Close browser after 30s of no activity
const MAX_CONCURRENT_SESSIONS = 3;

/**
 * Max time to wait for a session slot. Slot holders can wedge (a Chromium
 * that stops answering protocol calls never releases), and an unbounded wait
 * here deadlocked EVERY subsequent website analysis until the process
 * restarted — the onboarding "Analysing" step hung forever. Callers degrade
 * to fetch-only scraping when no slot frees up.
 */
const SLOT_WAIT_TIMEOUT_MS = 15_000;

interface SlotWaiter {
  wake: (acquired: boolean) => void;
}
const waitingQueue: Array<SlotWaiter> = [];

async function getPlaywright(): Promise<
  typeof import('playwright-core') | null
> {
  if (playwrightMod !== undefined) return playwrightMod;
  try {
    playwrightMod = await import('playwright-core');
    return playwrightMod;
  } catch {
    logger.warn('playwright-core not available — browser rendering disabled');
    playwrightMod = null;
    return null;
  }
}

async function acquireBrowser(): Promise<
  import('playwright-core').Browser | null
> {
  const pw = await getPlaywright();
  if (!pw) return null;

  // Wait for a slot if at capacity — but never forever (see SLOT_WAIT_TIMEOUT_MS)
  if (activeSessionCount >= MAX_CONCURRENT_SESSIONS) {
    logger.info(
      `[browser] at capacity (${activeSessionCount}/${MAX_CONCURRENT_SESSIONS}), queueing`
    );
    const acquired = await new Promise<boolean>((resolve) => {
      let settled = false;
      const waiter: SlotWaiter = {
        wake: (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(ok);
        },
      };
      const timer = setTimeout(() => {
        const idx = waitingQueue.indexOf(waiter);
        if (idx >= 0) waitingQueue.splice(idx, 1);
        waiter.wake(false);
      }, SLOT_WAIT_TIMEOUT_MS);
      timer.unref?.();
      waitingQueue.push(waiter);
    });
    if (!acquired) {
      logger.warn(
        `[browser] no session slot freed within ${SLOT_WAIT_TIMEOUT_MS}ms — proceeding without browser rendering`
      );
      return null;
    }
  }

  // Clear idle timer since we're about to use the browser
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (sharedBrowser?.isConnected()) {
    activeSessionCount++;
    return sharedBrowser;
  }

  // Launch new browser
  try {
    sharedBrowser = await pw.chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    activeSessionCount++;
    logger.info('[browser] launched shared Chromium instance');
    return sharedBrowser;
  } catch (error) {
    logger.warn(
      `[browser] failed to launch Chromium: ${error instanceof Error ? error.message : String(error)}`
    );
    sharedBrowser = null;
    return null;
  }
}

function releaseBrowser(): void {
  activeSessionCount = Math.max(0, activeSessionCount - 1);

  // Wake up next queued request
  if (waitingQueue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: length check guarantees element exists
    const next = waitingQueue.shift()!;
    next.wake(true);
    return;
  }

  // Schedule idle shutdown if no one is using the browser
  if (activeSessionCount === 0 && sharedBrowser) {
    idleTimer = setTimeout(async () => {
      if (activeSessionCount === 0 && sharedBrowser) {
        logger.info('[browser] idle timeout — closing shared browser');
        try {
          await sharedBrowser.close();
        } catch {
          /* already closed */
        }
        sharedBrowser = null;
      }
    }, IDLE_SHUTDOWN_MS);
  }
}

// ---------------------------------------------------------------------------
// SPA detection heuristic
// ---------------------------------------------------------------------------

/**
 * Detect whether an HTML response is likely an SPA shell that needs browser
 * rendering to get actual content.
 */
export function needsBrowserRendering(
  html: string,
  extractedText: string,
  childLinksCount: number
): boolean {
  const htmlLen = html.length;
  const textLen = extractedText.length;

  // Very sparse text relative to HTML size
  if (htmlLen > 5000 && textLen < 500 && textLen / htmlLen < 0.05) {
    logger.debug(
      `[spa-detect] sparse text: ${textLen}/${htmlLen} = ${((textLen / htmlLen) * 100).toFixed(1)}%`
    );
    return true;
  }

  // Next.js static export with empty pageProps
  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextDataMatch?.[1]) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const pageProps = data?.props?.pageProps;
      if (
        pageProps &&
        typeof pageProps === 'object' &&
        Object.keys(pageProps).length === 0
      ) {
        logger.debug('[spa-detect] empty Next.js pageProps');
        return true;
      }
    } catch {
      /* not valid JSON */
    }
  }

  // Empty framework root div (content loaded via JS)
  const emptyRootPattern =
    /<div[^>]*id=["'](?:__next|app|root)["'][^>]*>\s*<\/div>/i;
  if (emptyRootPattern.test(html)) {
    logger.debug('[spa-detect] empty framework root div');
    return true;
  }

  // Location listing page with zero child links + JS router detected
  if (childLinksCount === 0 && textLen < 1000) {
    const hasJsRouter =
      /next\/router|react-router|vue-router|@angular\/router|nuxt/i.test(html);
    if (hasJsRouter) {
      logger.debug('[spa-detect] location page with 0 child links + JS router');
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Browser session
// ---------------------------------------------------------------------------

/** Blocked resource types for faster rendering */
const BLOCKED_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

/** URL patterns to block (analytics, tracking, ads) */
const BLOCKED_URL_PATTERNS = [
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.net',
  'hotjar.com',
  'clarity.ms',
  'doubleclick.net',
  'googlesyndication.com',
];

/**
 * Settle `work` within `ms`, else resolve with `fallback()`. Playwright
 * protocol calls (newContext/content/evaluate/close) carry no timeout of
 * their own; on a wedged Chromium they never settle, which used to hang the
 * whole analysis pipeline awaiting a session method. The abandoned work keeps
 * running detached — its context is reaped when the shared browser closes.
 */
async function settleWithin<T>(
  work: Promise<T>,
  ms: number,
  fallback: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Slack over the page-navigation timeout for the surrounding protocol calls. */
const RENDER_DEADLINE_SLACK_MS = 15_000;
/** Capture also waits a settle delay and takes a screenshot (own 30s cap). */
const CAPTURE_DEADLINE_SLACK_MS = 45_000;

/**
 * Create a browser session backed by the shared singleton browser.
 * Returns null if playwright-core or Chromium are unavailable.
 */
export async function createBrowserSession(
  options?: BrowserSessionOptions
): Promise<BrowserSession | null> {
  const maybeBrowser = await acquireBrowser();
  if (!maybeBrowser) return null;
  const browser = maybeBrowser;

  const timeoutMs = options?.timeoutMs ?? 15_000;
  let closed = false;

  async function renderPageInner(
    url: string
  ): Promise<BrowserRenderResult | null> {
    if (closed || !browser.isConnected()) return null;

    const context = await browser.newContext({
      userAgent: SCRAPER_USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });

    try {
      const page = await context.newPage();

      // Block heavy resources
      await page.route('**/*', (route) => {
        const req = route.request();
        if (BLOCKED_TYPES.has(req.resourceType())) {
          return route.abort();
        }
        const reqUrl = req.url();
        if (BLOCKED_URL_PATTERNS.some((p) => reqUrl.includes(p))) {
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: timeoutMs,
      });

      // Extra settle time for late SPA hydration
      await page.waitForTimeout(1500);

      const html = await page.content();
      const finalUrl = page.url();

      logger.info(`[browser] rendered ${url} → ${html.length} chars`);
      return { html, finalUrl };
    } catch (error) {
      logger.warn(
        `[browser] render failed for ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    } finally {
      await context.close();
    }
  }

  function renderPage(url: string): Promise<BrowserRenderResult | null> {
    return settleWithin(
      renderPageInner(url),
      timeoutMs + RENDER_DEADLINE_SLACK_MS,
      () => {
        logger.warn(
          `[browser] render exceeded overall deadline for ${url} — abandoning`
        );
        return null;
      }
    );
  }

  async function renderPages(
    urls: string[],
    concurrency = 2
  ): Promise<Map<string, BrowserRenderResult | null>> {
    const results = new Map<string, BrowserRenderResult | null>();
    const queue = [...urls];

    async function worker(): Promise<void> {
      while (queue.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length check in while guarantees element exists
        const url = queue.shift()!;
        const result = await renderPage(url);
        results.set(url, result);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, urls.length) },
      () => worker()
    );
    await Promise.all(workers);
    return results;
  }

  async function captureBrandSignalsInner(url: string): Promise<{
    computedColors: string[];
    logoUrl: string | null;
    screenshot: Buffer | null;
  }> {
    const empty = {
      computedColors: [] as string[],
      logoUrl: null as string | null,
      screenshot: null as Buffer | null,
    };
    if (closed || !browser.isConnected()) return empty;

    const context = await browser.newContext({
      userAgent: SCRAPER_USER_AGENT,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });

    try {
      const page = await context.newPage();

      // Block only trackers/analytics — NOT images/CSS, which we need to
      // render the brand's actual colors.
      await page.route('**/*', (route) => {
        const reqUrl = route.request().url();
        if (BLOCKED_URL_PATTERNS.some((p) => reqUrl.includes(p))) {
          return route.abort();
        }
        return route.continue();
      });

      // domcontentloaded + a fixed settle beats networkidle here: heavy
      // marketing sites (trackers, chat widgets, video) often never reach
      // networkidle, which would time out and lose the capture entirely.
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      // Let hero images / webfonts / above-the-fold CSS paint so colors are stable.
      await page.waitForTimeout(2500);

      let computedColors: string[] = [];
      let logoUrl: string | null = null;
      try {
        const result = (await page.evaluate(BRAND_COLOR_SCRIPT)) as unknown;
        if (result && typeof result === 'object') {
          const r = result as {
            colors?: unknown;
            logo?: unknown;
            appleTouchIcon?: unknown;
          };
          if (Array.isArray(r.colors)) {
            computedColors = r.colors.filter(
              (c): c is string => typeof c === 'string'
            );
          }
          // Prefer the header logo; fall back to the apple-touch-icon brand mark.
          if (typeof r.logo === 'string' && r.logo) logoUrl = r.logo;
          else if (typeof r.appleTouchIcon === 'string' && r.appleTouchIcon) {
            logoUrl = r.appleTouchIcon;
          }
        }
      } catch (error) {
        logger.warn(
          `[browser] brand-signal eval failed for ${url}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      let screenshot: Buffer | null = null;
      try {
        // Above-the-fold only: the header/hero carries the brand palette.
        screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 80,
          clip: { x: 0, y: 0, width: 1280, height: 800 },
        });
      } catch {
        // Screenshot is only a fallback; ignore failures.
      }

      logger.info(
        `[browser] brand signals ${url} → ${computedColors.length} computed colors, logo=${logoUrl ? 'found' : 'none'}, screenshot=${screenshot ? `${screenshot.length}b` : 'none'}`
      );
      return { computedColors, logoUrl, screenshot };
    } catch (error) {
      logger.warn(
        `[browser] brand-signal capture failed for ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
      return empty;
    } finally {
      await context.close();
    }
  }

  function captureBrandSignals(url: string): Promise<{
    computedColors: string[];
    logoUrl: string | null;
    screenshot: Buffer | null;
  }> {
    return settleWithin(
      captureBrandSignalsInner(url),
      timeoutMs + CAPTURE_DEADLINE_SLACK_MS,
      () => {
        logger.warn(
          `[browser] brand-signal capture exceeded overall deadline for ${url} — abandoning`
        );
        return {
          computedColors: [] as string[],
          logoUrl: null as string | null,
          screenshot: null as Buffer | null,
        };
      }
    );
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    releaseBrowser();
  }

  return { renderPage, renderPages, captureBrandSignals, close };
}
