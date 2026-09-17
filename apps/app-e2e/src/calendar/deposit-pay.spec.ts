import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Calendar tab — appointment DEPOSITS, pay leg (Stripe-stub E2E tier, see
 * STRIPE-TIER.md §2/§4). Runs ONLY where `STRIPE_E2E_STUB=true` on the target
 * API: the stub swaps the Connect client so `createDepositCheckout` returns a
 * deterministic fake session (`cs_e2e_*`) — no real Stripe — and settlement is
 * driven server-side by injecting `checkout.session.completed` through
 * `POST /testing/simulate-stripe-webhook`, which calls the SAME settlement
 * service (`handleDepositWebhook`) the real Connect webhook router dispatches to
 * on `metadata.type === 'appointment_deposit'`
 * (`apps/api/src/testing/testing.service.ts:1560-1591`).
 *
 * There is no in-app UI to request a deposit (the deposit surfaces are all
 * onboarding config); a deposit is minted via `POST /deposits`
 * (`apps/api/src/deposits/deposits.controller.ts:48-58`). So the deposit request
 * is driven through the org's own cookie-authed session (`authenticatedApiCall`)
 * — the grounded path — while the money transition and its calendar reflection
 * are asserted end-to-end. Viewport-agnostic: the seeded booking renders at both
 * desktop and mobile (like `calendar.spec.ts`), so no `isMobile` skip.
 *
 * Contract (read from `handleDepositWebhook`):
 *  - `handle-deposit-webhook.schema.ts:3-12` — `{ eventType, checkoutSessionId?,
 *    paymentIntentId?, metadata? }`.
 *  - `handle-deposit-webhook.service.ts:79-136` (`handleCheckoutCompleted`) looks
 *    the deposit up by `stripeCheckoutSessionId === checkoutSessionId`, flips it
 *    to `paid` (storing `paymentIntentId`), and sets the appointment to
 *    `confirmed`. So we inject the deposit's own `stripeCheckoutSessionId`.
 */
const STUB_ENABLED = process.env.STRIPE_E2E_STUB === 'true';

interface SeededDeposit {
  appointmentId: string;
  depositId: string;
  checkoutSessionId: string;
  title: string;
}

/** Flip the org onto Borradh's built-in calendar so the seeded booking renders. */
async function enableBuiltInCalendar(seed: {
  authenticatedApiCall: (
    method: 'PATCH',
    path: string,
    data: unknown
  ) => Promise<unknown>;
}): Promise<void> {
  await seed.authenticatedApiCall('PATCH', '/organization/active', {
    bookingDestination: 'borradh',
  });
}

/**
 * Seed a booked appointment (via a fresh lead) and a pending deposit request for
 * it, all through the org's cookie-authed session. Returns the ids + the fake
 * `cs_e2e_*` checkout session the settlement webhook must reference.
 */
async function seedDepositRequest(seed: {
  authenticatedApiCall: (
    method: 'PATCH' | 'POST' | 'GET' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown
  ) => Promise<unknown>;
}): Promise<SeededDeposit> {
  const title = `E2E Deposit Appt ${Date.now()}`;

  const lead = (await seed.authenticatedApiCall('POST', '/leads', {
    firstName: `E2E Client ${Date.now()}`,
  })) as { id: string };
  expect(lead.id, 'lead seed should return an id').toBeTruthy();

  // Book it for midday today so it lands inside the current month/day.
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  end.setHours(13, 0, 0, 0);

  const appointment = (await seed.authenticatedApiCall(
    'POST',
    '/appointments',
    {
      title,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      leadId: lead.id,
    }
  )) as { id: string; status: string };
  expect(appointment.id, 'appointment seed should return an id').toBeTruthy();
  // A fresh appointment defaults to 'booked' (create-appointment.schema.ts:15).
  expect(appointment.status).toBe('booked');

  // Mint the deposit. With STRIPE_E2E_STUB the stub Connect client returns a
  // deterministic `cs_e2e_*` session id (no real Stripe).
  const created = (await seed.authenticatedApiCall('POST', '/deposits', {
    appointmentId: appointment.id,
    amountCents: 2000,
    currency: 'usd',
    successUrl: 'https://stub.e2e.local/deposit/success',
    cancelUrl: 'https://stub.e2e.local/deposit/cancel',
  })) as {
    deposit: {
      id: string;
      status: string;
      stripeCheckoutSessionId: string | null;
    };
  };
  expect(
    created.deposit.id,
    'deposit create should return a deposit'
  ).toBeTruthy();
  expect(created.deposit.status).toBe('pending');
  expect(
    created.deposit.stripeCheckoutSessionId,
    'stub should mint a checkout session id'
  ).toBeTruthy();

  return {
    appointmentId: appointment.id,
    depositId: created.deposit.id,
    checkoutSessionId: created.deposit.stripeCheckoutSessionId as string,
    title,
  };
}

test.describe('Calendar · deposits (pay, stubbed Stripe)', () => {
  test('a paid deposit confirms the appointment and it renders on the calendar', async ({
    org,
  }) => {
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    const { page, orgId, seed } = org;

    // A deposit request needs an active, charges-enabled connected account.
    await seed.seedStripeConnect({ organizationId: orgId });
    await enableBuiltInCalendar(seed);

    const deposit = await seedDepositRequest(seed);

    // Settle server-side: inject the completion webhook for THIS deposit's
    // checkout session (metadata routes it to handleDepositWebhook, which pairs
    // the paymentIntentId onto the deposit for the refund path).
    const injected = await seed.simulateStripeWebhook({
      eventType: 'checkout.session.completed',
      metadata: {
        type: 'appointment_deposit',
        appointmentId: deposit.appointmentId,
        organizationId: orgId,
      },
      checkoutSessionId: deposit.checkoutSessionId,
      paymentIntentId: `pi_e2e_deposit_${Date.now()}`,
    });
    expect(injected.processed, 'webhook settled the deposit').toBe(true);
    expect(injected.action).toBe('paid');

    // The deposit is now paid…
    const depositRow = (await seed.authenticatedApiCall(
      'GET',
      `/deposits/${deposit.depositId}`
    )) as { status: string; stripePaymentIntentId: string | null };
    expect(depositRow.status).toBe('paid');
    expect(
      depositRow.stripePaymentIntentId,
      'the injected payment intent is recorded (refund key)'
    ).toBeTruthy();

    // …and the appointment moved booked → confirmed.
    const appt = (await seed.authenticatedApiCall(
      'GET',
      `/appointments/${deposit.appointmentId}`
    )) as { status: string };
    expect(appt.status).toBe('confirmed');

    // UI leg: the confirmed booking renders on the built-in calendar under auth.
    // Agenda lists every event for the month regardless of per-staff columns.
    await gotoSurface(page, '/dashboard/calendar/agenda');
    const eventCard = page.getByText(deposit.title).first();
    await expect(eventCard).toBeVisible({ timeout: 30_000 });
  });
});
