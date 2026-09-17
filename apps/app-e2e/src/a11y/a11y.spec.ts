import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { branchUrl } from '../fixtures/branch.fixture.js';
import {
  assertNoPageErrors,
  collectConsoleErrors,
  runAxeScan,
} from './helpers.js';

/**
 * Accessibility scans — authenticated surfaces (bare org).
 *
 * Automated axe-core WCAG 2.0/2.1 A+AA scans of the key logged-in surfaces.
 * Runs in the `a11y` project with the bare-org storageState from setup-bare.
 *
 * Runs on EVERY PR as the `a11y` suite in `.github/workflows/e2e.yml`, but
 * ADVISORY for now (`advisory: true` → `continue-on-error`): it reports without
 * blocking. Promote it into that file's SELF_CONTAINED array to make it a gate.
 *
 * Before this it ran on no pull request at all — the only lane invoking it was
 * the manual `qa-explorer.yml` workflow — which is how the sidebar shipped
 * `<ul> > <div> > <li>` (seven `serious` nodes on every authenticated page)
 * alongside 384 `critical` aria nodes on the calendar, an unnamed icon button,
 * and body copy at 4.42:1.
 *
 * ADDING A SURFACE IS CHEAP AND IS THE POINT: the gate is worth exactly what it
 * covers. Prefer adding a route to `BRANCH_SURFACES` below over reviewing a
 * page by hand.
 *
 * Unauthenticated pages (/sign-in, /sign-up) live in a11y-public.spec.ts —
 * `test.use({ storageState })` is per-file, so the empty-state override
 * needs its own spec file.
 */

/**
 * Branch-scoped surfaces, scanned generically.
 *
 * `anchor` is a locator that proves the page's OWN content mounted, not just
 * the app shell — scanning the shell alone would pass while the page beneath it
 * was empty or errored.
 */
const BRANCH_SURFACES: {
  name: string;
  path: string;
  anchor: (page: Page) => Locator;
}[] = [
  {
    // No <h1>: the calendar's chrome is its toolbar (Today / the date / the
    // team filter), so anchor on that rather than a heading that never renders.
    name: 'calendar',
    path: '/dashboard/calendar/day',
    anchor: (page) => page.getByRole('button', { name: 'Today', exact: true }),
  },
  {
    name: 'clients',
    path: '/dashboard/customers',
    anchor: (page) =>
      page.getByRole('button', { name: /add customer/i }).first(),
  },
  {
    name: 'catalog · services',
    path: '/dashboard/catalog/services',
    anchor: (page) => page.getByRole('heading', { level: 1 }),
  },
  {
    name: 'sales · daily summary',
    path: '/dashboard/sales/daily-summary',
    anchor: (page) => page.getByRole('heading', { level: 1 }),
  },
  {
    name: 'team · members',
    path: '/dashboard/team/members',
    anchor: (page) => page.getByRole('heading', { level: 1 }),
  },
  {
    // No <h1> either — the planner leads with its List/Calendar tabs.
    name: 'marketing · socials',
    path: '/dashboard/marketing/socials',
    anchor: (page) => page.getByRole('tab', { name: 'List', exact: true }),
  },
];

/** Org-level surfaces (no branch in the URL). */
const ORG_SURFACES: {
  name: string;
  path: string;
  anchor: (page: Page) => Locator;
}[] = [
  {
    name: 'integrations settings',
    path: '/dashboard/settings/integrations',
    // The Facebook provider card heading confirms the integration list itself
    // rendered, not just the settings shell.
    anchor: (page) =>
      page.getByRole('heading', { name: 'Facebook', exact: true }),
  },
  {
    name: 'organisation settings hub',
    path: '/dashboard/organisation',
    anchor: (page) => page.getByRole('heading', { level: 1 }),
  },
  {
    name: 'locations',
    path: '/dashboard/locations',
    anchor: (page) => page.getByRole('heading', { level: 1 }),
  },
];

test.describe('a11y — authenticated surfaces', () => {
  test('dashboard home has no critical/serious axe violations', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // Vite SPA: `domcontentloaded` is the safe waitUntil — the default
    // 'load' can hang while runtime-config + session queries keep the
    // network busy past navigation timeout.
    await page.goto(await branchUrl(page, '/dashboard/home'), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Anchor: greeting heading — the SPA fetches runtime-config + session
    // before mounting, so give it a generous timeout.
    await expect(
      page
        .getByRole('heading', { level: 1 })
        .filter({ hasText: /welcome back,/i })
    ).toBeVisible({ timeout: 30_000 });

    await runAxeScan(page, await branchUrl(page, '/dashboard/home'));
    await assertNoPageErrors(errors);
  });

  for (const surface of BRANCH_SURFACES) {
    test(`${surface.name} has no critical/serious axe violations`, async ({
      page,
    }) => {
      const errors = collectConsoleErrors(page);
      const url = await branchUrl(page, surface.path);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(surface.anchor(page).first()).toBeVisible({
        timeout: 30_000,
      });

      await runAxeScan(page, url);
      await assertNoPageErrors(errors);
    });
  }

  for (const surface of ORG_SURFACES) {
    test(`${surface.name} has no critical/serious axe violations`, async ({
      page,
    }) => {
      const errors = collectConsoleErrors(page);

      await page.goto(surface.path, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(surface.anchor(page).first()).toBeVisible({
        timeout: 30_000,
      });

      await runAxeScan(page, surface.path);
      await assertNoPageErrors(errors);
    });
  }
});
