import { expect, test } from '@playwright/test';
import { branchUrl } from './fixtures/branch.fixture.js';

/**
 * Smoke Tests — Critical path checks only.
 *
 * Auth validation, signup flows, and detailed error handling
 * are tested in auth/*.spec.ts and journeys/onboarding.spec.ts.
 * This file only verifies that key pages are reachable.
 *
 * Ported from apps/web-e2e/src/smoke.spec.ts. Differences for the Vite SPA
 * in apps/app: no cookie banner, cookie-session auth (TanStack Router
 * beforeLoad guards).
 *
 * Vite dev cold-compiles routes on first hit; `waitUntil: 'domcontentloaded'`
 * lets goto return before the load event waits on every chunk, and the longer
 * visibility timeouts give React time to render after the route resolves.
 */

// Vite dev cold-compiles each route the first time it's hit. The default 30s
// navigation timeout can flake on first hit; bump it here. `domcontentloaded`
// is faster than `load` (no waiting for every chunk) and lets the visibility
// asserts auto-wait for React to render.
const COLD_NAV_TIMEOUT = 60_000;
const FIRST_PAINT_TIMEOUT = 30_000;

test.describe('Smoke Tests', () => {
  test('sign-in page is accessible', async ({ page }) => {
    await page.goto('/sign-in', {
      waitUntil: 'domcontentloaded',
      timeout: COLD_NAV_TIMEOUT,
    });

    // `exact: true` avoids matching the TanStack Router devtools button
    // (aria-label="Open match details for /verify-email") in dev mode.
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign in|log in/i })
    ).toBeVisible();
  });

  test('sign-up page is accessible', async ({ page }) => {
    await page.goto('/sign-up', {
      waitUntil: 'domcontentloaded',
      timeout: COLD_NAV_TIMEOUT,
    });

    await expect(page.getByLabel('Email', { exact: true })).toBeVisible({
      timeout: FIRST_PAINT_TIMEOUT,
    });
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign up|create account|register/i })
    ).toBeVisible();
  });

  test('unauthenticated user is redirected to sign-in', async ({ page }) => {
    await page.goto(await branchUrl(page, '/dashboard/home'), {
      waitUntil: 'domcontentloaded',
      timeout: COLD_NAV_TIMEOUT,
    });
    await expect(page).toHaveURL(/sign-in/, { timeout: FIRST_PAINT_TIMEOUT });
  });

  test('can navigate between sign-in and sign-up', async ({ page }) => {
    await page.goto('/sign-in', {
      waitUntil: 'domcontentloaded',
      timeout: COLD_NAV_TIMEOUT,
    });

    await page
      .getByRole('link', { name: /sign up|create account|register/i })
      .click();
    await expect(page).toHaveURL(/sign-up/);

    await page
      .getByRole('link', { name: /sign in|log in|already have/i })
      .click();
    await expect(page).toHaveURL(/sign-in/);
  });
});
