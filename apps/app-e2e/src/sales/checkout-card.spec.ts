import { gotoSurface } from '../fixtures/app.js';
import {
  addGiftCardLine,
  waitForOpenSaleTender,
} from '../fixtures/checkout.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Sales tab — checkout with the `manual_card` (keyed card) tender, Stripe-stub
 * tier (see STRIPE-TIER.md §3-4). Runs ONLY where `STRIPE_E2E_STUB=true` on the
 * target API: the stub swaps the Connect client so `createCardPaymentIntent`
 * returns a deterministic `pi_e2e_*` PaymentIntent (no real Stripe), and the
 * pending `sale_payment` row is settled server-side by injecting
 * `payment_intent.succeeded` through `POST /testing/simulate-stripe-webhook` —
 * the same settlement service (`handleSalePaymentWebhook`) the real webhook
 * router calls.
 *
 * BOUNDARY — the in-dialog Stripe Elements confirm is NOT driven here. The
 * manual-card dialog collects the card in a Stripe.js iframe whose confirm
 * needs a real `client_secret` (STRIPE-TIER.md §0/§3: "manual_card needs Stripe
 * Elements + a real client secret confirmed in an iframe — non-deterministic,
 * network-bound"). The stub returns a fake secret, so we settle via webhook
 * injection instead — exactly the QR/terminal settlement mechanism. This spec
 * therefore proves the UI→create-pending-tender→server-settlement→completed-sale
 * leg; the card-form confirm itself is covered by unit/integration
 * (`settle-card-payment.test.ts`, `payments-infra.int-spec.ts`).
 *
 * RUNS AT BOTH VIEWPORTS: the checkout POS works on mobile (see checkout.spec.ts)
 * and this never interacts with the Stripe iframe, so no viewport branch.
 */
const STUB_ENABLED = process.env.STRIPE_E2E_STUB === 'true';

test.describe('Sales · checkout (manual card, stubbed Stripe)', () => {
  test('select manual card, settle via injected webhook, complete', async ({
    org,
  }) => {
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    const { page, orgId, seed } = org;

    // Any card tender needs an active, charges-enabled connected account.
    await seed.seedStripeConnect({ organizationId: orgId });

    await gotoSurface(page, '/dashboard/sales/daily-summary');
    await page.getByRole('button', { name: 'Add new' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add to cart' })
    ).toBeVisible({ timeout: 30_000 });

    // €50 gift-card line ⇒ a positive balance to charge.
    await addGiftCardLine(page, 50);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByRole('button', { name: 'Continue to payment' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Select payment' })
    ).toBeVisible({ timeout: 15_000 });

    // Selecting Manual Card Entry charges the full balance and opens the Stripe
    // Elements dialog. The dialog title is present regardless of whether the
    // (stubbed) client secret has arrived, so it's a stable anchor.
    await page.getByRole('button', { name: 'Manual Card Entry' }).click();
    await expect(page.getByText(/Card payment ·/)).toBeVisible({
      timeout: 15_000,
    });

    // A pending `manual_card` tender now exists with a stub PaymentIntent id.
    // The dialog opens BEFORE the create-tender POST resolves, so poll for it —
    // and poll for the PaymentIntent id too, which is attached a beat after the
    // row itself (the assertion below reads it, and the webhook is addressed to
    // it).
    const { saleId, tender: cardTender } = await waitForOpenSaleTender(
      seed,
      orgId,
      {
        method: 'manual_card',
        status: 'pending',
        withStripePaymentIntent: true,
      }
    );
    expect(
      cardTender?.stripePaymentIntentId,
      'the pending tender carries a stub PaymentIntent id'
    ).toBeTruthy();

    // Settle it server-side by injecting the PaymentIntent-succeeded webhook.
    const injected = await seed.simulateStripeWebhook({
      eventType: 'payment_intent.succeeded',
      paymentIntentId: cardTender?.stripePaymentIntentId ?? '',
      metadata: {
        type: 'sale_payment',
        salePaymentId: cardTender?.id ?? '',
        saleId,
        organizationId: orgId,
      },
    });
    expect(injected.processed, 'webhook settled the tender').toBe(true);

    // Webhook-settled tenders complete the sale SERVER-SIDE:
    // `handleSalePaymentWebhook` calls `autoCompleteIfFullyPaid` once the tender
    // covers the total ("Stripe tenders settle asynchronously here — no
    // 'Complete sale' click ever follows"). The checkout's `getSale` query polls
    // while a pending tender exists, so it pulls in `status: 'completed'`, the
    // card dialog auto-closes, and the receipt renders with no click from us.
    await expect(
      page.getByRole('heading', { name: 'Sale complete' })
    ).toBeVisible({ timeout: 30_000 });
  });
});
