import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  bookingPath,
  createBookablePractitioner,
  createService,
  requireSeed,
  waitForIslands,
} from '../fixtures/index.js';

/**
 * Patient self-serve manage-booking E2E, on its new home.
 *
 * MOVED FROM apps/app-e2e/src/booking/ with the flow itself — see
 * public-booking.spec.ts for why.
 *
 * This is what a patient runs from the link in their confirmation email:
 *
 *     /sites/{slug}/book/manage/{token}  →  see it  →  cancel or move it
 *
 * The whole feature is that an ANONYMOUS visitor — no account, no session —
 * can act on their own booking. In app-e2e every test had to open a context
 * with `storageState: undefined` to shed the bare-user session first; this
 * suite carries no storageState at all, so `page` is already that visitor and
 * a test cannot accidentally pass on inherited auth.
 *
 * WHY WE MINT THE TOKEN VIA /testing INSTEAD OF READING THE EMAIL
 * The raw token is deliberately unrecoverable — the DB stores only its
 * SHA-256. `issueManageBookingLink` asks the API to mint a fresh one, which is
 * exactly what the confirmation email does. We stand in for the mail client;
 * we do not bypass the feature.
 *
 * WHY WE SEED SEVEN-DAY SHIFTS
 * Reschedule can only offer times the clinic is actually offering. With no
 * availability there are no slots and the reschedule test would "pass" by
 * finding nothing to click.
 */
