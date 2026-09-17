import { expect, test } from '@playwright/test';

import {
  PORTAL_E2E_READY,
  PORTAL_E2E_SKIP_REASON,
  PortalSeed,
  createConsentTemplate,
  createService,
  createStaffAppointment,
  fillHydrated,
  portalPath,
  requireConsentForService,
  requireSeed,
  setAppointmentStatus,
  waitForConsentSubmissions,
} from '../fixtures/index.js';

/**
 * ENG-806 — a cancelled booking must take its unsigned consent form out of the
 * customer's portal, and give it back if the booking comes back.
 *
 * WHY THIS RUNS IN A BROWSER AT ALL. The unit tests pin the rule and the
 * integration suite pins the three API routes against a real database. What
 * neither can see is the thing the customer actually complained about: an
 * amber "1 form to complete" card, in their portal, for a visit that was
 * called off — and the sign screen still opening behind it. The nudge and the
 * sign screen are two SEPARATE reads (`GET /patient/consent-forms` and
 * `GET /patient/consent-forms/:id`), rendered by two different islands and
 * cached independently by React Query. A fix applied to one and not the other
 * passes every server-side test and still shows the patient a form they
 * cannot sign.
 *
 * NOTHING IS OBSERVED THAT COULD BE SEEDED. The clinic, the service, the form
 * requirement, the lead, the booking and the customer's session are all
 * created here, so every assertion below is about behaviour and a missing
 * element is a failure — never a skip.
 *
 * The un-cancel leg is not padding: it is the reason the fix derives moot-ness
 * at read time instead of stamping a `voided` status at cancel time. Staff can
 * put a cancelled booking back (`PUT /appointments/:id` takes any status), and
 * a stored flag would leave the patient permanently unable to sign.
 */
test.describe('marketing-astro · portal consent forms for cancelled bookings', () => {
  test.skip(!PORTAL_E2E_READY, PORTAL_E2E_SKIP_REASON);
  // Two staff-seeded appointments, a real OTP sign-in, and several portal
  // round trips.
  test.setTimeout(240_000);

  const FORM_TITLE = 'Treatment consent (E2E)';

  let seed: PortalSeed | undefined;
  let orgSlug = '';
  let leadEmail = '';

  /** The booking that gets cancelled, and the form it issued. */
  let cancelledApptId = '';
  let cancelledFormId = '';
  /** The control: a booking that stays live throughout. */
  let liveFormId = '';

  test.beforeAll(async ({ playwright }) => {
    seed = await PortalSeed.staff(playwright.request);
    orgSlug = seed.orgSlug;

    // Unique per WORKER, not merely per millisecond — `fullyParallel` runs a
    // file's tests across workers, so two can mint the same lead email in the
    // same millisecond and collide on 409.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    leadEmail = `e2e.consent.${runId}@example.com`;

    const template = await createConsentTemplate(seed, {
      title: FORM_TITLE,
      body: 'I consent to the treatment described above.',
    });
    const service = await createService(seed, {
      name: `E2E Consent Service ${runId}`,
      appointmentDuration: 30,
    });
    await requireConsentForService(seed, service.id, [template.id]);

    const lead = await seed.createLead({
      firstName: `E2E Consent ${runId}`,
      email: leadEmail,
    });

    // TWO bookings on the same consent-requiring service. The second one is
    // what stops a filter that simply hides everything from passing this spec.
    const cancelled = await createStaffAppointment(seed, {
      title: `E2E cancel-me ${runId}`,
      leadId: lead.id,
      serviceId: service.id,
    });
    cancelledApptId = cancelled.id;
    const live = await createStaffAppointment(seed, {
      title: `E2E keep-me ${runId}`,
      leadId: lead.id,
      serviceId: service.id,
      startDate: new Date(Date.now() + 5 * 24 * 3600 * 1000),
    });

    [cancelledFormId] = (
      await waitForConsentSubmissions(seed, cancelled.id)
    ).map((s) => s.id);
    [liveFormId] = (await waitForConsentSubmissions(seed, live.id)).map(
      (s) => s.id
    );
  });

  test.afterAll(async () => {
    await seed?.dispose();
  });

  test('hides the cancelled booking’s form, keeps the live one, and restores it on un-cancel', async ({
    page,
  }) => {
    await test.step('sign in as the customer', async () => {
      await page.goto(portalPath(orgSlug, '/sign-in'), {
        waitUntil: 'domcontentloaded',
      });
      await fillHydrated(page.getByLabel('Email'), leadEmail, expect);
      await page.getByRole('button', { name: 'Continue' }).click();

      const group = page.getByRole('group', { name: '6-digit code' });
      // Wait for the code step BEFORE minting: Continue triggers the app's own
      // OTP request, and minting into that window means the app's code lands
      // second and invalidates ours.
      await expect(group).toBeVisible({ timeout: 15_000 });
      const otp = await requireSeed(seed).patientOtp(leadEmail);
      await group.locator('input').first().focus();
      await page.keyboard.type(otp);
      await page.waitForURL(`**${portalPath(orgSlug)}`, { timeout: 20_000 });
    });

    await test.step('both forms are outstanding to begin with', async () => {
      // The precondition, asserted rather than assumed. Without this the
      // "gone after cancelling" step below could pass on a portal that never
      // showed the card at all.
      await expect(page.getByText('2 forms to complete')).toBeVisible({
        timeout: 20_000,
      });
    });

    await test.step('the cancelled-to-be form opens and is signable', async () => {
      await page.goto(portalPath(orgSlug, `/forms/${cancelledFormId}`), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('heading', { name: FORM_TITLE })).toBeVisible(
        { timeout: 20_000 }
      );
    });

    await test.step('staff cancel the booking', async () => {
      await setAppointmentStatus(
        requireSeed(seed),
        cancelledApptId,
        'cancelled'
      );
    });

    await test.step('the nudge drops to the ONE live form', async () => {
      await page.goto(portalPath(orgSlug), { waitUntil: 'domcontentloaded' });
      // Singular copy, not merely "the count changed": this is the exact
      // string the customer reads, and it proves the live form survived the
      // filter that removed the cancelled one.
      await expect(page.getByText('1 form to complete')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('2 forms to complete')).toHaveCount(0);
    });

    await test.step('the live form still opens', async () => {
      await page.goto(portalPath(orgSlug, `/forms/${liveFormId}`), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('heading', { name: FORM_TITLE })).toBeVisible(
        { timeout: 20_000 }
      );
    });

    await test.step('the cancelled form’s own URL no longer opens the sign screen', async () => {
      // The link the clinic already emailed them, or a tab left open
      // overnight. `list` hiding the card is not enough on its own.
      await page.goto(portalPath(orgSlug, `/forms/${cancelledFormId}`), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByText('Form not found')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole('heading', { name: FORM_TITLE })).toHaveCount(
        0
      );
    });

    await test.step('un-cancelling brings it back', async () => {
      // The whole case for deriving this at read time. A `voided` column
      // stamped at cancel time would still be set here, and the patient could
      // never sign a form for a booking that is back on.
      await setAppointmentStatus(requireSeed(seed), cancelledApptId, 'booked');

      await page.goto(portalPath(orgSlug, `/forms/${cancelledFormId}`), {
        waitUntil: 'domcontentloaded',
      });
      await expect(page.getByRole('heading', { name: FORM_TITLE })).toBeVisible(
        { timeout: 20_000 }
      );

      await page.goto(portalPath(orgSlug), { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('2 forms to complete')).toBeVisible({
        timeout: 20_000,
      });
    });
  });
});
