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
 * Multi-service booking wizard E2E (the Fresha cart), on its new home.
 *
 * MOVED FROM apps/app-e2e/src/booking/ with the flow itself — see
 * public-booking.spec.ts for why.
 *
 * Real API, real DB, public (un-authed). Proves the headline functional jump:
 * a guest adds SEVERAL services, sees a running total, and completes ONE
 * booking for the cart through the UI — Services → Professional → Time →
 * Confirm.
 *
 * Slots are deterministic the same way public-booking does it: a seeded
 * practitioner with seven-day shifts, so any near-future weekday the strip
 * offers has times. An empty slot list FAILS here.
 */
test.describe('Booking wizard (multi-service cart)', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(180_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let serviceAName = '';
  let serviceBName = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Date.now() alone is not unique here: `fullyParallel` runs a file's tests
    // across workers, so `beforeAll` executes once PER WORKER — two of them can
    // land in the same millisecond and the second gets a 409 on an
    // already-existing service name.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    serviceAName = `E2E Cart A ${runId}`;
    serviceBName = `E2E Cart B ${runId}`;

    // priceCents, not just priceText: the cart total is summed from cents, and
    // a priceText-only service persists at €0 — which would make the €20
    // assertion below pass or fail for the wrong reason.
    const a = await createService(seed, {
      name: serviceAName,
      category: 'treatment',
      appointmentDuration: 30,
      priceText: '€10',
      priceCents: 1000,
    });
    const b = await createService(seed, {
      name: serviceBName,
      category: 'treatment',
      appointmentDuration: 30,
      priceText: '€10',
      priceCents: 1000,
    });

    await createBookablePractitioner(seed, {
      name: `E2E Cart Practitioner ${runId}`,
      email: `e2e.cart.prac.${runId}@example.com`,
      serviceIds: [a.id, b.id],
    });
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('books a two-service cart with a running total, end to end', async ({
    page,
  }) => {
    await page.goto(bookingPath(orgSlug));
    await waitForIslands(page);

    // ── Services step: add both, cart shows the exact total (€10 + €10). ──
    await page.getByRole('button', { name: `Add ${serviceAName}` }).click();
    await page.getByRole('button', { name: `Add ${serviceBName}` }).click();

    // Both line items + the summed total appear in the cart panel. Scope to
    // the "Booking summary" aside — each service name also appears in the
    // services list on the left, so an un-scoped getByText is a strict-mode
    // violation (2 matches).
    const cart = page.getByRole('complementary', { name: 'Booking summary' });
    await expect(cart.getByText(serviceAName)).toBeVisible();
    await expect(cart.getByText(serviceBName)).toBeVisible();
    // Assert the running total via its testid: with two €10 line items the
    // string "€20" can also appear as a line amount depending on layout, so a
    // bare getByText is ambiguous. The total is the claim this test makes.
    await expect(cart.getByTestId('cart-total')).toContainText('€20', {
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'Continue' }).click();

    // ── Professional step: "Any professional" is the default — advance. ──
    await expect(
      page.getByRole('heading', {
        name: /select .*professional|professional/i,
      })
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Continue' }).click();

    // ── Time step: pick a future date (guaranteed hours), then a slot. ──
    await expect(
      page.getByRole('heading', { name: /select date and time/i })
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: nearFutureWeekdayLabel() }).click();

    const slot = page
      .getByRole('button', { name: /^\d{1,2}:\d{2}\s*(AM|PM)$/i })
      .first();
    await expect(slot).toBeVisible({ timeout: 20000 });
    await slot.click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // ── Confirm step: guest details + Confirm. ──
    await expect(
      page.getByRole('heading', { name: /review and confirm|confirm/i })
    ).toBeVisible({ timeout: 15000 });
    await page.getByLabel(/first name/i).fill('E2E Cart Guest');
    // A valid email is REQUIRED — the confirm CTA stays disabled without it.
    await page
      .getByLabel(/email/i)
      .fill(`e2e.cart.guest.${Date.now()}@example.com`);
    // Scope to the cart panel: the "Progress" stepper also has a "Confirm"
    // step button, so an un-scoped getByRole is ambiguous. The primary action
    // lives in the "Booking summary" aside.
    await page
      .getByRole('complementary', { name: 'Booking summary' })
      .getByRole('button', { name: 'Confirm' })
      .click();

    // The booking lands — a confirmation screen.
    await expect(
      page.getByText(/confirmed|thank you|booked|see you/i).first()
    ).toBeVisible({ timeout: 30000 });
  });
});
