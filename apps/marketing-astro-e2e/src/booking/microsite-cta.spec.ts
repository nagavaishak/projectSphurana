import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  createBookablePractitioner,
  createService,
  waitForIslands,
} from '../fixtures/index.js';

/**
 * The microsite's "Book" CTA must actually reach the booking flow.
 *
 * WHY THIS SPEC EXISTS
 * Every other spec in this suite navigates by BUILDING a url — `bookingPath()`,
 * `portalPath()`. So they prove the destinations work and never prove the
 * links that lead to them. The consequence shipped: the API composed the
 * microsite's booking CTA from `WEB_URL`, which on a preview is the DASHBOARD
 * deployment, so every Book button on a preview microsite pointed at an app
 * with no booking routes and returned 404. Both ends were green.
 *
 * So this test does the one thing the others do not: it renders the page a
 * customer lands on and CLICKS. It cannot pass unless the href the server
 * generated resolves to a working booking flow.
 *
 * SAME ORIGIN is asserted explicitly, not just "the page loaded". The bug was
 * a link to a real, working host that simply was not this one — an assertion
 * that only checked for a booking heading could be satisfied by landing
 * anywhere that serves one.
 */
test.describe('microsite → booking CTA', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(180_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // A bookable service, so the site has something to send the visitor to.
    // Date.now() alone is not unique here: `fullyParallel` runs a file's tests
    // across workers, so `beforeAll` executes once PER WORKER — two of them can
    // land in the same millisecond and the second gets a 409 on an
    // already-existing service name.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const service = await createService(seed, {
      name: `E2E CTA Service ${runId}`,
      category: 'treatment',
      appointmentDuration: 30,
    });
    await createBookablePractitioner(seed, {
      name: `E2E CTA Practitioner ${runId}`,
      email: `e2e.cta.prac.${runId}@example.com`,
      serviceIds: [service.id],
    });

    // A LOCATION. Without one the microsite page 404s outright — the document
    // route treats venue data as required, so an org that provisioned a site
    // before adding an address is told "your website is ready" and then served
    // a 404. Seeded here so this spec tests the CTA rather than that gap; the
    // gap itself is recorded in docs/plans/microsites.md §15.
    const locations = await seed.call<{ items?: unknown[] } | unknown[]>(
      'GET',
      '/organization-locations'
    );
    const existing = Array.isArray(locations)
      ? locations
      : (locations?.items ?? []);
    if (existing.length === 0) {
      await seed.call('POST', '/organization-locations', {
        name: 'E2E CTA Clinic',
        addressLine1: '1 Test Street',
        city: 'Dublin',
        country: 'IE',
        isPrimary: true,
      });
    }

    // Idempotent server-side: an org that already has a site keeps it.
    await seed.call('POST', '/microsites');
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('the Book CTA on the published site lands on this host’s booking flow', async ({
    page,
    baseURL,
  }) => {
    await page.goto(`/sites/${orgSlug}`, { waitUntil: 'domcontentloaded' });

    const cta = page.getByRole('link', { name: /book/i }).first();
    await expect(cta).toBeVisible({ timeout: 20_000 });

    // Asserted as RELATIVE, which is stronger than "resolves to this origin":
    // a link rendered into the page has no business naming a host at all, and
    // an absolute one is how it drifted onto the dashboard deployment. This
    // also pins the microsite's own booking path rather than the retired
    // top-level `/book/{slug}`.
    await expect(cta).toHaveAttribute(
      'href',
      new RegExp(`^/sites/${orgSlug}/book(?:[?#].*)?$`)
    );

    await cta.click();
    await waitForIslands(page);

    await expect(
      page.getByRole('heading', { name: 'Select services' })
    ).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).origin).toBe(
      new URL(baseURL ?? page.url()).origin
    );
  });
});
