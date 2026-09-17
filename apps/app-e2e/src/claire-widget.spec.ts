import { expect, test } from '@playwright/test';

/**
 * Smoke tests for the floating Claire widget (CA-5 port).
 *
 * ENVIRONMENT GATE — read this before "fixing" a skip here:
 *
 * The widget mounts in `apps/app/src/routes/_authed.tsx` via `ClaireWidgetRoot`,
 * but that mount is currently dead code: `_authed.tsx` hard-codes
 * `const hideClaireWidget = true;` ("The floating Claire widget is currently
 * disabled everywhere"). No PostHog flag, no org state — the launcher simply
 * never renders in any build today. These tests therefore cannot pass against
 * the shipped app, and they are NOT a self-skip on observed app state: whether
 * the widget surface exists at all is a property of the deployment, decided
 * before the browser opens.
 *
 * They are gated on an explicit env var so they run the moment the widget is
 * re-enabled (flip `hideClaireWidget`, then run with `E2E_CLAIRE_WIDGET=1`),
 * and are otherwise declared-skipped rather than silently green. Nothing in CI
 * sets `E2E_CLAIRE_WIDGET` today — see the handoff report.
 *
 * Auth is provided by setup-bare's storageState via the `authenticated`
 * project; no per-test sign-in needed.
 */

const CLAIRE_WIDGET_ENABLED = process.env.E2E_CLAIRE_WIDGET === '1';

test.describe('claire widget', () => {
  test.skip(
    !CLAIRE_WIDGET_ENABLED,
    'Floating Claire widget is disabled in the app (_authed.tsx hideClaireWidget = true). Re-enable it and set E2E_CLAIRE_WIDGET=1 to run these.'
  );

  test('launcher is visible on the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('button', { name: /open claire/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('clicking the launcher opens the mini chat panel', async ({ page }) => {
    await page.goto('/dashboard');
    const launcher = page.getByRole('button', { name: /open claire/i });
    await expect(launcher).toBeVisible({ timeout: 15_000 });

    await launcher.click();

    await expect(
      page.getByRole('dialog', { name: /claire quick chat/i })
    ).toBeVisible({ timeout: 10_000 });
  });
});
