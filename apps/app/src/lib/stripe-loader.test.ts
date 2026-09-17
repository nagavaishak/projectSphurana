import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stripe.js loaders are attached with no `.catch` at their call sites
 * (`<Elements stripe={promise}>` and a `useState` initializer), so a loader
 * failure surfaces as an UNHANDLED promise rejection — a class PostHog's
 * lazily-loaded exception autocapture can miss. These wrappers route the
 * failure through the explicit `logError` path (PostHog + Sentry) and re-throw,
 * so the failure is observable in both tools without changing UI behavior.
 *
 * Each test rejects/throws the underlying loader and asserts `logError` fires
 * with the loader error. Without the `.catch` / try-catch in the wrapper these
 * assertions fail (logError is never called and the error escapes).
 */

const h = vi.hoisted(() => ({
  loadStripe: vi.fn(),
  loadConnectAndInitialize: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: h.loadStripe }));
vi.mock('@stripe/connect-js', () => ({
  loadConnectAndInitialize: h.loadConnectAndInitialize,
}));
vi.mock('./log-error', () => ({ logError: h.logError }));

import { loadConnectWithCapture, loadStripeWithCapture } from './stripe-loader';

describe('loadStripeWithCapture', () => {
  beforeEach(() => {
    h.loadStripe.mockReset();
    h.logError.mockReset();
  });

  it('passes through the loaded Stripe instance on success', async () => {
    const stripe = { id: 'stripe' };
    h.loadStripe.mockResolvedValueOnce(stripe);

    await expect(loadStripeWithCapture('pk_test_123')).resolves.toBe(stripe);
    expect(h.logError).not.toHaveBeenCalled();
  });

  it('forwards loader args to loadStripe', async () => {
    h.loadStripe.mockResolvedValueOnce(null);
    await loadStripeWithCapture('pk_test_123', { stripeAccount: 'acct_1' });
    expect(h.loadStripe).toHaveBeenCalledWith('pk_test_123', {
      stripeAccount: 'acct_1',
    });
  });

  it('captures the rejection via logError and re-throws', async () => {
    const error = new Error('Failed to load Stripe.js');
    h.loadStripe.mockRejectedValueOnce(error);

    await expect(loadStripeWithCapture('pk_test_123')).rejects.toBe(error);
    expect(h.logError).toHaveBeenCalledWith('sales.loadStripe', error);
  });
});

describe('loadConnectWithCapture', () => {
  const params = {
    publishableKey: 'pk_test_123',
    fetchClientSecret: async () => 'secret',
  } as unknown as Parameters<typeof loadConnectWithCapture>[0];

  beforeEach(() => {
    h.loadConnectAndInitialize.mockReset();
    h.logError.mockReset();
  });

  it('passes through the connect instance on success', () => {
    const instance = { id: 'connect' };
    h.loadConnectAndInitialize.mockReturnValueOnce(instance);

    expect(loadConnectWithCapture(params)).toBe(instance);
    expect(h.logError).not.toHaveBeenCalled();
  });

  it('captures a synchronous throw via logError and re-throws', () => {
    const error = new Error('Invalid publishable key');
    h.loadConnectAndInitialize.mockImplementationOnce(() => {
      throw error;
    });

    expect(() => loadConnectWithCapture(params)).toThrow(error);
    expect(h.logError).toHaveBeenCalledWith('stripeConnect.loadConnect', error);
  });
});
