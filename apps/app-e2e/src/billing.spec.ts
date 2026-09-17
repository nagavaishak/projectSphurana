import { expect, test } from '@playwright/test';

// Smoke for the /billing route, which is now a REDIRECT rather than a page.
//
// It used to be the self-serve plan picker: bounce subscribed orgs to the
// dashboard, show "Choose your plan" to everyone else. Every subscription now
// comes from a sales call and is attached by an onboarding specialist (or
// pasted on Settings → Billing), so the only people the picker ever reached
// were customers mid-onboarding whose subscription staff had not attached
// yet — precisely the group it was most wrong for.
//
// So the route sends everyone to Settings → Billing, where plan state lives
// and where a subscription id can be attached. This spec pins BOTH halves:
// the destination, and the absence of the plan picker — an earlier version of
// this file warned that polling for "any terminal state" let a
// subscription-lookup regression pass green, and that warning still applies.
//
// Auth is handled by the `authenticated` project's storageState — no
// explicit sign-in needed. apps/app is a Vite SPA so we use
// `domcontentloaded` and generous timeouts to absorb the runtime-config +
// session boot before the route mounts.

test.describe('2B billing route', () => {
  // Bumped from the project default (60s). Cold-boot on the local tunnel
  // can spend 30s+ on goto and another 30s waiting for runtime-config +
  // session + subscription + services to resolve before the redirect fires.
  test.setTimeout(120_000);

  test('/billing redirects to Settings → Billing, not a plan picker', async ({
    page,
  }) => {
    await page.goto('/billing', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    await expect(page).toHaveURL(/\/dashboard\/settings\/billing/, {
      timeout: 60_000,
    });

    // And the plan selector is gone entirely — nobody self-serve buys, so a
    // "choose your plan" heading anywhere in this flow is a regression.
    await expect(
      page.getByRole('heading', { name: /choose your plan/i })
    ).toHaveCount(0);
  });

  // The destination assertion above is necessary and NOT sufficient. It passed
  // green while the page it lands on carried a "Manage plan" button whose href
  // was `/billing` — the very route that redirects back here. Clicking it left
  // the URL unchanged and did nothing, because the check only ever looked at
  // where /billing SENDS you, never at whether the landing page's own controls
  // go anywhere. Any link back to /billing from this page is that loop.
  test('Settings → Billing has no control that navigates back to /billing', async ({
    page,
  }) => {
    await page.goto('/dashboard/settings/billing', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page
      .locator('[data-sidebar="menu-button"]')
      .last()
      .waitFor({ timeout: 30_000 });

    // Non-vacuity: the subscription card must actually have rendered, or an
    // empty page would satisfy the assertion below without proving anything.
    await expect(page.getByText(/subscription/i).first()).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.locator('a[href="/billing"]')).toHaveCount(0);
  });
});
