import { gotoSurface } from '../fixtures/app.js';
import {
  addGiftCardLine,
  waitForOpenSaleTender,
} from '../fixtures/checkout.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

interface SaleRead {
  id: string;
  status: string;
}

/**
 * Sales tab — REFUND a card sale, Stripe-stub tier (see STRIPE-TIER.md §4:
 * "charge.refunded on a card sale"). Runs ONLY where `STRIPE_E2E_STUB=true`.
 * Refund of a settled card tender is a webhook-only transition — there is no
 * web POS control for it (unlike void, covered by sale-void.spec.ts) — so the
 * flow drives a full card sale through the UI (create pending manual_card tender
 * → settle via injected `payment_intent.succeeded` → complete), then injects
 * `charge.refunded` for the full amount and asserts the sale flips to
 * "refunded". Both injections hit `handleSalePaymentWebhook`, the same
 * settlement service the real webhook router calls.
 *
 * BOUNDARY: as in checkout-card.spec.ts, the in-dialog Stripe Elements confirm
 * is not driven (fake client secret); settlement is webhook-injected. Depth on
 * the refund service contract itself lives in unit tests
 * (`handle-sale-payment-webhook.test.ts`).
 */
const STUB_ENABLED = process.env.STRIPE_E2E_STUB === 'true';

test.describe('Sales · refund a card sale (stubbed Stripe)', () => {
  test('settle a manual-card sale, then refund it via injected webhook', async ({
    org,
  }) => {
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    const { page, orgId, seed } = org;

    await seed.seedStripeConnect({ organizationId: orgId });

    await gotoSurface(page, '/dashboard/sales/daily-summary');
    await page.getByRole('button', { name: 'Add new' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add to cart' })
    ).toBeVisible({ timeout: 30_000 });

    // €50 gift-card line ⇒ a balance to charge to the card.
    await addGiftCardLine(page, 50);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByRole('button', { name: 'Continue to payment' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Select payment' })
    ).toBeVisible({ timeout: 15_000 });

    // Create the pending manual_card tender.
    await page.getByRole('button', { name: 'Manual Card Entry' }).click();
    await expect(page.getByText(/Card payment ·/)).toBeVisible({
      timeout: 15_000,
    });

    // The card dialog opens BEFORE the create-tender POST resolves — poll. The
    // PaymentIntent id lands a beat after the row, and the injected webhook is
    // addressed to it, so wait for the field, not just the tender.
    const { saleId, tender: cardTender } = await waitForOpenSaleTender(
      seed,
      orgId,
      {
        method: 'manual_card',
        status: 'pending',
        withStripePaymentIntent: true,
      }
    );
    expect(cardTender?.stripePaymentIntentId).toBeTruthy();
    const paymentIntentId = cardTender?.stripePaymentIntentId ?? '';
    const routing = {
      type: 'sale_payment' as const,
      salePaymentId: cardTender?.id ?? '',
      saleId,
      organizationId: orgId,
    };

    // Settle the tender, then complete the sale.
    const settled = await seed.simulateStripeWebhook({
      eventType: 'payment_intent.succeeded',
      paymentIntentId,
      metadata: routing,
    });
    expect(settled.processed, 'settlement webhook processed').toBe(true);

    // Webhook-settled tenders complete the sale SERVER-SIDE
    // (`handleSalePaymentWebhook` → `autoCompleteIfFullyPaid`), and the
    // checkout's polling `getSale` query pulls the completed status in — so the
    // receipt renders with no "Complete sale" click.
    await expect(
      page.getByRole('heading', { name: 'Sale complete' })
    ).toBeVisible({ timeout: 30_000 });

    // Inject a full refund for the settled charge.
    const refunded = await seed.simulateStripeWebhook({
      eventType: 'charge.refunded',
      paymentIntentId,
      amountRefundedCents: 5000,
      metadata: routing,
    });
    expect(refunded.processed, 'refund webhook processed').toBe(true);

    // Persisted side-effect: the sale is now fully refunded.
    await expect
      .poll(
        async () => {
          const read = (await seed.authenticatedApiCall(
            'GET',
            `/sales/${saleId}`
          )) as SaleRead;
          return read.status;
        },
        { timeout: 20_000 }
      )
      .toBe('refunded');
  });
});
