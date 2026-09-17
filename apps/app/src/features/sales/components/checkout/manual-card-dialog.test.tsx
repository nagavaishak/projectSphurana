import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ManualCardDialog — keyed card entry via Stripe Elements. Unlike the other
 * checkout dialogs there is no local money form: the amount is fixed
 * server-side and the cashier only enters card details inside Stripe's
 * PaymentElement. So the "form → payload" contract here is the confirm call:
 * clicking Pay must call stripe.confirmPayment and, only on success, fire
 * onPaid (the webhook then settles the tender). Errors surface in-dialog and
 * must NOT fire onPaid; the Pay button is gated until Stripe is ready.
 *
 * DID NOT FIT THE PLAIN PATTERN — this component pulls Stripe.js + runtime
 * config, so it needs @stripe/react-stripe-js, @stripe/stripe-js and
 * runtime-config mocked (below) rather than just the callback spy.
 */
const confirmPayment = vi.fn();
let stripeInstance: unknown = { confirmPayment };
let elementsInstance: unknown = {};

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => children,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => stripeInstance,
  useElements: () => elementsInstance,
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@borradh-workspace/runtime-config/client', () => ({
  useRuntimeConfig: () => ({ stripePublishableKey: 'pk_test_123' }),
}));

import { ManualCardDialog } from './manual-card-dialog';

const baseProps = {
  open: true,
  onOpenChange: () => {},
  clientSecret: 'pi_123_secret_abc',
  connectedAccountId: 'acct_123',
  amountCents: 2500,
  currency: 'eur',
};

describe('ManualCardDialog', () => {
  beforeEach(() => {
    confirmPayment.mockReset();
    stripeInstance = { confirmPayment };
    elementsInstance = {};
  });

  it('shows the preparing state until the client secret is ready', () => {
    renderWithProviders(
      <ManualCardDialog {...baseProps} clientSecret={null} onPaid={() => {}} />
    );

    expect(screen.getByText(/preparing secure card form/i)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /pay/i })
    ).not.toBeInTheDocument();
  });

  it('renders the card form with the fixed amount once the secret is present', () => {
    renderWithProviders(<ManualCardDialog {...baseProps} onPaid={() => {}} />);

    expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    // Amount is fixed server-side and shown formatted (2500 cents → €25.00).
    expect(screen.getByRole('button', { name: /pay/i })).toHaveTextContent(
      '€25.00'
    );
  });

  it('confirms the payment and fires onPaid on success', async () => {
    confirmPayment.mockResolvedValue({});
    const onPaid = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<ManualCardDialog {...baseProps} onPaid={onPaid} />);

    await user.click(screen.getByRole('button', { name: /pay/i }));

    expect(confirmPayment).toHaveBeenCalledTimes(1);
    // Kept in-dialog: no redirect-based methods on the PaymentIntent.
    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({ redirect: 'if_required' })
    );
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it('surfaces the error and does not fire onPaid when confirmation fails', async () => {
    confirmPayment.mockResolvedValue({
      error: { message: 'Your card was declined.' },
    });
    const onPaid = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<ManualCardDialog {...baseProps} onPaid={onPaid} />);

    await user.click(screen.getByRole('button', { name: /pay/i }));

    expect(await screen.findByText('Your card was declined.')).toBeVisible();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('shows an unavailable state (not an endless spinner) when Stripe cannot initialize', () => {
    // No connected account (or, in prod, a missing publishable key) means
    // Stripe.js can never load. The dialog must say so rather than hang on
    // "Preparing secure card form…" forever.
    renderWithProviders(
      <ManualCardDialog
        {...baseProps}
        connectedAccountId={null}
        onPaid={() => {}}
      />
    );

    expect(screen.getByText(/card payments are unavailable/i)).toBeVisible();
    expect(
      screen.queryByText(/preparing secure card form/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /pay/i })
    ).not.toBeInTheDocument();
  });

  it('skips real Stripe Elements for the E2E stub client secret', () => {
    // With a real publishable key present, the backend stub (STRIPE_E2E_STUB)
    // still hands a FAKE `pi_e2e_…_secret_e2e` client secret. Real Stripe.js
    // rejects that format with an IntegrationError that throws out of <Elements>
    // and crashes the checkout. The dialog must recognise the stub secret and
    // render a "Test mode" notice instead of the PaymentElement.
    renderWithProviders(
      <ManualCardDialog
        {...baseProps}
        clientSecret="pi_e2e_abc123def456_secret_e2e"
        onPaid={() => {}}
      />
    );

    expect(screen.getByText(/test mode/i)).toBeVisible();
    expect(screen.queryByTestId('payment-element')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /pay/i })
    ).not.toBeInTheDocument();
  });

  it('gates the Pay button until Stripe.js is ready', async () => {
    // Stripe not yet loaded → hook returns null → button disabled, no-op.
    stripeInstance = null;
    const onPaid = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(<ManualCardDialog {...baseProps} onPaid={onPaid} />);

    const pay = screen.getByRole('button', { name: /pay/i });
    expect(pay).toBeDisabled();
    await user.click(pay);
    expect(confirmPayment).not.toHaveBeenCalled();
    expect(onPaid).not.toHaveBeenCalled();
  });
});
