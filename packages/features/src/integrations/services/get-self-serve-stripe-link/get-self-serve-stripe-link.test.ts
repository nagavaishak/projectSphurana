import { apiEnv } from '@borradh-workspace/env/api';
import { mockStripeConnectService } from '@borradh-workspace/integrations/stripe';
import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getSelfServeStripeLink } from './get-self-serve-stripe-link.service.js';

const selfServeOnboardingUrl = vi.mocked(
  mockStripeConnectService.selfServeOnboardingUrl
);

describe('getSelfServeStripeLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selfServeOnboardingUrl.mockReset();
    selfServeOnboardingUrl.mockReturnValue('https://connect.stripe.com/oauth');
  });

  it('builds the link against the ORG-LESS callback', async () => {
    // The org-scoped callback rejects a state-less request — correctly, and it
    // is a dead end for a link sent before the workspace exists.
    const result = await getSelfServeStripeLink();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.redirectUri).toMatch(
      /\/integrations\/stripe\/self-serve\/callback$/
    );
    expect(selfServeOnboardingUrl).toHaveBeenCalledWith(
      result.data.redirectUri
    );
  });

  it('names API_URL when it is not configured', async () => {
    const env = apiEnv as { API_URL?: string };
    const original = env.API_URL;
    env.API_URL = undefined;
    try {
      const result = await getSelfServeStripeLink();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(result.error.message).toContain('API_URL');
      }
    } finally {
      env.API_URL = original;
    }
  });

  it('names the Stripe client id when the service cannot be built', async () => {
    // The service constructor throws when STRIPE_CONNECT_CLIENT_ID is unset.
    selfServeOnboardingUrl.mockImplementationOnce(() => {
      throw new Error('STRIPE_CONNECT_CLIENT_ID is required');
    });

    await expectResult(getSelfServeStripeLink()).toFailWithCode(
      ErrorCodes.INVALID_STATE
    );
  });
});
