import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  createService,
  waitForIslands,
} from '../fixtures/index.js';

/**
 * Public venue page E2E, on its new home.
 *
 * MOVED FROM apps/app-e2e with the page itself: the venue page is public,
 * indexable and customer-facing, so it left the dashboard host along with
 * booking and the portal.
 *
 * Real API, real DB. The page is PUBLIC, and this suite carries no
 * storageState, so `page` is already an anonymous visitor — in app-e2e each
 * test had to open a context with `storageState: undefined` to shed the staff
 * session first.
 */
test.describe('Public venue page', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(120_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let serviceName = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Unique per WORKER: `fullyParallel` runs beforeAll once per worker, and
    // two in the same millisecond collide on the service name.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    serviceName = `E2E Venue Service ${runId}`;
    await createService(seed, {
      name: serviceName,
      category: 'treatment',
      appointmentDuration: 30,
      priceText: '\u20AC50',
      priceCents: 5000,
    });
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('renders the venue with its services and a working Book link', async ({
    page,
  }) => {
    await page.goto(`/sites/${orgSlug}/venue`);
    await waitForIslands(page);

    // The venue heading (org/location name) renders.
    await expect(page.getByRole('heading').first()).toBeVisible({
      timeout: 15000,
    });

    // The seeded service appears in the Services section.
    await expect(page.getByText(serviceName)).toBeVisible({ timeout: 15000 });

    // "Book now" links into the wizard for this org — which now lives on the
    // MARKETING app, under the microsite base. Asserting the whole path (not
    // just `/book`) is the point: the link shipped as
    // `{dashboard-host}/sites/{slug}/book` for a while, i.e. right-looking
    // path on a host that does not serve it.
    const bookNow = page.getByRole('link', { name: /book now/i }).first();
    await expect(bookNow).toBeVisible();
    await expect(bookNow).toHaveAttribute(
      'href',
      new RegExp(`/sites/${orgSlug}/book$`)
    );
    // ...and never the retired top-level shape, which only 301s.
    await expect(bookNow).not.toHaveAttribute(
      'href',
      new RegExp(`/book/${orgSlug}`)
    );
  });

  test('the retired /venue/{slug} still resolves', async ({ page }) => {
    // Clinics shared this URL and it is indexed. It 301s to the microsite
    // shape; if that redirect ever goes, those links die somewhere we never
    // look.
    await page.goto(`/venue/${orgSlug}`);
    await expect(page).toHaveURL(new RegExp(`/sites/${orgSlug}/venue$`));
  });

  test('an unknown venue slug shows a not-found screen, not a crash', async ({
    page,
  }) => {
    await page.goto('/sites/no-such-venue-xyz/venue');
    await waitForIslands(page);
    // The not-found card renders a "Venue not found" title AND a description
    // that also says "no longer" — a loose regex matches both and trips
    // strict mode. Assert on the title only.
    await expect(page.getByText(/venue not found/i)).toBeVisible({
      timeout: 15000,
    });
  });
});
