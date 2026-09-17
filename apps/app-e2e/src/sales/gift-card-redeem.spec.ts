import { gotoSurface } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';
import { listGiftCards, seedCompletedCashSale } from './sales-seed.js';

/**
 * Sales tab — REDEEM a gift card on a sale. Complements gift-cards.spec.ts
 * (which issues + tops up a card): here a previously-issued gift card is spent
 * as the tender on a second sale through the real POS gift-card redemption path,
 * and the persisted balance drop is asserted via the API.
 *
 * Issue leg: a completed cash sale with a gift-card line issues the card (the
 * API mirror of the POS issue flow, as in gift-cards.spec.ts) — this keeps the
 * test focused on the novel REDEEM money-path rather than re-driving a second
 * full UI checkout to mint the card.
 *
 * Redeem leg (driven through the UI): a €30 service sale, paid in full by
 * entering the issued card's code in the Gift Card tender keypad. A €50 card
 * paying a €30 sale must settle the sale and leave the card at €20.00.
 *
 * RUNS AT BOTH VIEWPORTS: the payment keypad + gift-card code field render in
 * the shared checkout flow at desktop and mobile.
 */
test.describe('Sales · redeem a gift card', () => {
  test('issue a gift card, then redeem it on a second sale', async ({
    org,
  }) => {
    const { page, seed } = org;

    // Issue a €50 gift card via a completed cash sale, then read its code.
    await seedCompletedCashSale(seed, {
      amountCents: 5000,
      itemName: 'Gift card',
    });
    const issued = await listGiftCards(seed);
    expect(issued.length).toBeGreaterThan(0);
    const card = issued[0];
    expect(card.balanceCents).toBe(5000);

    // Seed a €30 service to be the payable line on the redeeming sale.
    const serviceName = `E2E Redeem Service ${Date.now()}`;
    await seed.authenticatedApiCall('POST', '/organization-services', {
      name: serviceName,
      priceText: '€30',
      priceCents: 3000,
    });

    await gotoSurface(page, '/dashboard/sales/daily-summary');
    await page.getByRole('button', { name: 'Add new' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add to cart' })
    ).toBeVisible({ timeout: 30_000 });

    // Add the €30 service line.
    await page.getByRole('button', { name: 'Service' }).click();
    // Scope to the picker dialog specifically — the checkout sheet is also a
    // role="dialog", so filter by the picker's own heading.
    const picker = page
      .getByRole('dialog')
      .filter({ hasText: 'Add a service' });
    await expect(
      picker.getByRole('heading', { name: 'Add a service' })
    ).toBeVisible({ timeout: 15_000 });
    await picker.getByText(serviceName).click();
    await expect(
      page.getByRole('heading', { name: 'Add a service' })
    ).toBeHidden({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByRole('button', { name: 'Continue to payment' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Select payment' })
    ).toBeVisible({ timeout: 15_000 });

    // Choose the Gift Card tender and open its amount keypad.
    await page.getByRole('button', { name: 'Gift Card' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add gift card amount' })
    ).toBeVisible({ timeout: 15_000 });

    // Enter the issued card's code and look it up — its €50.00 balance renders.
    // Scope to the "Balance:" readout: a €50.00 quick-tender chip also exists.
    await page.locator('#gc-code').fill(card.code);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText(/Balance:\s*€50\.00/)).toBeVisible({
      timeout: 15_000,
    });

    // Charge the €30 balance to the card (keypad seeds the outstanding amount).
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // The POS adds every tender with `autoComplete: false` (payment-panel.tsx),
    // so the gift-card redemption settles instantly but leaves the sale `open`
    // for the operator to confirm — the "Complete sale" action MUST render once
    // the card covers the €30 balance.
    const completeBtn = page.getByRole('button', { name: 'Complete sale' });
    await expect(completeBtn).toBeVisible({ timeout: 15_000 });
    await completeBtn.click();
    await expect(
      page.getByRole('heading', { name: 'Sale complete' })
    ).toBeVisible({ timeout: 30_000 });

    // Persisted side-effect: the redeemed card's balance dropped €50 → €20.
    await expect
      .poll(
        async () => {
          const after = await listGiftCards(seed);
          return after.find((c) => c.id === card.id)?.balanceCents;
        },
        { timeout: 20_000 }
      )
      .toBe(2000);
  });
});
