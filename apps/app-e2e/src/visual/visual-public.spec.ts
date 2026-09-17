import { expect, test } from '@playwright/test';
import {
  makeDeterministic,
  masksFor,
  waitForVisualStability,
} from './determinism.js';
import { PUBLIC_ROUTES, snapshotName } from './routes.js';

/**
 * Visual regression — public (unauthenticated) surfaces.
 *
 * Separated from the authenticated spec because it runs with NO storageState:
 * sign-in is the highest-traffic surface in the product and the one most likely
 * to be broken by a global CSS or layout change, so it must be captured as a
 * signed-out visitor actually sees it rather than through an authed session.
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('visual regression — public', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const viewport of VIEWPORTS) {
    for (const route of PUBLIC_ROUTES) {
      test(`${route} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await makeDeterministic(page);

        await page.goto(route);
        await waitForVisualStability(page);

        await expect(page).toHaveScreenshot(
          snapshotName(route, viewport.name),
          {
            fullPage: true,
            mask: masksFor(page),
          }
        );
      });
    }
  }
});
