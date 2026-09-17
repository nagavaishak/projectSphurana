import { expect, test } from '@playwright/test';

/**
 * Integrations E2E Tests — Disconnected State (apps/app port)
 *
 * Route: /dashboard/settings/integrations
 *   (the legacy /dashboard/integrations URL redirects here)
 * Auth: bare org (no integrations connected) — applied automatically by the
 *   `authenticated` project via storageState from `setup-bare`.
 *
 * Tests page rendering and disconnected state for all providers.
 * Connected state is tested in integrations-connected.connected.spec.ts.
 */

async function navigateToIntegrations(page: import('@playwright/test').Page) {
  // Vite SPA: `domcontentloaded` is the safe waitUntil — the default 'load'
  // hangs under parallel load because runtime-config + session + provider
  // queries keep the network busy past navigation timeout.
  await page.goto('/dashboard/settings/integrations', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  const sidebar = page.locator('[data-sidebar="menu-button"]').last();
  const loaded = await sidebar
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!loaded) {
    await page.goto('/dashboard/settings/integrations', {
      waitUntil: 'domcontentloaded',
    });
    await sidebar.waitFor({ timeout: 45000 });
  }
}

test.describe('Integrations', () => {
  // Bumped from the project default (60s). navigateToIntegrations can
  // re-goto on a slow first attempt, which alone eats most of 60s under
  // parallel load on the local tunnel.
  test.setTimeout(120_000);

  test('page loads with integration list', async ({ page }) => {
    await navigateToIntegrations(page);

    // apps/app's reworked settings layout has no breadcrumb or
    // aria-current nav. Anchor on the document title as the "route
    // rendered" signal, then confirm the integration list itself rendered.
    await expect(page).toHaveTitle(/Integrations/, { timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: 'Facebook', exact: true })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('shows Facebook and Instagram provider cards', async ({ page }) => {
    await navigateToIntegrations(page);

    // Provider card title is an <h3> with the provider name. Use a
    // role+name match so we don't accidentally hit the provider
    // description (which contains the word "Facebook") or the settings
    // sidebar link.
    await expect(
      page.getByRole('heading', { name: 'Facebook', exact: true })
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: 'Instagram', exact: true })
    ).toBeVisible();
  });

  test('shows Connect buttons and no Disconnect buttons', async ({ page }) => {
    await navigateToIntegrations(page);

    // Bare org: should show "Connect" buttons
    const connectButtons = page.getByRole('button', { name: /^connect$/i });
    await expect(connectButtons.first()).toBeVisible({ timeout: 10000 });

    // Should NOT show "Disconnect" buttons.
    // The integrations grid in apps/app shows "Edit Connection" on connected
    // cards and only surfaces "Disconnect" inside the per-provider settings
    // dialog, which only opens on demand. Either way, no disconnect button
    // should be visible on initial load for the bare org.
    // (No explicit waitForTimeout — Playwright's auto-waiting on
    // toBeHidden already handles the transient case where the cards are
    // still streaming in.)
    const disconnectButton = page.getByRole('button', { name: /disconnect/i });
    await expect(disconnectButton).toBeHidden({ timeout: 10_000 });
  });
});
