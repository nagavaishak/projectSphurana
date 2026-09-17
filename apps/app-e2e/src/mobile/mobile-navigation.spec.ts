import { expect, test } from '@playwright/test';
import { branchUrl, branchUrlPattern } from '../fixtures/branch.fixture.js';

/**
 * Thin route-smoke for the mobile shell (`authenticated-mobile` project, Pixel 7
 * + bare-org storageState).
 *
 * Every dashboard destination is now reachable on a phone — from the bottom
 * tabs, the More tab, or the account menu — so this walks the whole list and
 * asserts each one renders, keeps the tab bar (i.e. you can get back out), and
 * doesn't scroll sideways. It deliberately asserts nothing about page content:
 * the per-feature specs do that. This is the net that catches "we shipped a
 * screen with no way off it" and "this table still forces 900px".
 */

/** Every dashboard route reachable from the mobile navigation. */
const MOBILE_ROUTES: { path: string; name: string }[] = [
  { path: '/dashboard/home', name: 'AI home' },
  { path: '/dashboard/more', name: 'More' },
  { path: '/dashboard/account', name: 'Account' },
  { path: '/dashboard/calendar/day', name: 'Calendar (day)' },
  { path: '/dashboard/calendar/month', name: 'Calendar (month)' },
  { path: '/dashboard/clients/inbox', name: 'Inbox' },
  { path: '/dashboard/customers', name: 'Clients' },
  { path: '/dashboard/ai-assistant', name: 'AI assistant' },

  // Sales
  { path: '/dashboard/sales/daily-summary', name: 'Sales · daily summary' },
  { path: '/dashboard/sales/appointments', name: 'Sales · appointments' },
  { path: '/dashboard/sales/list', name: 'Sales · list' },
  { path: '/dashboard/sales/payments', name: 'Sales · payments' },
  { path: '/dashboard/sales/gift-cards', name: 'Sales · gift cards' },
  { path: '/dashboard/sales/memberships', name: 'Sales · memberships' },
  { path: '/dashboard/sales/product-orders', name: 'Sales · product orders' },

  // Catalog
  { path: '/dashboard/catalog/services', name: 'Catalog · services' },
  { path: '/dashboard/catalog/memberships', name: 'Catalog · memberships' },
  { path: '/dashboard/catalog/products', name: 'Catalog · products' },
  { path: '/dashboard/catalog/offers', name: 'Catalog · offers' },
  { path: '/dashboard/catalog/stocktakes', name: 'Catalog · stocktakes' },
  { path: '/dashboard/catalog/stock-orders', name: 'Catalog · stock orders' },
  { path: '/dashboard/catalog/suppliers', name: 'Catalog · suppliers' },
  { path: '/dashboard/catalog/brands', name: 'Catalog · brands' },
  { path: '/dashboard/catalog/categories', name: 'Catalog · categories' },

  // Marketing
  { path: '/dashboard/marketing/socials', name: 'Marketing · socials' },
  { path: '/dashboard/marketing/advertising', name: 'Marketing · advertising' },
  { path: '/dashboard/marketing/campaigns', name: 'Marketing · campaigns' },
  { path: '/dashboard/marketing/lead-forms', name: 'Marketing · lead forms' },
  { path: '/dashboard/marketing/gallery', name: 'Marketing · gallery' },

  // Team
  { path: '/dashboard/team/members', name: 'Team · members' },
  { path: '/dashboard/team/shifts', name: 'Team · shifts' },
  { path: '/dashboard/team/timesheets', name: 'Team · timesheets' },

  // Settings
  { path: '/dashboard/settings', name: 'Settings · profile' },
  {
    path: '/dashboard/settings/notifications',
    name: 'Settings · notifications',
  },
  { path: '/dashboard/settings/details', name: 'Settings · details' },
  { path: '/dashboard/settings/bookings', name: 'Settings · bookings' },
  {
    path: '/dashboard/settings/blocked-time-types',
    name: 'Settings · blocked time types',
  },
  { path: '/dashboard/settings/style', name: 'Settings · brand style' },
  { path: '/dashboard/settings/integrations', name: 'Settings · integrations' },
  { path: '/dashboard/settings/payments', name: 'Settings · payments' },
  { path: '/dashboard/settings/billing', name: 'Settings · billing' },
];

/** More sections that drill into a sub-list. */
const MORE_SECTIONS = ['sales', 'catalog', 'marketing', 'team', 'settings'];

