import { expect, test } from '@playwright/test';

/**
 * Integrations — Connected Org (apps/app port)
 *
 * Route: /dashboard/settings/integrations
 * Auth: connected-user — applied automatically by the `connected` project
 *   via storageState from `setup-connected`.
 *
 * Verifies that the connected org shows Facebook connected and keeps Instagram
 * available as its own connection.
 *
 * Card layout: setup-connected seeds the integration from the never-expiring
 * system-user token and stamps `connection_method = 'flfb'`, so the connected
 * org is deterministically an FLfB connection and integrations-grid renders the
 * Facebook Login for Business seeds the Facebook connection only. Instagram
 * uses a separate OAuth product, so the UI must retain its own card rather
 * than pretending the Facebook token connected it too.
 *
 * CRITICAL: Do NOT click "Disconnect" — this would break all connected tests.
 */

test.describe('Integrations — Connected Org', () => {
  test('shows Facebook connected and Instagram separately available', async ({
    page,
  }) => {
    await page.goto('/dashboard/settings/integrations');
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30000 });

    await test.step('verify page loads', async () => {
      // apps/app's reworked settings layout has no breadcrumb or
      // aria-current nav — anchor on the document title.
      await expect(page).toHaveTitle(/Integrations/, { timeout: 10_000 });
    });

    const facebookCard = page
      .getByRole('heading', { name: /^Facebook$/ })
      .locator('xpath=ancestor::*[.//button][1]');
    const instagramCard = page
      .getByRole('heading', { name: /^Instagram$/ })
      .locator('xpath=ancestor::*[.//button][1]');

    await test.step('verify the Facebook card is connected', async () => {
      await expect(facebookCard).toBeVisible({ timeout: 10000 });

      // "Edit Connection" is the connected state. A "Reconnect" button means
      // the token died — on the CONNECTED org that IS the regression this spec
      // exists to catch, so assert the connected state rather than skipping on
      // it. setup-connected re-seeds the integration from the never-expiring
      // system-user token, so a Reconnect here is a real failure.
      await expect(
        facebookCard.getByRole('button', { name: /^Edit Connection$/ })
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step('verify Instagram remains a separate connection', async () => {
      await expect(instagramCard).toBeVisible({ timeout: 10000 });
      await expect(
        instagramCard.getByRole('button', { name: /^Connect$/ })
      ).toBeVisible({ timeout: 5000 });
    });
  });
});
