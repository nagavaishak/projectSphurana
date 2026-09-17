import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Settings · Payments — Stripe Connect onboarding COMPLETION, in the Stripe-stub
 * E2E tier (see STRIPE-TIER.md §4, "Connect onboarding" row). Real Connect hosted
 * onboarding can't be automated, so the only state our code consumes is the
 * `account.updated` webhook; injecting it via `POST /testing/simulate-stripe-webhook`
 * routes to `syncStripeAccountStatus`, which writes the charges/payouts/details
 * flags straight onto the org's `stripe_connect_integration` row.
 *
 * The Payments settings surface (`/dashboard/settings/payments` →
 * `StripeConnectPanel`) renders those flags directly from the DB row
 * (`getStripeConnectStatus` reads the row, never live Stripe), so it's the honest
 * end-to-end assertion point:
 *   - INCOMPLETE (detailsSubmitted:false, chargesEnabled:false) → "Finish setting
 *     up payments to start taking sales." + a "Set up payments" button, no Active
 *     badge.
 *   - COMPLETE (all flags on) → an "Active" badge next to the Payments title plus
 *     "Charges: On" / "Payouts: On" status pills.
 *
 * Runs ONLY where `STRIPE_E2E_STUB=true` on the target API. Viewport-agnostic —
 * the panel is a plain Card that renders identically at desktop and mobile width,
 * so it runs at both `tabs` and `tabs-mobile` with no mobile skip.
 */
const STUB_ENABLED = process.env.STRIPE_E2E_STUB === 'true';

test.describe('Settings · Stripe Connect onboarding (stubbed Stripe)', () => {
  test('incomplete account completes onboarding via injected account.updated', async ({
    org,
  }) => {
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    const { page, orgId, seed } = org;

    // Seed an INCOMPLETE controller Connect account: details not submitted and
    // charges not enabled — the onboarding-pending state.
    const { stripeAccountId } = await seed.seedStripeConnect({
      organizationId: orgId,
      chargesEnabled: false,
      detailsSubmitted: false,
    });

    // Before: the Payments surface reads as onboarding-pending, not active.
    await gotoSurface(page, '/dashboard/settings/payments');
    await expect(
      page.getByRole('heading', { name: /^Payments$/i })
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(/Finish setting up payments to start taking sales/i)
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: /Set up payments/i })
    ).toBeVisible();
    // Not-yet-active: no "Active" badge and no "Charges: On" pill.
    await expect(page.getByText('Charges: On')).toHaveCount(0);

    // Complete onboarding server-side: inject account.updated with every flag on.
    // The real webhook router hands this to syncStripeAccountStatus, which updates
    // the org's stripe_connect_integration row in place.
    const injected = await seed.simulateStripeWebhook({
      eventType: 'account.updated',
      stripeAccountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    expect(
      injected.processed,
      'account.updated synced the connected account'
    ).toBe(true);

    // Re-navigate (full reload re-fetches account-status) and assert the surface
    // now reads as connected/active.
    await gotoSurface(page, '/dashboard/settings/payments');
    await expect(page.getByText('Active', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Charges: On')).toBeVisible();
    await expect(page.getByText('Payouts: On')).toBeVisible();
    // The onboarding-pending prompt is gone.
    await expect(
      page.getByText(/Finish setting up payments to start taking sales/i)
    ).toHaveCount(0);
  });

  /**
   * Guards the stub itself, not the product.
   *
   * `StripeConnectStubService` EXTENDS the real service and is constructed with
   * a dummy key, so a method it fails to override runs the real implementation
   * and is rejected by Stripe. That happened to `createAccountSession` and
   * `createControllerAccount` for a month (~1200 preview errors, 2026-07-11 →
   * 08-19) WITHOUT turning this suite red: `StripeConnectPanel` wraps the
   * embedded components in a provider whose fallback reads "Payouts unavailable
   * in this environment", and the test above asserts on the Active badge and the
   * status pills — never on what the provider renders. The failure had somewhere
   * soft to land.
   *
   * So assert the server seam directly. `POST account-session` lazily provisions
   * the controller account (`ensureControllerAccount` → `createControllerAccount`)
   * and then mints the session, exercising BOTH methods that were falling
   * through. It cannot pass unless the stub actually serves them.
   */
  test('account-session is served by the stub, not forwarded to real Stripe', async ({
    org,
  }) => {
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    const { seed } = org;

    // No seedStripeConnect here on purpose — an org with no connected account
    // forces the lazy-provision path, so createControllerAccount runs too.
    const session = (await seed.authenticatedApiCall(
      'POST',
      '/integrations/stripe/account-session',
      {}
    )) as { clientSecret?: string };

    expect(
      session?.clientSecret,
      'account-session returned a client secret — the stub served both ' +
        'createControllerAccount and createAccountSession. An empty value here ' +
        'means one of them reached real Stripe with the dummy key.'
    ).toBeTruthy();
    expect(typeof session.clientSecret).toBe('string');
  });
});
