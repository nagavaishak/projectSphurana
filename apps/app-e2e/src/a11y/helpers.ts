import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Shared helpers for the a11y project (src/a11y/*.spec.ts).
 *
 * Each scanned page gets:
 *   - an axe-core WCAG 2.0/2.1 A+AA scan, with the full violations JSON
 *     attached to the report ('axe-violations')
 *   - a hard assertion only on 'critical' / 'serious' impact violations —
 *     moderate/minor findings are logged + attached but do not fail (the CI
 *     job itself is advisory too)
 *   - console error collection: uncaught page errors fail the test;
 *     console.error output is attached ('console-errors') but non-fatal
 *     (third-party scripts are noisy).
 */

export interface ConsoleErrorCollector {
  /** Uncaught exceptions (page.on('pageerror')) — these fail the test. */
  pageErrors: string[];
  /** console.error output — attached, non-fatal. */
  consoleErrors: string[];
}

/** Register console/pageerror listeners. Call BEFORE any navigation. */
export function collectConsoleErrors(page: Page): ConsoleErrorCollector {
  const collector: ConsoleErrorCollector = {
    pageErrors: [],
    consoleErrors: [],
  };
  page.on('pageerror', (error) => {
    collector.pageErrors.push(error.stack ?? error.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') collector.consoleErrors.push(msg.text());
  });
  return collector;
}

/** Attach collected errors and assert zero uncaught page errors. */
export async function assertNoPageErrors(
  collector: ConsoleErrorCollector
): Promise<void> {
  await test.info().attach('console-errors', {
    body: JSON.stringify(collector, null, 2),
    contentType: 'application/json',
  });
  expect(
    collector.pageErrors,
    `Uncaught page errors:\n${collector.pageErrors.join('\n---\n')}`
  ).toHaveLength(0);
}

/**
 * Run an axe WCAG A+AA scan of the current page state. Attaches the full
 * violations JSON and fails only on critical/serious violations.
 */
export async function runAxeScan(page: Page, label: string): Promise<void> {
  // SETTLE FIRST. Axe photographs whatever is on screen, and a surface that is
  // still loading is mostly `Skeleton` blocks — pale grey on white, which axe
  // correctly reports as a 1.4:1 `color-contrast` violation. That made the
  // suite non-deterministic in the worst way: a different set of pages failed
  // on each run, every one of them passed in isolation, and the "defect" was a
  // placeholder nobody ever sees finished.
  //
  // Waiting on the skeletons themselves rather than a fixed timeout: the
  // condition we actually need is "the page has its real content".
  await page
    .locator('[data-slot="skeleton"]')
    .first()
    .waitFor({ state: 'detached', timeout: 30_000 })
    .catch(() => {
      // No skeleton ever rendered — the page was already settled.
    });

  // Stylesheets included: scanning mid-load can also catch a stale or
  // not-yet-applied stylesheet and measure the PREVIOUS token values, which is
  // how a contrast fix looked like it had not landed.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
    // A surface that polls never goes idle; the skeleton wait above is the
    // load-bearing one.
  });

  // @axe-core/playwright resolves its own playwright-core peer, which can lag
  // app-e2e's @playwright/test by a patch (1.57 vs 1.58). The Page shape is
  // identical across the patch, so bridge the nominal type mismatch here.
  const { violations } = await new AxeBuilder({
    page,
  } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  await test.info().attach('axe-violations', {
    body: JSON.stringify(violations, null, 2),
    contentType: 'application/json',
  });

  if (violations.length > 0) {
    // Compact advisory summary for the console/CI log.
    const summary = violations
      .map(
        (v) =>
          `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`
      )
      .join('\n');
    console.log(
      `[a11y] ${label}: ${violations.length} violation rule(s):\n${summary}`
    );
  }

  const blocking = violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  );
  const detail = blocking
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} — ${v.helpUrl}`)
    .join('\n');
  expect(
    blocking,
    `${label}: ${blocking.length} critical/serious accessibility violation(s) — see the 'axe-violations' attachment for full details:\n${detail}`
  ).toHaveLength(0);
}
