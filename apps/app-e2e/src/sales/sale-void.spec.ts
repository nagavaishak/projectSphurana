import { gotoSurface, saleRow } from '../fixtures/app.js';
import { expect, test } from '../fixtures/org.fixture.js';
import { seedLead, seedOpenSale } from './sales-seed.js';

interface SaleRead {
  id: string;
  status: string;
}

/**
 * Sales tab — VOID an open (unsettled) sale. Void is the reversal for an
 * abandoned open cart; the backend (void-sale.service) only permits it on an
 * OPEN sale with no settled tender — a completed/settled sale is reversed via
 * REFUND instead (see sale-refund.spec.ts), and the detail sheet only surfaces
 * "Void sale" for that open state (canVoid). Seed an open sale via the real API,
 * open it from the Sales list's "Drafts" tab, void it through the confirm
 * dialog, and assert it flips to "Voided" — in the list badge (UI round-trip,
 * now under the "Sales" tab since a voided sale is no longer a draft) and via a
 * direct API read (persisted side-effect).
 *
 * RUNS AT BOTH VIEWPORTS: the list renders the same table and the detail sheet /
 * confirm dialog are overlays that open identically at desktop and mobile.
 */
test.describe('Sales · void an open sale', () => {
  test('open an unsettled sale and void it', async ({ org }) => {
    const { page, seed } = org;
    const clientName = `E2E Void Client ${Date.now()}`;

    const leadId = await seedLead(seed, clientName);
    const sale = await seedOpenSale(seed, {
      amountCents: 6000,
      itemName: 'Gift card',
      leadId,
    });
    expect(sale.status).toBe('open');

    await gotoSurface(page, '/dashboard/sales/list');
    // Open (unsettled) sales live under the "Drafts" tab; the default "Sales"
    // tab shows only non-open sales.
    await page.getByRole('tab', { name: 'Drafts' }).click();
    await expect(page.getByText(clientName)).toBeVisible({ timeout: 20_000 });

    // Open the sale detail sheet by clicking its row.
    await page.getByText(clientName).click();
    await expect(
      page.getByRole('heading', { name: 'Sale details' })
    ).toBeVisible({ timeout: 15_000 });

    // Void → confirm. The trigger and the alert-dialog action share the label
    // "Void sale", so scope the confirm click to the alertdialog.
    await page.getByRole('button', { name: 'Void sale' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(
      confirm.getByRole('heading', { name: 'Void this sale?' })
    ).toBeVisible({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Void sale' }).click();

    // The sheet closes on success and the invalidated list refetches. A voided
    // sale is no longer a draft, so it moves to the "Sales" tab marked Voided.
    await expect(
      page.getByRole('heading', { name: 'Sale details' })
    ).toBeHidden({ timeout: 15_000 });
    await page.getByRole('tab', { name: 'Sales' }).click();
    // Viewport-agnostic: desktop renders a table row, mobile a card (there is no
    // `role="row"` there at all, so the old locator could only ever time out).
    await expect(saleRow(page, { saleId: sale.id, clientName })).toContainText(
      'Voided',
      { timeout: 20_000 }
    );

    // Persisted side-effect backstop: the API read reports the voided status.
    const read = (await seed.authenticatedApiCall(
      'GET',
      `/sales/${sale.id}`
    )) as SaleRead;
    expect(read.status).toBe('voided');
  });
});
