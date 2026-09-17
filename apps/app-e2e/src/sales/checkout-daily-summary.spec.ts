import { gotoSurface, summaryRow } from '../fixtures/app.js';
import { addGiftCardLine } from '../fixtures/checkout.fixture.js';
import { expect, test } from '../fixtures/org.fixture.js';

/**
 * Sales tab — a UI-COMPLETED sale is reflected in the daily summary. The
 * daily-summary spec asserts the empty-day tables; this closes the loop by
 * driving a real cash checkout through the POS (not a seeded sale) and then
 * asserting the summary totals moved off zero to match it.
 *
 * The org is freshly provisioned and empty, so before the sale every gross/
 * collected cell reads €0.00. A single €40 gift-card cash sale must then surface
 * as €40.00 on the transaction summary's "Gift cards" row and the cash-movement
 * "Cash" row — proving the app → API → DB → summary aggregation round-trip for a
 * sale the test itself put through the UI.
 *
 * RUNS AT BOTH VIEWPORTS: the checkout POS and the summary tables render at
 * desktop and mobile alike (summary money always formats in EUR).
 */
test.describe('Sales · daily summary reflects a UI-completed sale', () => {
  test('complete a cash sale in the POS, summary totals update', async ({
    org,
  }) => {
    const { page } = org;
    await gotoSurface(page, '/dashboard/sales/daily-summary');

    // Complete a €40 gift-card cash sale through the real checkout overlay.
    await page.getByRole('button', { name: 'Add new' }).click();
    await expect(
      page.getByRole('heading', { name: 'Add to cart' })
    ).toBeVisible({ timeout: 30_000 });

    await addGiftCardLine(page, 40);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByRole('button', { name: 'Continue to payment' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Select payment' })
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Add cash amount' })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // The POS adds every tender with `autoComplete: false` (payment-panel.tsx),
    // so a fully-paid sale deliberately stays `open` and the operator confirms
    // it — the "Complete sale" action MUST render once the cash covers the
    // balance. Assert it, then click: no click ⇒ no completed sale ⇒ no summary.
    const completeBtn = page.getByRole('button', { name: 'Complete sale' });
    await expect(completeBtn).toBeVisible({ timeout: 15_000 });
    await completeBtn.click();
    await expect(
      page.getByRole('heading', { name: 'Sale complete' })
    ).toBeVisible({ timeout: 30_000 });

    // Re-open the daily summary fresh (full nav unmounts the overlay + refetches
    // the summary, which now aggregates today's completed sale).
    await gotoSurface(page, '/dashboard/sales/daily-summary');
    await expect(page.getByText('Transaction summary')).toBeVisible({
      timeout: 30_000,
    });

    // Viewport-agnostic rows: desktop renders a table (`role="row"`), mobile a
    // MobileRecordRow list (<li>, no table semantics — the old role-based
    // locators could only ever time out there). Matchers are case-insensitive
    // because the copy differs ("Total Sales" vs "Total sales").
    //
    // Transaction summary: the "Gift cards" item row shows the €40.00 gross.
    await expect(summaryRow(page, /gift cards/i)).toContainText('€40.00', {
      timeout: 20_000,
    });
    // Total sales aggregates to the same €40.00.
    await expect(summaryRow(page, /total sales/i)).toContainText('€40.00');
    // Cash-movement summary: the "Cash" row collected €40.00.
    await expect(summaryRow(page, /^cash/i)).toContainText('€40.00');
  });
});