test.describe('Manage Booking (patient self-serve)', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  test.setTimeout(120_000);

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let serviceId = '';
  let practitionerId = '';
  let leadId = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Date.now() alone is not unique here: `fullyParallel` runs a file's tests
    // across workers, so `beforeAll` executes once PER WORKER — two of them can
    // land in the same millisecond and the second gets a 409 on an
    // already-existing service name.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const service = await createService(seed, {
      name: `E2E Manage Service ${runId}`,
      category: 'treatment',
      appointmentDuration: 30,
    });
    serviceId = service.id;

    const practitioner = await createBookablePractitioner(seed, {
      name: `E2E Manage Practitioner ${runId}`,
      email: `e2e.test.manage.prac.${runId}@example.com`,
      serviceIds: [serviceId],
    });
    practitionerId = practitioner.id;

    // Manual appointment creation (POST /appointments) requires a leadId — the
    // client the booking is for. The public flow mints its own lead; here we
    // seed one directly.
    const lead = await seed.call<{ id?: string }>('POST', '/leads', {
      firstName: `E2E Manage Client ${runId}`,
    });
    if (!lead?.id) {
      throw new Error(
        `[Manage Booking] Failed to seed lead: ${JSON.stringify(lead)}`
      );
    }
    leadId = lead.id;
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  /**
   * Create a booking far enough out to be inside the free-cancellation window,
   * and mint the link the patient would have received.
   */
  async function seedBookingWithLink(
    staff: PortalSeed,
    options?: { daysAhead?: number }
  ) {
    const start = new Date();
    start.setDate(start.getDate() + (options?.daysAhead ?? 7));
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const appointment = await staff.call<{ id?: string }>(
      'POST',
      '/appointments',
      {
        title: 'E2E Manage Booking',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        serviceId,
        practitionerId,
        leadId,
      }
    );

    if (!appointment?.id) {
      throw new Error(
        `[Manage Booking] Failed to seed appointment: ${JSON.stringify(appointment)}`
      );
    }

    const link = await staff.issueManageBookingLink(appointment.id);
    return { appointmentId: appointment.id, ...link };
  }

  test('an anonymous visitor can open their booking from the link', async ({
    page,
  }) => {
    const booking = await seedBookingWithLink(requireSeed(seed));
    await page.goto(bookingPath(orgSlug, `/manage/${booking.token}`));
    await waitForIslands(page);

    await expect(
      page.getByRole('heading', { name: /your booking/i })
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByRole('button', { name: /cancel booking/i })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /reschedule/i })
    ).toBeVisible();
  });

  test('cancelling persists — the booking is still cancelled after a reload', async ({
    page,
  }) => {
    const booking = await seedBookingWithLink(requireSeed(seed));
    await page.goto(bookingPath(orgSlug, `/manage/${booking.token}`));
    await waitForIslands(page);

    await page.getByRole('button', { name: /cancel booking/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await dialog.getByRole('button', { name: /^cancel booking$/i }).click();

    // The toast means "accepted", not "landed".
    await expect(page.getByText(/cancelled/i).first()).toBeVisible({
      timeout: 15000,
    });

    // THIS is the real check — ask the server again.
    await page.reload();

    await expect(page.getByText(/can no longer be changed/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole('button', { name: /cancel booking/i })
    ).toBeHidden();
  });

  test('rescheduling persists — the booking moves and stays moved', async ({
    page,
  }) => {
    const booking = await seedBookingWithLink(requireSeed(seed));
    await page.goto(bookingPath(orgSlug, `/manage/${booking.token}`));
    await waitForIslands(page);

    // What the patient sees NOW. We assert against this rather than against
    // the picker's label: the picker renders "10:00 AM" in the browser's
    // locale, while the card renders "10:00" in the CLINIC's timezone. Coupling
    // the assertion to either format would make this test a formatting test.
    const card = page
      .getByText(/minutes\)/)
      .locator('..')
      .locator('..');
    await expect(card).toBeVisible({ timeout: 15000 });
    const before = (await card.textContent())?.trim() ?? '';
    expect(before).toBeTruthy();

    await page.getByRole('button', { name: /reschedule/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 10000 });

    // "In a week" lands on a day the seeded practitioner works (working hours
    // are set for all seven weekdays), so slots are guaranteed.
    await dialog.getByRole('button', { name: 'In a week' }).click();

    // The first time the clinic is ACTUALLY offering. An empty slot list must
    // FAIL here, not skip — a reschedule page that offers nothing is exactly
    // the regression this test exists to catch.
    const slot = dialog
      .getByRole('button', { name: /^\d{1,2}:\d{2}\s*(AM|PM)$/i })
      .first();
    await expect(slot).toBeVisible({ timeout: 20000 });
    const chosenTime = (await slot.textContent())?.trim() ?? '';
    expect(chosenTime).toBeTruthy();
    await slot.click();

    await dialog.getByRole('button', { name: /confirm booking/i }).click();

    await expect(page.getByText(/moved|rescheduled/i).first()).toBeVisible({
      timeout: 20000,
    });

    // Ask the server, not the toast.
    await page.reload();

    await expect(
      page.getByRole('heading', { name: /your booking/i })
    ).toBeVisible({ timeout: 15000 });

    // The booking must show a DIFFERENT time than it did before — and still be
    // live (a reschedule that quietly cancelled would also "change" the card).
    const after = page
      .getByText(/minutes\)/)
      .locator('..')
      .locator('..');
    await expect(after).not.toHaveText(before, { timeout: 15000 });
    await expect(
      page.getByRole('button', { name: /cancel booking/i })
    ).toBeVisible();
  });

  test('a well-formed but never-issued token shows the dead-link screen', async ({
    page,
  }) => {
    // A real, live booking DOES exist in this org — that is what makes the
    // forged token below a meaningful miss rather than a lookup against nothing.
    await seedBookingWithLink(requireSeed(seed));
    // A token of exactly the right SHAPE (43 chars, base64url alphabet) that
    // was never issued. Shape alone must buy an attacker nothing — the server
    // matches on the stored hash, so a well-formed guess is as dead as junk.
    const forged = 'A'.repeat(43);

    await page.goto(bookingPath(orgSlug, `/manage/${forged}`));
    await waitForIslands(page);

    await expect(page.getByText(/no longer valid/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole('button', { name: /cancel booking/i })
    ).toBeHidden();
  });
});
