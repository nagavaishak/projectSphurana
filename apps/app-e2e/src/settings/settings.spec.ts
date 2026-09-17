import { gotoSurface, isMobile } from '../fixtures/app.js';
import type { FreshOrg } from '../fixtures/org.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings tab — broad-shallow coverage. For every settings surface a fresh org
 * can (a) navigate to the route and hold it authenticated (proves per-test-org
 * session + routing), and (b) render one stable, real piece of that tab's
 * content (proves the route component mounted, not a redirect/error shell).
 *
 * Each `text` below was read off the live route component and picked for being
 * unique + stable (a card description, a field legend, or a page heading), so
 * the assertion is selector-agnostic rather than tied to markup structure.
 */
const TABS: {
  name: string;
  path: string;
  /** Some settings surfaces (org details) are gated behind a paid plan. */
  requiresPaidPlan?: boolean;
  /**
   * Content assertion for the tab. Optional: the Details tab can only be
   * checked at the shell level in this harness — see the comment on its entry.
   */
  assert?: (page: import('@playwright/test').Page) => Promise<void>;
}[] = [
  {
    name: 'index (Profile)',
    path: '/dashboard/settings',
    assert: (page) =>
      expect(
        page.getByText(/Manage your personal profile and account/i)
      ).toBeVisible({ timeout: 20_000 }),
  },
  {
    name: 'details',
    path: '/dashboard/settings/details',
    requiresPaidPlan: true,
    // Shell-only: the Details page renders nothing but loading skeletons in this
    // harness. It reads `GET /organizations/:id` (+ `/:id/members`), whose
    // feature schemas validate the id with `.uuid()`, but the per-test org id is
    // minted with an `e2e_test_` prefix, so both calls 400 forever and the page
    // never leaves its skeleton state. Prod org ids are bare uuids, so this is a
    // test-org-format limitation, not a product defect — asserting the authed
    // shell is the strongest honest check here. (See details.spec.ts fixme.)
  },
  {
    name: 'bookings',
    path: '/dashboard/settings/bookings',
    assert: (page) =>
      expect(page.getByText(/Booking Method/i)).toBeVisible({
        timeout: 20_000,
      }),
  },
  {
    name: 'notifications',
    path: '/dashboard/settings/notifications',
    assert: (page) =>
      expect(
        page.getByText(/Choose which events reach you and how/i)
      ).toBeVisible({ timeout: 20_000 }),
  },
  {
    name: 'claire-whatsapp',
    path: '/dashboard/settings/claire-whatsapp',
    assert: (page) =>
      expect(
        page.getByRole('heading', { name: /Claire on WhatsApp/i })
      ).toBeVisible({ timeout: 20_000 }),
  },
  {
    name: 'blocked-time-types',
    path: '/dashboard/settings/blocked-time-types',
    assert: (page) =>
      expect(
        page.getByRole('heading', { name: /Blocked time types/i })
      ).toBeVisible({ timeout: 20_000 }),
  },
  {
    name: 'style',
    path: '/dashboard/settings/style',
    assert: (page) =>
      expect(
        page.getByText(/Your logo, brand colours, and defaults/i)
      ).toBeVisible({ timeout: 20_000 }),
  },
  {
    name: 'integrations',
    path: '/dashboard/settings/integrations',
    assert: (page) =>
      expect(
        page.getByText(/Connect your Facebook account to run ads/i)
      ).toBeVisible({ timeout: 20_000 }),
  },
  {
    name: 'payments',
    path: '/dashboard/settings/payments',
    assert: (page) =>
      expect(page.getByRole('heading', { name: /^Payments$/i })).toBeVisible({
        timeout: 20_000,
      }),
  },
  {
    name: 'billing',
    path: '/dashboard/settings/billing',
    // "Subscription" is the (only) card title once the subscription query
    // resolves — either loaded or empty state renders it.
    assert: (page) =>
      expect(page.getByText(/Subscription/i).first()).toBeVisible({
        timeout: 20_000,
      }),
  },
];

/**
 * Per-tab precondition (a paid plan for the gated surfaces). Table-driven, not a
 * decision about observed app state — but it still branches, so it lives in a
 * helper outside the test body.
 */
async function preparePlan(
  org: FreshOrg,
  tab: (typeof TABS)[number]
): Promise<void> {
  if (tab.requiresPaidPlan) {
    await org.seed.forceCreateSubscription(org.orgId);
  }
}

test.describe('Settings · tabs render', () => {
  for (const tab of TABS) {
    test(`${tab.name}: navigates + renders authenticated`, async ({ org }) => {
      const { page } = org;
      await preparePlan(org, tab);
      // Viewport-agnostic: opens the surface + waits for the authed shell
      // (sidebar on desktop, bottom-tab nav on mobile) so the same spec passes
      // in both `tabs` and `tabs-mobile`.
      await gotoSurface(page, tab.path);
      // Held URL (no bounce to /sign-in) proves the per-test-org session is live.
      const escaped = tab.path.replace(/\//g, '\\/');
      await expect(page).toHaveURL(new RegExp(escaped));
      // One stable, real piece of this tab's content (where reachable). Each
      // tab's asserted text is a route-component heading/description that renders
      // identically at both viewports.
      await tab.assert?.(page);
    });
  }
});

test.describe('Settings · nav shell', () => {
  /**
   * The org settings hub, NOT a sidebar sub-panel.
   *
   * This used to assert a two-tier `sidebar-09` rail — a 72px icon column plus
   * a secondary panel listing Profile/Notifications/Details/… That design was
   * deliberately replaced by the single-column `sidebar-10` (see the comment on
   * `AppSidebarInner`), which pins one "Settings" row at the foot and lands on
   * `/dashboard/organisation`. The sub-items now live on that hub page.
   *
   * The old assertion was left behind pointing at chrome that no longer exists,
   * so it failed for a design decision rather than a defect. Rewritten against
   * the current shape rather than deleted: the thing worth protecting is that
   * every org settings page stays REACHABLE by navigation, and that is what
   * this asserts.
   */
  test('the settings hub links to every org settings page', async ({ org }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/organisation');

    for (const label of [
      'Locations',
      'Details',
      'Brand style',
      'Booking settings',
      'Integrations',
    ]) {
      await expect(
        page.getByRole('link', { name: new RegExp(`^${label}`) }).first()
      ).toBeVisible({ timeout: 15_000 });
    }
  });

  test('the sidebar pins a Settings row that reaches the hub', async ({
    org,
  }) => {
    const { page } = org;
    test.skip(isMobile(page), 'Desktop sidebar; mobile uses the bottom tabs.');

    await gotoSurface(page, '/dashboard/settings/details');

    await page
      .locator('[data-slot="sidebar"]')
      .getByRole('link', { name: 'Organisation settings' })
      .first()
      .click();

    await expect(page).toHaveURL(/\/dashboard\/organisation/);
  });

  test('personal settings hang off the user menu, not the org hub', async ({
    org,
  }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/organisation');

    // Profile and Notifications are PERSONAL — they belong to the user, not the
    // organisation, and are deliberately absent from the org hub. Asserted so
    // that re-adding them is a decision someone makes rather than a drift.
    for (const personal of ['Profile', 'Notifications']) {
      await expect(
        page.getByRole('link', { name: personal, exact: true })
      ).toHaveCount(0);
    }
  });

  test('Billing is not surfaced in navigation', async ({ org }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/organisation');

    // The page still exists and /billing is reachable directly; it is just no
    // longer surfaced. Asserted so re-adding it is a decision, not a drift.
    await expect(
      page.getByRole('link', { name: 'Billing', exact: true })
    ).toHaveCount(0);
  });
});
