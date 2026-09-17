import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

const mockStripeConnectService = vi.mocked(getStripeConnectService());

import { createAccountLink } from './create-account-link.service.js';

describe('createAccountLink', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_1',
    userEmail: 'owner@example.com',
    returnUrl: 'https://app.example.com/return',
    refreshUrl: 'https://app.example.com/refresh',
  };

  // Make ensureControllerAccount resolve via the idempotent existing-row path
  // so it never provisions a new Stripe account — isolating this service.
  const seedExistingIntegration = () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      organizationId: 'org_123',
      stripeAccountId: 'acct_existing',
      accountType: 'controller',
    });
  };

  it('returns VALIDATION_ERROR for a blank organizationId (no side effect)', async () => {
    await expectResult(
      createAccountLink(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStripeConnectService.createAccountLink).not.toHaveBeenCalled();
    expect(
      mockDb.query.stripeConnectIntegration.findFirst
    ).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a non-URL returnUrl (no side effect)', async () => {
    await expectResult(
      createAccountLink(mockDb as never, {
        ...validInput,
        returnUrl: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStripeConnectService.createAccountLink).not.toHaveBeenCalled();
  });

  it('propagates the guard error when no connected account can be provisioned', async () => {
    // ensureControllerAccount: no existing row and no organization → NOT_FOUND.
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await createAccountLink(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);

    expect(mockStripeConnectService.createAccountLink).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the Stripe call fails', async () => {
    seedExistingIntegration();
    mockStripeConnectService.createAccountLink.mockRejectedValueOnce(
      new Error('stripe down')
    );

    const result = await createAccountLink(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('creates the account link and returns the url + expiry', async () => {
    seedExistingIntegration();
    mockStripeConnectService.createAccountLink.mockResolvedValueOnce({
      url: 'https://connect.stripe.com/setup/abc',
      expiresAt: 1_800_000_000,
    });

    await expectResult(
      createAccountLink(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.url).toBe('https://connect.stripe.com/setup/abc');
      expect(data.expiresAt).toBe(1_800_000_000);
    });

    const callArgs =
      mockStripeConnectService.createAccountLink.mock.calls[0][0];
    expect(callArgs.connectedAccountId).toBe('acct_existing');
    expect(callArgs.returnUrl).toBe('https://app.example.com/return');
    expect(callArgs.refreshUrl).toBe('https://app.example.com/refresh');
  });
});
