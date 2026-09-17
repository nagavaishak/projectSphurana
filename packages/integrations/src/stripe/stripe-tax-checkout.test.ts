import { describe, expect, it, vi } from 'vitest';
import { StripeConnectService } from './stripe-connect.service.js';

const makeService = () => {
  const service = new StripeConnectService('sk_test_example', 'ca_example');
  const settingsRetrieve = vi.fn().mockResolvedValue({
    status: 'active',
    defaults: {
      tax_behavior: 'inferred_by_currency',
      tax_code: 'txcd_99999999',
    },
  });
  const checkoutCreate = vi.fn().mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.com/cs_test_123',
  });

  // Stripe is a network client; replace it with the smallest honest shape this
  // unit exercises, so this test proves our Checkout parameters without a real
  // Stripe call.
  (service as unknown as { stripe: unknown }).stripe = {
    tax: { settings: { retrieve: settingsRetrieve } },
    checkout: { sessions: { create: checkoutCreate } },
  };

  return { service, settingsRetrieve, checkoutCreate };
};

describe('StripeConnectService tax-aware Checkout', () => {
  it('enables automatic tax and forwards a service tax-code override', async () => {
    const { service, checkoutCreate } = makeService();

    await service.createDepositCheckout({
      connectedAccountId: 'acct_123',
      amountCents: 5000,
      currency: 'eur',
      productName: 'Consultation deposit',
      taxCode: 'txcd_99999999',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        automatic_tax: { enabled: true },
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              product_data: expect.objectContaining({
                tax_code: 'txcd_99999999',
              }),
            }),
          }),
        ],
      }),
      expect.objectContaining({ stripeAccount: 'acct_123' })
    );
  });

  it('refuses Checkout when Stripe Tax is not ready', async () => {
    const { service, settingsRetrieve, checkoutCreate } = makeService();
    settingsRetrieve.mockResolvedValueOnce({
      status: 'pending',
      defaults: { tax_behavior: null, tax_code: null },
    });

    await expect(
      service.createPaymentCheckout({
        connectedAccountId: 'acct_123',
        amountCents: 5000,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      })
    ).rejects.toThrow('Stripe Tax setup is incomplete');

    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  it('keeps retail products as separate, tax-classified Checkout lines', async () => {
    const { service, checkoutCreate } = makeService();
    await service.createShopCheckout({
      connectedAccountId: 'acct_123',
      currency: 'eur',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      metadata: { cartId: 'cart_123' },
      idempotencyKey: 'shop-cart-cart_123',
      lineItems: [
        {
          name: 'Serum',
          unitAmountCents: 4500,
          quantity: 1,
          taxCode: 'txcd_99999999',
          image: 'https://cdn.example/serum.jpg',
        },
        {
          name: 'Voucher',
          unitAmountCents: 5000,
          quantity: 1,
          taxCode: 'txcd_00000000',
        },
      ],
    });
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              product_data: expect.objectContaining({
                name: 'Serum',
                tax_code: 'txcd_99999999',
                images: ['https://cdn.example/serum.jpg'],
              }),
            }),
          }),
          expect.objectContaining({
            price_data: expect.objectContaining({
              product_data: expect.objectContaining({
                name: 'Voucher',
                tax_code: 'txcd_00000000',
              }),
            }),
          }),
        ],
      }),
      expect.objectContaining({
        stripeAccount: 'acct_123',
        idempotencyKey: 'shop-cart-cart_123',
      })
    );
  });
});
