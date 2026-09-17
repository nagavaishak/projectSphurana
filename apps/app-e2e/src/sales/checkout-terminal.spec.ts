import { gotoSurface, isMobile } from '../fixtures/app.js';
import { addGiftCardLine } from '../fixtures/checkout.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Sales tab — checkout with the `card_terminal` (Tap to Pay) tender, Stripe-stub
 * tier (see STRIPE-TIER.md §4: "card_terminal (settlement only)"). The design
 * intent was to assert the SERVER-SETTLEMENT half only — select the Card Terminal
 * tender, see the "Waiting for the card reader…" dialog, then settle server-side
 * by injecting `payment_intent.succeeded` and assert the sale completes — leaving
 * the native reader collection to the Maestro lane (STRIPE-TIER.md §6.D / §7).
 *
 * BLOCKER — the browser cannot reach this tender at all (not just the reader):
 * `card_terminal` is NOT rendered in the checkout payment step. `PaymentPanel`
 * (apps/app/src/features/sales/components/checkout/payment-panel.tsx) only lists
 *   BASIC_METHODS     = ['cash', 'gift_card', 'manual_card']   (line 44)
 *   PROCESSED_METHODS = ['qr_self_checkout']                   (line 46)
 * and renders exactly those two groups (lines 267-277). `card_terminal` is never
 * added to either array, so no "Card Terminal" button ever exists in the web UI.
 * All the terminal plumbing IS present but unreachable from a browser:
 *   - METHOD_ICON.card_terminal (SmartphoneIcon, line 50)
 *   - `if (payMethod === 'card_terminal') input.readerType = 'tap_to_pay'` (:197)
 *   - the 'Charge' keypad submit label `method === 'card_terminal' ? 'Charge'…` (:292)
 *   - the `terminalPending` "Waiting for the card reader…" dialog (:420-452)
 * None of it is wired to a selectable control — Tap to Pay is native-only, so the
 * tender is intentionally absent from the web method chooser.
 *
 * Consequence for the settlement-only assertion: creating a pending
 * `card_terminal` sale_payment row is what mints the `salePaymentId` the webhook
 * injection settles, and that row is only written by `add-sale-payment` when the
 * UI selects the tender. With no selectable button (and no add-sale-payment seed
 * helper — `org.seed` exposes only `seedStripeConnect` / `getOpenSale` (read) /
 * `simulateStripeWebhook`), there is no way to produce a pending card_terminal
 * tender through the E2E harness. So even the server-settlement half cannot be
 * exercised end-to-end from the browser: there is nothing to settle.
 *
 * Coverage for the terminal settlement path therefore lives where it can run:
 *   - unit: handle-sale-payment-webhook.test.ts, settle-card-payment.test.ts
 *   - integration: payments-infra.int-spec.ts (controller→service wiring)
 *   - native reader collection: Maestro lane (TAB-SUITE.md §6.D)
 * The injection endpoint the design relied on IS proven by the sibling QR spec
 * (checkout-qr.spec.ts), which drives a real pending tender to settlement.
 *
 * This file is a `test.fixme` placeholder so the gap is recorded in the tier and
 * shows in `--list`. The body below IS the QR-spec-shaped flow the design called
 * for, written out in full and asserting its subject — it simply cannot run
 * today because the "Card Terminal" button it clicks does not exist in the web
 * method chooser. `test.fixme` aborts before it. If a future change adds
 * `card_terminal` to `BASIC_METHODS`/`PROCESSED_METHODS` (or an add-sale-payment
 * seed helper lands that can mint a pending card_terminal row), delete the
 * `test.fixme(...)` call and the flow runs as written.
 *
 * DESKTOP-ONLY, like its checkout siblings: the POS overlay is a fixed-width
 * desktop layout whose step region collapses off-screen at mobile width.
 */
const STUB_ENABLED = process.env.STRIPE_E2E_STUB === 'true';

test.describe('Sales · checkout (card terminal / Tap to Pay, stubbed Stripe)', () => {
  test('select card terminal tender, settle via injected webhook, complete', async ({
    org,
  }) => {
    const { page, orgId, seed } = org;
    test.skip(
      !STUB_ENABLED,
      'Requires STRIPE_E2E_STUB on the target API (see STRIPE-TIER.md).'
    );
    test.skip(
      isMobile(page),
      'POS checkout overlay is a fixed-width desktop layout; the step region ' +
        'collapses off-screen at mobile width. Mobile POS is a separate flow.'
    );
    // Not driveable in a browser: the `card_terminal` tender is never rendered in
    // the checkout method chooser (payment-panel.tsx BASIC/PROCESSED_METHODS omit
    // it — Tap to Pay is native-only), and no seed helper can mint a pending
    // card_terminal row to settle. See the file header for the full analysis.
    // Everything below is the flow that will run the moment the tender becomes
    // selectable; it aborts here until then.
    test.fixme(
      true,
      'card_terminal is native-only and not rendered in the web checkout ' +
        'method chooser; the server-settlement half has no pending tender to ' +
        'settle from a browser. Covered by unit/integration + the Maestro lane ' +
        '(STRIPE-TIER.md §6.D/§7).'
    );

    // Any Stripe-backed tender needs an active, charges-enabled connected
    // account — seed a stub `acct_e2e_*` one for this org.
    await seed.seedStripeConnect({ organizationId: orgId });

    await gotoSurface(page, '/dashboard/sales/daily-summary');
    await page.getByRole('button', { name: 'Add new' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add to cart' })
    ).toBeVisible({ timeout: 30_000 });

    // A €50 gift-card line (needs no other seeded entity) gives the sale a
    // positive balance to charge to the reader.
    await addGiftCardLine(page, 50);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByRole('button', { name: 'Continue to payment' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Select payment' })
    ).toBeVisible({ timeout: 15_000 });

    // Select the Card Terminal tender (`salePaymentMethodLabels.card_terminal`)
    // and charge the full balance from the keypad (submit label "Charge") — the
    // reader-pending dialog opens while the tender awaits its webhook.
    await page.getByRole('button', { name: 'Card Terminal' }).click();
    await page.getByRole('button', { name: 'Charge', exact: true }).click();
    await expect(page.getByText(/Waiting for the card reader/i)).toBeVisible({
      timeout: 15_000,
    });

    // A pending `card_terminal` tender now exists with a stub PaymentIntent id.
    const { saleId, payments } = await seed.getOpenSale(orgId);
    const terminalTender = payments.find(
      (p) => p.method === 'card_terminal' && p.status === 'pending'
    );
    expect(
      terminalTender,
      'a pending card_terminal tender exists on the open sale'
    ).toBeTruthy();

    // Settle it server-side by injecting the PaymentIntent-succeeded webhook —
    // the same `handleSalePaymentWebhook` path the real webhook router calls.
    const injected = await seed.simulateStripeWebhook({
      eventType: 'payment_intent.succeeded',
      paymentIntentId: terminalTender?.stripePaymentIntentId ?? '',
      metadata: {
        type: 'sale_payment',
        salePaymentId: terminalTender?.id ?? '',
        saleId,
        organizationId: orgId,
      },
    });
    expect(injected.processed, 'webhook settled the tender').toBe(true);

    // The webhook auto-completes the fully-paid sale server-side; the polling
    // sale query pulls it in, the reader dialog closes, and the receipt renders.
    await expect(page.getByText(/Waiting for the card reader/i)).toBeHidden({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('heading', { name: 'Sale complete' })
    ).toBeVisible({ timeout: 30_000 });
  });
});
