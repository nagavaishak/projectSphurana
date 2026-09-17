import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  bookingPath,
  createBookablePractitioner,
  createService,
  createServiceVariant,
  nearFutureWeekdayLabel,
  waitForIslands,
} from '../fixtures/index.js';

/**
 * Variant-priced booking E2E, on its new home.
 *
 * MOVED FROM apps/app-e2e/src/booking/ with the flow itself — see
 * public-booking.spec.ts for why.
 *
 * A service that owns variants must open a CHOOSER rather than adding
 * directly, and the variant the customer picks — not the service's "from"
 * floor — must drive the cart total and the appointment snapshot. See
 * docs/plans/service-pricing-model.md.
 */
test.describe('Booking wizard (variant-priced service)', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(180_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let serviceName = '';
  // The shared org has no location country set, so the pricing model's
  // currencyForCountry() falls back to EUR.
  const currencySymbol = '€';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Date.now() alone is not unique here: `fullyParallel` runs a file's tests
    // across workers, so `beforeAll` executes once PER WORKER — two of them can
    // land in the same millisecond and the second gets a 409 on an
    // already-existing service name.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    serviceName = `E2E Variant Svc ${runId}`;

    // A service priced as a floor, with two optional variants. The variants
    // drive the chooser; the cheapest is the "from" anchor.
    const svc = await createService(seed, {
      name: serviceName,
      category: 'treatment',
      appointmentDuration: 45,
      priceText: 'From €160',
      priceCents: 16000,
    });
    await createServiceVariant(seed, svc.id, {
      name: '1 Area',
      priceCents: 16000,
      durationMinutes: 45,
      sortOrder: 0,
    });
    await createServiceVariant(seed, svc.id, {
      name: '2 Areas',
      priceCents: 19000,
      durationMinutes: 75,
      sortOrder: 1,
    });

    await createBookablePractitioner(seed, {
      name: `E2E Variant Practitioner ${runId}`,
      email: `e2e.variant.prac.${runId}@example.com`,
      serviceIds: [svc.id],
    });
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('picks the pricier variant and books it — the chosen price drives the cart', async ({
    page,
  }) => {
    const price190 = `${currencySymbol}190`;
    await page.goto(bookingPath(orgSlug));
    await waitForIslands(page);

    // ── Services step: a variant service opens a chooser, not a direct add. ──
    await page.getByRole('button', { name: `Add ${serviceName}` }).click();

    const chooser = page.getByRole('dialog');
    await expect(
      chooser.getByText(new RegExp(`Choose an option.*${serviceName}`))
    ).toBeVisible({ timeout: 10000 });

    // Pick the pricier "2 Areas" option (the default is the first, "1 Area").
    await chooser.getByText('2 Areas', { exact: true }).click();
    await chooser.getByRole('button', { name: 'Add to booking' }).click();
    await expect(chooser).toBeHidden({ timeout: 10000 });

    // ── Cart shows the CHOSEN variant's price (€190), NOT the €160 floor. ──
    const cart = page.getByRole('complementary', { name: 'Booking summary' });
    await expect(cart.getByText(serviceName)).toBeVisible();
    await expect(cart.getByText('2 Areas')).toBeVisible();
    // Assert the TOTAL, not a bare getByText(price190): €190 renders as both
    // the line item AND the total (one service, so they're equal), which
    // makes getByText ambiguous. The total is the real claim — the chosen
    // €190 variant, not the €160 floor, drives the cart.
    await expect(cart.getByTestId('cart-total')).toContainText(price190, {
      timeout: 10000,
    });

    await page.getByRole('button', { name: 'Continue' }).click();

    // ── Professional step: "Any professional" default — advance. ──
    await expect(
      page.getByRole('heading', {
        name: /select .*professional|professional/i,
      })
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Continue' }).click();

    // ── Time step: pick a future weekday (guaranteed hours), then a slot. ──
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
    await page.getByLabel(/first name/i).fill('E2E Variant Guest');
    // A valid email is REQUIRED — the confirm CTA stays disabled without it.
    await page
      .getByLabel(/email/i)
      .fill(`e2e.variant.guest.${Date.now()}@example.com`);
    // Scope to the cart panel: the wizard's "Progress" stepper also renders a
    // step button named "Confirm", so an un-scoped getByRole is ambiguous. The
    // primary action lives in the "Booking summary" aside.
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