test.describe('mobile navigation — route smoke', () => {
  for (const route of MOBILE_ROUTES) {
    test(`${route.name} loads with the tab bar`, async ({ page }) => {
      const viewport = page.viewportSize();
      expect(viewport?.width ?? 0).toBeLessThan(600);

      await page.goto(await branchUrl(page, route.path));

      // The tab bar is the "way back out" — every non-full-screen dashboard
      // screen must keep it, or the user is stranded.
      await expect(page.locator('[data-mobile-bottom-tabs]')).toBeVisible({
        timeout: 20_000,
      });

      // No route-level crash.
      await expect(
        page.getByText(/something went wrong|unexpected error/i)
      ).toHaveCount(0);

      // Nothing forces the page wider than the phone (the old desktop tables
      // did: fixed column widths, min-w-[900px] grids, …). 4px of slack for
      // sub-pixel layout rounding.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(4);
    });
  }

  for (const slug of MORE_SECTIONS) {
    test(`More → ${slug} lists its sub-navigation`, async ({ page }) => {
      await page.goto('/dashboard/more');

      await page.getByTestId(`more-card-${slug}`).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/more/${slug}$`));
      await expect(page.locator('[data-mobile-bottom-tabs]')).toBeVisible();
      // At least one destination to drill into.
      await expect(page.getByRole('link').first()).toBeVisible();
    });
  }
});

test.describe('mobile navigation — shell behaviour', () => {
  test('the + tab opens the quick-add sheet with all four actions', async ({
    page,
  }) => {
    await page.goto(await branchUrl(page, '/dashboard/home'));
    // State the precondition. Everything below drives the mobile shell and
    // asserts a branch-scoped destination, all of which needs the branch to
    // have resolved first. When it has not, the splat sends the very next
    // navigation to `/dashboard/locations` and the failure surfaces on a
    // later `toHaveURL` that names the picker instead of the cause.
    await expect(page).toHaveURL(branchUrlPattern('home'));

    await page.getByTestId('mobile-tab-quick-add').click();

    await expect(page.getByTestId('quick-add-appointment')).toBeVisible();
    await expect(page.getByTestId('quick-add-blocked-time')).toBeVisible();
    await expect(page.getByTestId('quick-add-sale')).toBeVisible();
    await expect(page.getByTestId('quick-add-quick-payment')).toBeVisible();
  });

  test('quick-add → Appointment opens the mobile booking flow', async ({
    page,
  }) => {
    await page.goto(await branchUrl(page, '/dashboard/home'));
    // State the precondition. Everything below drives the mobile shell and
    // asserts a branch-scoped destination, all of which needs the branch to
    // have resolved first. When it has not, the splat sends the very next
    // navigation to `/dashboard/locations` and the failure surfaces on a
    // later `toHaveURL` that names the picker instead of the cause.
    await expect(page).toHaveURL(branchUrlPattern('home'));

    await page.getByTestId('mobile-tab-quick-add').click();
    await page.getByTestId('quick-add-appointment').click();

    await expect(page).toHaveURL(branchUrlPattern('calendar/new'));
  });

  test('the inbox is one tap from home', async ({ page }) => {
    // The AFFORDANCE moved — Inbox was a header shortcut beside the bell and
    // is now a labelled bottom tab (see mobile-bottom-tabs.tsx). The behaviour
    // under test is unchanged and still worth pinning: the surface a user
    // opens all day is reachable in a single tap from home.
    await page.goto(await branchUrl(page, '/dashboard/home'));
    // State the precondition. Everything below drives the mobile shell and
    // asserts a branch-scoped destination, all of which needs the branch to
    // have resolved first. When it has not, the splat sends the very next
    // navigation to `/dashboard/locations` and the failure surfaces on a
    // later `toHaveURL` that names the picker instead of the cause.
    await expect(page).toHaveURL(branchUrlPattern('home'));

    await page
      .locator('[data-mobile-bottom-tabs]')
      .getByText('Inbox', { exact: true })
      .click();
    await expect(page).toHaveURL(branchUrlPattern('clients/inbox'));
  });

  test('the bottom tabs expose Claire, Inbox, Bookings and More', async ({
    page,
  }) => {
    await page.goto(await branchUrl(page, '/dashboard/home'));
    // State the precondition. Everything below drives the mobile shell and
    // asserts a branch-scoped destination, all of which needs the branch to
    // have resolved first. When it has not, the splat sends the very next
    // navigation to `/dashboard/locations` and the failure surfaces on a
    // later `toHaveURL` that names the picker instead of the cause.
    await expect(page).toHaveURL(branchUrlPattern('home'));

    const tabs = page.locator('[data-mobile-bottom-tabs]');
    for (const label of ['Claire', 'Inbox', 'Bookings', 'More']) {
      await expect(tabs.getByText(label, { exact: true })).toBeVisible();
    }
    // Socials is deliberately NOT a tab: it is somewhere you go to plan, not a
    // place you return to all day, so it sits under Marketing in More and
    // Inbox holds the tab instead.
    await expect(tabs.getByText('Socials', { exact: true })).toHaveCount(0);
  });
});
