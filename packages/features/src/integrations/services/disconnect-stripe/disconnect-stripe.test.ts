import { mockStripeConnectService } from '@borradh-workspace/integrations/stripe';
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
import { disconnectStripe } from './disconnect-stripe.service.js';

const mockDisconnectAccount = vi.mocked(
  mockStripeConnectService.disconnectAccount
);
const mockReleaseAccount = vi.mocked(mockStripeConnectService.releaseAccount);

describe('disconnectStripe', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDisconnectAccount.mockReset();
    mockReleaseAccount.mockReset();
    mockReleaseAccount.mockResolvedValue(undefined);
  });

  const validInput = {
    organizationId: 'org-123',
  };

  it('disconnects Stripe successfully', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      accountType: 'standard_oauth',
    });
    mockDisconnectAccount.mockResolvedValueOnce(undefined);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectStripe(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.success).toBe(true);
    expect(mockDisconnectAccount).toHaveBeenCalledWith('acct_123');
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('skips Stripe revocation for controller accounts', async () => {
    // Controller accounts have no OAuth grant; `oauth.deauthorize` rejects them
    // outright ("V2 Accounts cannot be disconnected via this endpoint"), so the
    // call must not be made at all. Regression test for ENG-764.
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      accountType: 'controller',
    });
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectStripe(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(mockDisconnectAccount).not.toHaveBeenCalled();
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('disconnects when Stripe refuses to revoke the grant', async () => {
    // Stripe will not release an account whose negative balance the platform
    // still owes. The local disconnect is all the UI promises, so it proceeds.
    // Regression test for ENG-765.
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      accountType: 'standard_oauth',
    });
    const refusal = Object.assign(
      new Error(
        "You cannot call deauthorize on acct_123 because you're responsible for negative balances on this account."
      ),
      { raw: {}, statusCode: 401, type: 'StripeAuthenticationError' }
    );
    mockDisconnectAccount.mockRejectedValueOnce(refusal);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectStripe(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(mockDisconnectAccount).toHaveBeenCalledWith('acct_123');
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('disconnects even if Stripe revocation fails', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      accountType: 'standard_oauth',
    });
    mockDisconnectAccount.mockRejectedValueOnce(new Error('Stripe error'));
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectStripe(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.success).toBe(true);
  });

  it('clears the ownership stamp BEFORE revoking the grant', async () => {
    // Revoking a Standard account's grant also revokes our ability to write to
    // it, so a stamp cleared afterwards would never be cleared at all — and the
    // merchant's next workspace would be refused with nothing to point at.
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      accountType: 'standard_oauth',
    });
    mockDisconnectAccount.mockResolvedValueOnce(undefined);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    await disconnectStripe(mockDb as never, validInput);

    expect(mockReleaseAccount).toHaveBeenCalledWith('acct_123');
    expect(mockReleaseAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mockDisconnectAccount.mock.invocationCallOrder[0] as number
    );
  });

  it('clears the stamp on a controller account too', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      accountType: 'controller',
    });
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    await disconnectStripe(mockDb as never, validInput);

    expect(mockReleaseAccount).toHaveBeenCalledWith('acct_123');
  });

  it('disconnects even if the stamp cannot be cleared', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
      accountType: 'controller',
    });
    mockReleaseAccount.mockRejectedValueOnce(new Error('Stripe error'));
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await disconnectStripe(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no integration exists', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      disconnectStripe(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      disconnectStripe(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
