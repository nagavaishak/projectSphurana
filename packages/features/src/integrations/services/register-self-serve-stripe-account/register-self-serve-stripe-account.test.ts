import { mockStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { registerSelfServeStripeAccount } from './register-self-serve-stripe-account.service.js';

const handleOAuthCallback = vi.mocked(
  mockStripeConnectService.handleOAuthCallback
);

/**
 * The org-less leg of the shareable onboarding link. Its whole contract is: do
 * the code exchange (which is what actually attaches the account to the
 * platform), write NOTHING locally, and land the merchant somewhere that makes
 * sense — including when they pressed cancel.
 */
describe('registerSelfServeStripeAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleOAuthCallback.mockReset();
  });

  it('exchanges the code and sends the merchant to the done page', async () => {
    handleOAuthCallback.mockResolvedValueOnce({
      accountId: 'acct_123',
      account: { businessName: 'Glow', detailsSubmitted: true },
    });

    const result = await registerSelfServeStripeAccount({ code: 'ac_123' });

    expect(handleOAuthCallback).toHaveBeenCalledWith('ac_123');
    expect(result.path).toBe(
      '/connect/stripe/done?status=connected&account=acct_123'
    );
  });

  it('treats a cancelled consent screen as cancelled, not an error', async () => {
    // Telling someone "something went wrong" when they chose to stop is how a
    // support ticket gets raised about a system that worked.
    const result = await registerSelfServeStripeAccount({
      error: 'access_denied',
    });

    expect(result.path).toBe('/connect/stripe/done?status=cancelled');
    expect(handleOAuthCallback).not.toHaveBeenCalled();
  });

  it('treats a missing code as cancelled', async () => {
    const result = await registerSelfServeStripeAccount({});

    expect(result.path).toBe('/connect/stripe/done?status=cancelled');
    expect(handleOAuthCallback).not.toHaveBeenCalled();
  });

  it('lands on the error state when Stripe refuses the exchange', async () => {
    handleOAuthCallback.mockRejectedValueOnce(new Error('invalid_grant'));

    const result = await registerSelfServeStripeAccount({ code: 'ac_dead' });

    expect(result.path).toBe('/connect/stripe/done?status=error');
  });
});
