import { type Page, expect } from '@playwright/test';

import type { SeedHelper } from './seed.fixture.js';

interface OpenSalePayment {
  id: string;
  method: string;
  status: string;
  amountCents: number;
  stripePaymentIntentId?: string | null;
}

/**
 * Wait for a tender to land on the open sale, and return it with its sale id.
 *
 * Opening the card / terminal dialog and CREATING the tender are two different
 * things: the click opens the dialog immediately and fires `POST
 * sales/:id/payments` in the background. Reading the sale the moment the dialog
 * renders therefore races the write — the tender is usually there a beat later.
 * Poll rather than assert once (and rather than sleep).
 *
 * `withStripePaymentIntent` extends that reasoning one step further, and callers
 * that go on to inject a webhook MUST pass it. The tender row and its
 * `stripePaymentIntentId` do not land together: the row appears first and the
 * PaymentIntent id is attached a beat later. Polling only for the ROW therefore
 * returns a tender whose `stripePaymentIntentId` is still null, and the caller's
 * very next line — which reads exactly that field to address the webhook — fails
 * on a value that would have been there milliseconds later. Wait for the field
 * the caller consumes, not merely for the row that will one day carry it.
 */
export async function waitForOpenSaleTender(
  seed: SeedHelper,
  organizationId: string,
  match: { method: string; status: string; withStripePaymentIntent?: boolean }
): Promise<{ saleId: string; tender: OpenSalePayment }> {
  let saleId = '';
  let tender: OpenSalePayment | undefined;

  await expect
    .poll(
      async () => {
        const open = (await seed.getOpenSale(organizationId)) as {
          saleId: string;
          payments: OpenSalePayment[];
        };
        saleId = open.saleId;
        tender = open.payments.find(
          (p) =>
            p.method === match.method &&
            p.status === match.status &&
            (!match.withStripePaymentIntent || !!p.stripePaymentIntentId)
        );
        return !!tender;
      },
      {
        timeout: 20_000,
        message: match.withStripePaymentIntent
          ? `a ${match.status} ${match.method} tender lands on the open sale carrying a PaymentIntent id`
          : `a ${match.status} ${match.method} tender lands on the open sale`,
      }
    )
    .toBe(true);

  if (!tender) throw new Error('unreachable: poll resolved without a tender');
  return { saleId, tender };
}

/**
 * Add a gift-card line to the open checkout cart.
 *
 * The gift-card flow is TWO dialogs since the sales redesign: "Gift card" in the
 * add-item bar opens a **Gift cards** picker (preset tiles 25/50/75/100/150 plus
 * "Custom amount"), and picking one opens **Edit gift card** (`Gift card value`,
 * `Price`, …) with an **Apply** button that commits the line. The old
 * single-dialog flow ("Sell a gift card" + `#gift-card-amount` + "Add gift card")
 * no longer exists.
 *
 * Always goes through "Custom amount" so any value works, preset or not.
 */
export async function addGiftCardLine(
  page: Page,
  amountEuros: number
): Promise<void> {
  await page.getByRole('button', { name: 'Gift card' }).click();

  const picker = page.getByRole('dialog').filter({ hasText: 'Gift cards' });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await picker.getByRole('button', { name: /custom amount/i }).click();

  const editor = page.getByRole('dialog').filter({ hasText: 'Edit gift card' });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.getByLabel('Gift card value').fill(String(amountEuros));

  const apply = editor.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeEnabled();
  await apply.click();

  // The line is only in the cart once the editor closes.
  await expect(editor).toBeHidden({ timeout: 15_000 });
}
