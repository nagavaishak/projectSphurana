import { expect, test } from '@playwright/test';
import { SeedHelper, branchUrl } from '../fixtures/index.js';

/**
 * Empty-state crash sweep (no-data org) — Pillar 2 of
 * docs/testing/release-safety-strategy.md.
 *
 * The #1 *functional* escape class in the issue review is a surface that crashes
 * on an org with NO data (empty-array / null-deref: BOR-70, ENG-380/339). This
 * spec loads every dashboard tab on a brand-new, verified, EMPTY org and proves
 * the SPA shell mounts on each and no uncaught exception fires.
 *
 * Layering (the pyramid): the deterministic "API never 500s on empty data"
 * contract is locked in the fast integration gate
 * (apps/api/src/_integration/empty-state-no-500.int-spec.ts). THIS test is the
 * thin E2E top: it proves the *frontend* renders each tab's empty state without
 * white-screening — a genuine cross-system check that needs a real browser.
 *
 * Why self-provision instead of the shared bare org: the bare org accretes rows
 * from other specs, so it is not reliably empty. `createEmptyVerifiedOrg` mints
 * a fresh org via the testing API (no UI), and signing in as its owner replaces
 * the bare-suite storageState session for this test only. The `e2e.test.%`
 * email lets `/testing/cleanup` reap it.
 */

// One entry per destination in the app's nav (apps/app/src/lib/dashboard-nav.ts
// → route-paths.ts). Deeper sub-routes are covered by their own feature specs;
// this sweep is breadth-first across the empty org.
//
// Keep these on the CANONICAL paths, not the legacy ones (/dashboard/services,
// /dashboard/appointments, …): those still resolve, but only as redirects, so a
// sweep built on them would silently stop covering half the tabs the moment a
// redirect is retired.
const DASHBOARD_TABS = [
  '/dashboard/home',
  '/dashboard/calendar',
  '/dashboard/sales/daily-summary',
  '/dashboard/sales/appointments',
  '/dashboard/sales/list',
  '/dashboard/sales/payments',
  '/dashboard/sales/gift-cards',
  '/dashboard/sales/memberships',
  '/dashboard/sales/product-orders',
  '/dashboard/catalog/services',
  '/dashboard/catalog/memberships',
  '/dashboard/catalog/products',
  '/dashboard/catalog/offers',
  '/dashboard/catalog/stocktakes',
  '/dashboard/catalog/stock-orders',
  '/dashboard/catalog/suppliers',
  '/dashboard/catalog/brands',
  '/dashboard/catalog/categories',
  '/dashboard/clients/inbox',
  '/dashboard/customers',
  '/dashboard/marketing/socials',
  '/dashboard/marketing/advertising',
  '/dashboard/marketing/campaigns',
  '/dashboard/marketing/lead-forms',
  '/dashboard/marketing/gallery',
  '/dashboard/ai-assistant',
  '/dashboard/team/members',
  '/dashboard/team/shifts',
  '/dashboard/team/timesheets',
  '/dashboard/deposits',
  '/dashboard/settings',
  '/dashboard/settings/style',
  '/dashboard/settings/integrations',
  '/dashboard/more',
  '/dashboard/account',
] as const;

test.describe('dashboard empty-state sweep (no-data org)', () => {
  // Provisioning (sign-up + verify + org-create) plus a long tab walk; give it
  // room beyond the default per-test budget.
  test.setTimeout(240_000);

  test('every dashboard tab mounts without crashing on an empty org', async ({
    page,
    request,
  }) => {
    const seed = new SeedHelper(page, request);

    // Fresh, verified, EMPTY org. Force a subscription so sign-in lands on the
    // dashboard rather than the billing wall.
    const org = await seed.createEmptyVerifiedOrg('empty-sweep');
    await seed.forceCreateSubscription(org.orgId);

    // Sign in as the empty-org owner. This replaces the bare-suite session
    // cookie (storageState) for this page only.
    await seed.signInUser(org.email, org.password);

    // Uncaught exceptions are the strongest cross-tab crash signal that does
    // not depend on per-tab UI text. Collected across the whole sweep and
    // asserted at the end, tagged with the tab that was loading.
    const pageErrors: string[] = [];
    let currentTab = '(setup)';
    page.on('pageerror', (err) => {
      pageErrors.push(`[${currentTab}] ${err.message}`);
      // Log as it happens, not just in the assertion at the end: a tab that
      // white-screens fails the shell check FIRST, so the buffered list is
      // never reached and the actual exception stays invisible.
      console.error(
        `[empty-sweep] uncaught on ${currentTab}: ${err.message}\n${(err.stack ?? '').split('\n').slice(0, 5).join('\n')}`
      );
    });

    try {
      for (const tab of DASHBOARD_TABS) {
        currentTab = tab;
        await page.goto(await branchUrl(page, tab), {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });

        // The protected shell mounting (sidebar) proves the route resolved and
        // the SPA did not white-screen. A null-deref that takes down the route
        // tree fails here; a politely-handled empty state still renders it.
        await expect(
          page.locator('[data-sidebar="menu-button"]').last(),
          `${tab} did not mount the dashboard shell — the SPA white-screened or the route bounced`
        ).toBeVisible({ timeout: 30_000 });
      }

      expect(
        pageErrors,
        `Uncaught exceptions during empty-state sweep:\n${pageErrors.join('\n')}`
      ).toEqual([]);
    } finally {
      // Reap THIS spec's org — scoped to the email it minted, not the whole
      // `e2e.test.%` namespace.
      //
      // A bare `seed.cleanup()` deletes every e2e user and organization with no
      // age guard at all, including the ones other suites are running against
      // right now. That is the documented catastrophe in
      // testing.service.ts#cleanupByEmailPattern: sign-ins start answering
      // "Invalid email or password", inserts die on foreign keys, and a dozen
      // unrelated specs fail in the same second looking like a flaky app.
      await seed.cleanup(`${org.email}%`).catch(() => {});
    }
  });
});
