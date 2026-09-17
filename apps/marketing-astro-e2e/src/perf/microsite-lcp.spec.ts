/**
 * §9 of the plan, measured in a browser:
 *
 *   "Budget: LCP < 2.0s on 4G — ad landing pages that load slowly cost money
 *    directly."
 *
 * The cheap half of this budget — the STRUCTURAL causes of a slow LCP (client
 * JS, unsized images, a lazy hero, webfonts) — is asserted on every commit,
 * with no browser, in
 * `apps/marketing-astro/src/components/microsite/perf/perf-budget.render.test.ts`.
 * That is the layer that catches regressions. This one measures the number
 * itself, which the structural layer cannot.
 *
 * WHY THIS IS OPT-IN
 * ------------------
 * A wall-clock LCP measured against a deployed preview is a measurement of the
 * runner, the network, and a possibly-cold serverless function as much as of
 * the page. Wired into every PR at a 2.0s budget it would fail for reasons
 * that have nothing to do with the diff — and a perf test that fails randomly
 * is disabled within a week, after which it protects nothing.
 *
 * So it runs only where the measurement is meaningful, gated on ENVIRONMENT,
 * declared up front:
 *
 *   MICROSITE_PERF_URL   a PUBLISHED microsite page to measure. Required.
 *                        No URL → the whole file skips, before a browser opens.
 *   MICROSITE_LCP_BUDGET_MS   default 2000.
 *   MICROSITE_PERF_RUNS       default 5. The MEDIAN is asserted, never a
 *                             single sample.
 *
 * There is no seeded fallback on purpose: the thing being measured is a real
 * published tenant page with real images over a real CDN, and a synthetic
 * stand-in would measure the wrong thing while looking authoritative.
 */
import { type Page, expect, test } from '@playwright/test';

const PERF_URL = process.env.MICROSITE_PERF_URL ?? '';
const BUDGET_MS = Number(process.env.MICROSITE_LCP_BUDGET_MS ?? 2000);
const RUNS = Number(process.env.MICROSITE_PERF_RUNS ?? 5);

/**
 * Lighthouse's "Slow 4G" preset — the same profile the budget in §9 was written
 * against. Hard-coded rather than taken from the environment: a budget is only
 * a budget if the conditions it is measured under are fixed.
 */
const SLOW_4G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};
/** Mid-tier mobile CPU, as Lighthouse models it. */
const CPU_SLOWDOWN = 4;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/**
 * Navigate once under throttling and return the largest-contentful-paint time.
 *
 * The observer is installed via `addInitScript` so it is running before the
 * document's first byte — a PerformanceObserver registered after load misses
 * the entries it is there to collect, and `buffered: true` alone is not
 * enough once the page has settled.
 */
const measureLcp = async (page: Page, url: string): Promise<number> => {
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        (window as unknown as { __lcp: number }).__lcp = entry.startTime;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

  await page.goto(url, { waitUntil: 'load' });
  // LCP can still be revised after `load` (a late-decoding hero). Waiting for
  // the network to go quiet is a real condition, not a blind sleep.
  await page.waitForLoadState('networkidle');

  const lcp = await page.evaluate(
    () => (window as unknown as { __lcp: number }).__lcp
  );
  await cdp.detach();
  return lcp;
};

test.describe('a published microsite meets the §9 LCP budget on 4G', () => {
  // ENVIRONMENT gate, declared before anything runs. Never a skip on what the
  // page turned out to contain.
  test.skip(
    !PERF_URL,
    'Set MICROSITE_PERF_URL to a published microsite page to run the LCP budget check.'
  );

  // Five throttled Slow-4G loads plus a warm-up, at ~2s each, against a
  // possibly-cold preview.
  test.setTimeout(180_000);

  test(`LCP median of ${RUNS} loads is under ${BUDGET_MS}ms`, async ({
    page,
  }) => {
    // Warm-up, discarded: the first hit to a preview pays for a cold
    // serverless function and an unwarmed CDN, neither of which a real visitor
    // to a live ad landing page pays for. Measuring it would measure Vercel.
    await measureLcp(page, PERF_URL);

    const samples: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      samples.push(await measureLcp(page, PERF_URL));
    }

    // A sample of 0 means no LCP entry was ever recorded — the page rendered
    // nothing paintable, or the observer never attached. Either way the
    // measurement is void and must fail loudly rather than pass as "fast".
    expect(
      Math.min(...samples),
      `No largest-contentful-paint recorded on at least one run (${samples.join(', ')}ms). The measurement is void — the budget below would be vacuous.`
    ).toBeGreaterThan(0);

    const p50 = median(samples);
    expect(
      p50,
      `LCP median ${Math.round(p50)}ms over ${RUNS} Slow-4G loads of ${PERF_URL} (samples: ${samples.map(Math.round).join(', ')}ms). Budget is ${BUDGET_MS}ms — see the structural budget test in apps/marketing-astro for the usual causes (client JS, unsized images, a lazy hero, a webfont).`
    ).toBeLessThan(BUDGET_MS);
  });
});
