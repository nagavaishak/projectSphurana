import { renderWithProviders, screen } from '@/test/render';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PaymentPanel: the checkout method chooser. The contract under test is the
 * Stripe gate: `add-sale-payment` refuses every card tender (manual card, QR
 * self-checkout) unless the org's Connect account can take a charge, so the
 * chooser must not offer one it knows will be refused. Cash and gift card
 * never touch Stripe and are always available.
 *
 * DID NOT FIT THE PLAIN PATTERN: the panel pulls the sales mutation hooks, a
 * gift-card lookup, a canvas-backed QR renderer and (via the always-mounted
 * card dialog) Stripe runtime config, so those are stubbed
 * (below) and only the Stripe-connection hook varies per case.
 */
let accountStatus: {
  status: { chargesEnabled: boolean } | null;
  isLoading: boolean;
} = { status: { chargesEnabled: true }, isLoading: false };

vi.mock('@/features/stripe-connect/api/get-account-status', () => ({
  useGetAccountStatus: () => accountStatus,
}));

vi.mock('@/features/gift-cards/api', () => ({
  useGetGiftCardByCode: () => ({ giftCard: null, isLoading: false }),
}));

vi.mock('@/components/kibo-ui/qr-code', () => ({
  QRCode: () => <div data-testid="qr-code" />,
}));

// The always-mounted ManualCardDialog pulls Stripe.js + runtime config even
// while closed.
vi.mock('@borradh-workspace/runtime-config/client', () => ({
  useRuntimeConfig: () => ({ stripePublishableKey: 'pk_test_123' }),
}));

vi.mock('../../api', () => ({
  useAddSalePayment: () => ({
    addSalePaymentAsync: vi.fn(),
    isPaying: false,
  }),
  useSettleCardPayment: () => ({ settleCardPaymentAsync: vi.fn() }),
  useCancelSalePayment: () => ({ cancelSalePaymentAsync: vi.fn() }),
}));

import { PaymentPanel } from './payment-panel';

const SALE = {
  id: 'sale_1',
  currency: 'eur',
  totalCents: 5000,
  payments: [],
  items: [],
} as unknown as SaleWithRelations;

describe('PaymentPanel Stripe gate', () => {
  beforeEach(() => {
    accountStatus = { status: { chargesEnabled: true }, isLoading: false };
  });

  it('offers the card tenders when Connect can take charges', () => {
    renderWithProviders(<PaymentPanel sale={SALE} />);

    expect(
      screen.getByRole('button', { name: /manual card entry/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /qr self-checkout/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/set up payments/i)).not.toBeInTheDocument();
  });

  it('hides the card tenders and explains why when charges are disabled', () => {
    accountStatus = { status: { chargesEnabled: false }, isLoading: false };

    renderWithProviders(<PaymentPanel sale={SALE} />);

    expect(
      screen.queryByRole('button', { name: /manual card entry/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /qr self-checkout/i })
    ).not.toBeInTheDocument();
    // Cash and gift card don't touch Stripe, so they stay.
    expect(screen.getByRole('button', { name: /cash/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /gift card/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /set up payments/i })
    ).toHaveAttribute('href', '/dashboard/settings/payments');
  });

  it('hides the card tenders when Stripe is disconnected entirely', () => {
    // Disconnecting deletes the integration row, so the endpoint answers
    // `connected: false` and the hook has no status at all.
    accountStatus = { status: null, isLoading: false };

    renderWithProviders(<PaymentPanel sale={SALE} />);

    expect(
      screen.queryByRole('button', { name: /manual card entry/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /qr self-checkout/i })
    ).not.toBeInTheDocument();
  });

  it('shows neither the card tenders nor the notice while status loads', () => {
    accountStatus = { status: null, isLoading: true };

    renderWithProviders(<PaymentPanel sale={SALE} />);

    expect(
      screen.queryByRole('button', { name: /manual card entry/i })
    ).not.toBeInTheDocument();
    // No flash of "payments aren't set up" before we actually know.
    expect(screen.queryByText(/set up payments/i)).not.toBeInTheDocument();
  });
});
