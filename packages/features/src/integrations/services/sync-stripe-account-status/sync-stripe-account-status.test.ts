import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { syncStripeAccountStatus } from './sync-stripe-account-status.service.js';

describe('syncStripeAccountStatus', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    stripeAccountId: 'acct_123',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  };

  it('syncs Stripe account status successfully', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'stripe-1',
        organizationId: 'org-123',
        stripeAccountId: 'acct_123',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    ]);

    const result = await syncStripeAccountStatus(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
      expect(result.data?.chargesEnabled).toBe(true);
    }
  });

  it('syncs with optional email and businessName', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'stripe-1',
      organizationId: 'org-123',
      stripeAccountId: 'acct_123',
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'stripe-1',
        organizationId: 'org-123',
        stripeAccountId: 'acct_123',
        accountEmail: 'new@example.com',
        accountName: 'New Business',
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
      },
    ]);

    const result = await syncStripeAccountStatus(mockDb as never, {
      ...validInput,
      email: 'new@example.com',
      businessName: 'New Business',
      payoutsEnabled: false,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      expect(result.data.accountEmail).toBe('new@example.com');
    }
  });

  it('returns null when no integration found for Stripe account', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await syncStripeAccountStatus(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing stripeAccountId', async () => {
    await expectResult(
      syncStripeAccountStatus(mockDb as never, {
        ...validInput,
        stripeAccountId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing chargesEnabled', async () => {
    await expectResult(
      syncStripeAccountStatus(
        mockDb as never,
        {
          stripeAccountId: 'acct_123',
          payoutsEnabled: true,
          detailsSubmitted: true,
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid email', async () => {
    await expectResult(
      syncStripeAccountStatus(mockDb as never, {
        ...validInput,
        email: 'not-an-email',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
