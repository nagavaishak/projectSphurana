import { expect, test } from '@playwright/test';
import { branchUrl } from '../fixtures/branch.fixture.js';

/**
 * Content Calendar — disconnected state (apps/app).
 *
 * Route: `/dashboard/content-calendar` (redirects to `/month`).
 * Auth: bare org via the `authenticated` project's storageState — no
 * per-test sign-in. Just navigate.
 *
 * Verifies the calendar shows the "Connect a social account" empty state
 * when no Meta integration is connected. No mocking — hits the real API.
 *
 * Connected-state coverage lives in `social-posts/*.connected.spec.ts`.
 *
 * apps/app differences from apps/web-e2e:
 *   - Empty-state CTA links to `/dashboard/settings/integrations`
 *     (apps/web pointed to `/dashboard/integrations`).
 *   - shadcn's `EmptyTitle` renders as a `<div>` (not `<h*>`), so use
 *     `getByText`, not `getByRole('heading')`.
 *   - Plain `page.goto(path)` — same pattern as `dashboard.spec.ts`. No
 *     `waitUntil: 'domcontentloaded'` override; the cold-compile cost
 *     gets absorbed by the 30s content timeouts below.
 */

const CONTENT_CALENDAR = '/dashboard/content-calendar';

test.describe('Content Calendar — Disconnected', () => {
  test('shows connect social account empty state', async ({ page }) => {
    await page.goto(await branchUrl(page, CONTENT_CALENDAR));

    // Vite cold-compile + the provider's three integration queries can
    // take 10–15s before the empty state renders.
    await expect(page.getByText('Connect a social account')).toBeVisible({
      timeout: 30_000,
    });

    await expect(
      page.getByText(/connect your Facebook or Instagram account/i)
    ).toBeVisible();
  });

  test('connect account button links to integrations', async ({ page }) => {
    await page.goto(await branchUrl(page, CONTENT_CALENDAR));

    const connectLink = page.getByRole('link', { name: /connect account/i });
    await expect(connectLink).toBeVisible({ timeout: 30_000 });
    // apps/app routes to /dashboard/settings/integrations
    // (vs apps/web's /dashboard/integrations).
    await expect(connectLink).toHaveAttribute(
      'href',
      /\/dashboard\/(settings\/)?integrations/
    );
  });

  test('schedule content button is not shown when disconnected', async ({
    page,
  }) => {
    await page.goto(await branchUrl(page, CONTENT_CALENDAR));

    // Wait for the empty state so we know the provider resolved out of
    // its loading state — otherwise the negative assertion below would
    // race the skeleton, which also has no "Schedule content" button.
    await expect(page.getByText('Connect a social account')).toBeVisible({
      timeout: 30_000,
    });

    await expect(
      page.getByRole('button', { name: /schedule content/i })
    ).toHaveCount(0);
  });
});
