import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  bookingPath,
  createBookablePractitioner,
  createService,
  nearFutureWeekdayLabel,
  waitForIslands,
} from '../fixtures/index.js';

/**
 * Public booking E2E, on its new home.
 *
 * MOVED FROM apps/app-e2e/src/booking/. The wizard left `apps/app` for
 * marketing-astro along with the portal, and now hangs off the microsite base
 * (`/sites/{slug}/book`) like every other tenant surface — so the specs live
 * in the suite that runs against the marketing deployment. Left in app-e2e
 * they drove routes that no longer exist there.
 *
 * Real API, real DB, no mocking. The booking page is PUBLIC; this suite
 * carries no storageState, so `page` is already an anonymous visitor. Only the
 * SEED is staff-authenticated, over HTTP.
 *
 * WHY beforeAll SEEDS ITS OWN SERVICE AND PRACTITIONER
 * The shared org accumulates services from other suites, and the org seeds no
 * practitioner or availability of its own. Reusing "whatever is first" is what
 * made this flow non-deterministic — first service may have no practitioner,
 * so no slots, so the only test proving public booking works would skip while
 * public booking was broken. beforeAll THROWS on a bad seed, and an empty slot
 * list FAILS.
 */
test.describe('Public Booking', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(120_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let serviceId = '';
  let serviceName = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Date.now() alone is not unique here: `fullyParallel` runs a file's tests
    // across workers, so `beforeAll` executes once PER WORKER — two of them can
    // land in the same millisecond and the second gets a 409 on an
    // already-existing service name.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    serviceName = `E2E Booking Service ${runId}`;
    const service = await createService(seed, {
      name: serviceName,
      category: 'treatment',
      appointmentDuration: 30,
    });
    serviceId = service.id;

    await createBookablePractitioner(seed, {
      name: `E2E Booking Practitioner ${runId}`,
      email: `e2e.test.booking.prac.${runId}@example.com`,
      serviceIds: [serviceId],
    });
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('booking page loads anonymously and lists the bookable service', async ({
    page,
  }) => {
    await page.goto(bookingPath(orgSlug));
    await waitForIslands(page);

    // The wizard opens on its "Services" step, headed "Select services".
    await expect(
      page.getByRole('heading', { name: 'Select services' })
    ).toBeVisible({ timeout: 15_000 });

    // A service assigned to a practitioner is bookable, so it renders with an
    // "Add {name}" toggle. This carries the claim that used to live in
    // app-e2e's practitioner-booking "Public Booking Form" section and in
    // rls-public-booking's "(a) UI" test — both of which drove /book/:slug on
    // the app and were deleted with the move rather than duplicated.
    //
    // Anonymous by construction: this suite has no storageState, where those
    // two ran under a signed-in session and had to argue it was harmless.
    await expect(
      page.getByRole('button', { name: `Add ${serviceName}` })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('the retired top-level /book/{slug} still resolves', async ({
    page,
  }) => {
    // Confirmation emails, Claire's sent messages and live ad creative all
    // carry the old shape. It 301s to the microsite base; if that redirect
    // ever goes, those links die silently and nobody finds out from a 404 in
    // someone else's inbox.
    await page.goto(`/book/${orgSlug}`);
    await waitForIslands(page);
    await expect(page).toHaveURL(new RegExp(`/sites/${orgSlug}/book$`));
    await expect(
      page.getByRole('heading', { name: 'Select services' })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('service deep-link preselects the service', async ({ page }) => {
    await page.goto(bookingPath(orgSlug, `/${serviceId}`));
    await waitForIslands(page);

    await expect(
      page.getByRole('heading', { name: 'Select services' })
    ).toBeVisible({ timeout: 15_000 });

    // Deep-linking pre-adds the service to the cart. A selected service's
    // toggle flips from "Add {name}" to "Remove {name}", so the Remove button
    // is the proof it is preselected.
    await expect(
      page.getByRole('button', { name: `Remove ${serviceName}` })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('full booking flow', async ({ page }) => {
    await page.goto(bookingPath(orgSlug));
    await waitForIslands(page);

    await test.step('Step 1: Services — add the seeded service', async () => {
      // Add THE seeded service (the one our practitioner is assigned to), not
      // "the first" — the shared org has others whose availability we do not
      // control.
      await expect(
        page.getByRole('heading', { name: 'Select services' })
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: `Add ${serviceName}` }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
    });

    await test.step('Step 2: Professional — accept "Any professional"', async () => {
      await expect(
        page.getByRole('heading', { name: 'Select professional' })
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Continue' }).click();
    });

    await test.step('Step 3: Select date and time', async () => {
      await expect(
        page.getByRole('heading', { name: 'Select date and time' })
      ).toBeVisible({ timeout: 15_000 });

      // A near-future weekday, so slots MUST exist — an empty list is a real
      // regression in the availability pipeline and fails here (it used to
      // skip).
      await page
        .getByRole('button', { name: nearFutureWeekdayLabel() })
        .click();

      const timeSlot = page
        .getByRole('button', { name: /^\d{1,2}:\d{2}\s*(AM|PM)$/i })
        .first();
      // The first slot query on a fresh service/practitioner combo is slow.
      await expect(timeSlot).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/no available times/i)).toBeHidden();

      await timeSlot.click();
      await page.getByRole('button', { name: 'Continue' }).click();
    });

    await test.step('Step 4: Confirm — guest details + Confirm', async () => {
      await expect(
        page.getByRole('heading', { name: 'Review and confirm' })
      ).toBeVisible({ timeout: 15_000 });
      await page.getByLabel(/first name/i).fill(`E2EBooking${Date.now()}`);
      // A valid email is REQUIRED — the confirm CTA stays disabled without it.
      await page
        .getByLabel(/email/i)
        .fill(`e2e.guest.${Date.now()}@example.com`);
      // Scope to the cart panel: the progress stepper also renders a "Confirm"
      // step button, so an un-scoped getByRole is ambiguous.
      await page
        .getByRole('complementary', { name: 'Booking summary' })
        .getByRole('button', { name: 'Confirm' })
        .click();
    });

    await test.step('Step 5: Verify success', async () => {
      await expect(
        page.getByText('Appointment confirmed', { exact: true })
      ).toBeVisible({ timeout: 30_000 });
    });
  });

  test('an unknown org slug does not render a bookable wizard', async ({
    page,
  }) => {
    await page.goto(bookingPath('e2e-no-such-org-9999'));
    await waitForIslands(page);
    await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(0);
  });
});
