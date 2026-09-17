import { expect, test } from '@playwright/test';
import {
  assertNoPageErrors,
  collectConsoleErrors,
  runAxeScan,
} from './helpers.js';

/**
 * Accessibility scans — public (unauthenticated) pages.
 *
 * Automated axe-core WCAG 2.0/2.1 A+AA scans of /sign-in and /sign-up.
 * Separate file from a11y.spec.ts because `test.use({ storageState })` is
 * per-file: these pages must be scanned WITHOUT the bare-org session, or
 * the SPA would redirect straight into the dashboard.
 * In CI this suite is ADVISORY (non-blocking): critical/serious violations
 * fail the test, moderate/minor findings are attached to the report only.
 */

// Scan unauthenticated — override the project's bare-org storageState.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('a11y — public pages', () => {
  for (const path of ['/sign-in', '/sign-up']) {
    test(`${path} has no critical/serious axe violations`, async ({ page }) => {
      const errors = collectConsoleErrors(page);

      // Vite dev cold-compiles each route on first hit; `domcontentloaded`
      // returns before every chunk is loaded.
      await page.goto(path, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });

      // Anchor: the auth form's email field confirms the page mounted.
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await runAxeScan(page, path);
      await assertNoPageErrors(errors);
    });
  }
});
