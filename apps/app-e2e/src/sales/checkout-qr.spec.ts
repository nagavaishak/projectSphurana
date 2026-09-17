import { gotoSurface, isMobile } from '../fixtures/app.js';
import { addGiftCardLine } from '../fixtures/checkout.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Sales tab — checkout with a PROCESSED card tender (QR self-checkout), the
 * exemplar for the Stripe-stub E2E tier (see STRIPE-TIER.md). Runs ONLY where
 * `STRIPE_E2E_STUB=true` on the target API: the stub swaps the Connect client so
 * `createPaymentLink` returns a deterministic fake link (no real Stripe), and
 * settlement is driven server-side by injecting `checkout.session.completed`
 * through `POST /testing/simulate-stripe-webhook` — the same settlement service
 * the real webhook router calls. This is the device-free card path: unlike
 * manual_card (Stripe Elements, needs a real client secret) nothing is confirmed
 * client-side, so no real Stripe.js is involved.
 *
 * DESKTOP-ONLY, same as the cash checkout: the POS overlay is a fixed-width
 * layout that collapses at mobile width; a mobile POS is a separate flow.
 */
const STUB_ENABLED = process.env.STRIPE_E2E_STUB === 'true';

test.describe('Sales · checkout (QR self-checkout, stubbed Stripe)', () => {
  test('add a line, pay by QR, settle via injected webhook, complete', async ({
    org,
  }) => {
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    const { page, orgId, seed } = org;
    test.skip(
      isMobile(page),
      'POS checkout overlay is a fixed-width desktop layout; the step region ' +
        'collapses off-screen at mobile width. Mobile POS is a separate flow.'
    );

    // Any Stripe-backed tender needs an active, charges-enabled connected
    // account — seed a stub `acct_e2e_*` one for this org.
    await seed.seedStripeConnect({ organizationId: orgId });

    await gotoSurface(page, '/dashboard/sales/daily-summary');
    await page.getByRole('button', { name: 'Add new' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add to cart' })
    ).toBeVisible({ timeout: 30_000 });

    // Add a gift-card line (needs no other seeded entity) to give the sale a
    // positive balance to charge.
    await addGiftCardLine(page, 50);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByRole('button', { name: 'Continue to payment' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Select payment' })
    ).toBeVisible({ timeout: 15_000 });

    // Choose QR self-checkout — the stub mints a fake Payment Link, rendered as
    // a scannable code in the "Scan to pay" dialog.
    await page.getByRole('button', { name: 'QR Self-Checkout' }).click();
    await expect(
      page.getByRole('heading', { name: 'Scan to pay' })
    ).toBeVisible({ timeout: 15_000 });
    // The QR resolves once the stub link comes back (fake stub.e2e.local URL).
    await expect(page.getByText(/stub\.e2e\.local\/pay\//)).toBeVisible({
      timeout: 15_000,
    });

    // Settle server-side: find the pending QR tender and inject the completion
    // webhook for it (metadata routes it to handleSalePaymentWebhook).
    const { saleId, payments } = await seed.getOpenSale(orgId);
    const qrTender = payments.find(
      (p) => p.method === 'qr_self_checkout' && p.status === 'pending'
    );
    expect(
      qrTender,
      'a pending QR tender exists on the open sale'
    ).toBeTruthy();

    const injected = await seed.simulateStripeWebhook({
      eventType: 'checkout.session.completed',
      metadata: {
        type: 'sale_payment',
        salePaymentId: qrTender?.id ?? '',
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
    // QR dialog auto-closes, and the receipt renders with no click from us.
    await expect(
      page.getByRole('heading', { name: 'Sale complete' })
    ).toBeVisible({ timeout: 30_000 });
  });
});
