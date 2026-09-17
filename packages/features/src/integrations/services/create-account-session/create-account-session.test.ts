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

import { createAccountSession } from './create-account-session.service.js';

describe('createAccountSession', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_1',
    userEmail: 'owner@example.com',
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
      createAccountSession(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(
      mockStripeConnectService.createAccountSession
    ).not.toHaveBeenCalled();
    expect(
      mockDb.query.stripeConnectIntegration.findFirst
    ).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an invalid userEmail (no side effect)', async () => {
    await expectResult(
      createAccountSession(mockDb as never, {
        ...validInput,
        userEmail: 'not-an-email',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(
      mockStripeConnectService.createAccountSession
    ).not.toHaveBeenCalled();
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

    const result = await createAccountSession(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);

    expect(
      mockStripeConnectService.createAccountSession
    ).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the Stripe call fails', async () => {
    seedExistingIntegration();
    mockStripeConnectService.createAccountSession.mockRejectedValueOnce(
      new Error('stripe down')
    );

    const result = await createAccountSession(mockDb as never, validInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('creates the account session and returns the client secret', async () => {
    seedExistingIntegration();
    mockStripeConnectService.createAccountSession.mockResolvedValueOnce({
      clientSecret: 'acct_sess_secret_abc',
    });

    await expectResult(
      createAccountSession(mockDb as never, {
        ...validInput,
        components: ['account_onboarding'],
      })
    ).toSucceedWith((data) => {
      expect(data.clientSecret).toBe('acct_sess_secret_abc');
    });

    const callArgs =
      mockStripeConnectService.createAccountSession.mock.calls[0][0];
    expect(callArgs.connectedAccountId).toBe('acct_existing');
    expect(callArgs.components).toEqual(['account_onboarding']);
  });
});
